/**
 * Runtime d'un plugin de code : un par plugin, dans son Worker de l'hôte isolé (niveau `code`) ou dans le processus
 * principal (niveau `privileged`, D-07). Il répond par son port aux requêtes du processus principal, charge les
 * contributions du plugin (export par défaut du `main` : une `ContributionFactory` qui reçoit le contexte) et relaie
 * les appels du contexte au processus principal. Repris de `spikes/hote-isole/runtime.mjs` (ADR 0002).
 *
 * Cibles reçues : `runtime` (`ping`, `load`, `computeBatch`) et `<nature>/<idContribution>` pour une méthode d'une
 * contribution. Dans l'autre sens : `ctx` (appels du contexte). Intégré au runtime de l'hôte (navigateur) : rien de
 * Node ni d'Electron.
 */
import { callableMethod, ChannelError, CHANNEL_ERRORS, createChannel, type Channel, type PortLike } from './channel.ts';

/** Ce que le processus principal envoie pour charger un plugin (`runtime.load`). */
export interface RuntimePlugin {
  id: string;
  version: string;
  locale: string;
  /** Adresse du dossier du plugin, terminée par `/` (`mire-plugin://<id>/`, ou `file:///…/` en processus principal). */
  base: string;
  contributions: { kind: string; id: string; main: string }[];
  /** Valeurs par défaut des réglages du manifeste (les réglages eux-mêmes viennent avec P3-04). */
  settings: Record<string, unknown>;
}

/** Charge un module d'après son adresse : `import()` dans le Worker, `import()` de Node en processus principal. */
export type ModuleLoader = (url: string) => Promise<{ default?: unknown }>;

const unavailable = (what: string) => () =>
  Promise.reject(new ChannelError(CHANNEL_ERRORS.unavailable, `ctx.${what} n'est pas encore disponible pour les plugins (P3-04).`));

/**
 * Contexte du plugin. `log` et `events` fonctionnent ; `settings.get` rend la valeur par défaut du manifeste ; `http`,
 * `files` et `storage` refusent avec une erreur claire jusqu'à P3-04, qui les relaiera au processus principal (cible
 * `ctx`) où les permissions s'appliquent.
 */
function createContext(channel: Channel, plugin: RuntimePlugin, listeners: Map<string, Set<(p: unknown) => void>>) {
  const log =
    (level: 'info' | 'warn' | 'error') =>
    (message: unknown, ...details: unknown[]) => {
      let safe: unknown[] = [];
      try {
        safe = details.map((d) => (d instanceof Error ? d.message : typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : d));
      } catch {
        safe = ['(détails illisibles)'];
      }
      channel.event('log', { level, message: String(message), details: safe });
    };
  return Object.freeze({
    id: plugin.id,
    version: plugin.version,
    locale: plugin.locale,
    http: Object.freeze({ request: unavailable('http'), getJson: unavailable('http'), getText: unavailable('http') }),
    files: Object.freeze({
      requestFolder: unavailable('files'),
      readText: unavailable('files'),
      readBytes: unavailable('files'),
      exists: unavailable('files'),
      walk: unavailable('files'),
    }),
    storage: Object.freeze({ get: unavailable('storage'), set: unavailable('storage'), delete: unavailable('storage'), keys: unavailable('storage') }),
    settings: Object.freeze({
      get: (key: string) => (Object.hasOwn(plugin.settings, key) ? plugin.settings[key] : undefined),
      onChange: () => () => {},
    }),
    log: Object.freeze({ info: log('info'), warn: log('warn'), error: log('error') }),
    events: Object.freeze({
      on(event: string, listener: (payload: unknown) => void) {
        if (typeof listener !== 'function') return () => {};
        const set = listeners.get(event) ?? new Set();
        listeners.set(event, set);
        set.add(listener);
        return () => set.delete(listener);
      },
    }),
  });
}

/** Démarre le runtime d'un plugin sur `port`. */
export function startRuntime(port: PortLike, load: ModuleLoader): Channel {
  const contributions = new Map<string, Record<string, unknown>>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  let plugin: RuntimePlugin | null = null;
  let context: ReturnType<typeof createContext> | null = null;

  async function loadPlugin(p: RuntimePlugin): Promise<string[]> {
    if (plugin) throw new ChannelError(CHANNEL_ERRORS.plugin, 'Plugin déjà chargé.');
    plugin = p;
    context = createContext(channel, p, listeners);
    const loaded: string[] = [];
    for (const c of p.contributions) {
      const module = await load(new URL(c.main, p.base).href);
      if (typeof module.default !== 'function') throw new ChannelError(CHANNEL_ERRORS.plugin, `${c.main} : pas de fonction exportée par défaut.`);
      const instance = (await (module.default as (ctx: unknown) => unknown)(context)) as Record<string, unknown> | null;
      if (!instance || typeof instance !== 'object' || instance.id !== c.id)
        throw new ChannelError(CHANNEL_ERRORS.plugin, `${c.main} : la contribution rendue doit avoir l'identifiant « ${c.id} ».`);
      contributions.set(`${c.kind}/${c.id}`, instance);
      loaded.push(`${c.kind}/${c.id}`);
    }
    return loaded;
  }

  /** Lot d'éléments pour un tag automatique : une requête pour tout le lot, annulable entre deux éléments. */
  function computeBatch(target: string, elements: unknown[], signal: AbortSignal): unknown[] {
    const instance = contributions.get(target);
    const compute = instance && callableMethod(instance, 'compute');
    if (!compute) throw new ChannelError(CHANNEL_ERRORS.notFound, `${target}.compute`);
    const out = new Array(elements.length);
    for (let i = 0; i < elements.length; i++) {
      if (signal.aborted) throw new ChannelError(CHANNEL_ERRORS.cancelled, 'Lot annulé.');
      out[i] = compute.call(instance, elements[i]) ?? null;
    }
    return out;
  }

  function handle(target: string, method: string, args: unknown[], signal: AbortSignal): unknown {
    if (target === 'runtime') {
      if (method === 'ping') return 'pong';
      if (method === 'load') return loadPlugin(args[0] as RuntimePlugin);
      if (method === 'computeBatch') return computeBatch(String(args[0]), Array.isArray(args[1]) ? args[1] : [], signal);
      throw new ChannelError(CHANNEL_ERRORS.notFound, `runtime.${method}`);
    }
    const instance = contributions.get(target);
    const f = instance && callableMethod(instance, method);
    if (!f) throw new ChannelError(CHANNEL_ERRORS.notFound, `${target}.${method}`);
    // Les interfaces qui reçoivent un contexte le reçoivent de l'hôte, jamais du cœur (ADR 0002, précision 2).
    if (!needsContext(target, method)) return f.apply(instance, args);
    const withContext = args.slice(0, contextIndex(target, method));
    withContext.length = contextIndex(target, method);
    return f.apply(instance, [...withContext, context]);
  }

  function onEvent(name: string, data: unknown): void {
    if (name !== 'event' || !data || typeof data !== 'object') return;
    const { name: event, payload } = data as { name?: unknown; payload?: unknown };
    for (const listener of listeners.get(String(event)) ?? []) {
      try {
        listener(payload);
      } catch (err) {
        channel.event('log', { level: 'error', message: `events.on(${String(event)}) : ${(err as Error)?.message ?? err}`, details: [] });
      }
    }
  }

  const channel = createChannel(port, { handle, onEvent, timeout: 0 });
  channel.event('ready');
  return channel;
}

// Position du contexte dans les méthodes des interfaces du SDK qui en reçoivent un.
const CONTEXT_ARG: Readonly<Record<string, number>> = {
  'metadata.requires': 0,
  'metadata.collect': 1,
  'metadata.scrape': 2,
  'metadata.candidates': 1,
  'metadata.byId': 2,
  'search.search': 1,
};
const contextKey = (target: string, method: string) => `${target.split('/')[0]}.${method}`;
const needsContext = (target: string, method: string) => Object.hasOwn(CONTEXT_ARG, contextKey(target, method));
const contextIndex = (target: string, method: string) => CONTEXT_ARG[contextKey(target, method)];
