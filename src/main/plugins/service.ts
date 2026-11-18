/**
 * Hôte de plugins (P3-03) : découvre et vérifie les plugins, les active et les désactive (à chaud quand leurs
 * contributions le permettent), mémorise leur état, branche leurs contributions, charge leurs textes, surveille ceux
 * qui exécutent du code et désactive, avec un message clair, celui qui lève une exception, ne répond plus ou fait
 * planter son hôte. Mire continue sans lui.
 *
 * Exécution (D-07, D-18) : les données sont lues et validées par le cœur (`discovery.ts`) ; le code limité tourne
 * dans l'hôte isolé (`host.ts`), un Worker par plugin ; le code sensible, réservé aux plugins inclus, dans le
 * processus principal (`in-process.ts`), derrière la même API par messages.
 */
import path from 'node:path';
import type { ContributionKind } from '@mire/plugin-sdk';
import type { Element } from '@mire/shared';
import type { PluginSummary } from '@mire/shared/ipc';
import type { Messages } from '@mire/shared/i18n';
import type { Contributor } from '../catalog/tags/engine.ts';
import type { Registry } from '../catalog/tags/registry.ts';
import { CHANNEL_ERRORS, ChannelError, type Channel, type RequestHandler } from './channel.ts';
import { checkPlugin, declaredKinds, discoverPlugins, type CheckedPlugin, type DiscoveryRoots, type PluginOrigin, type Refusal } from './discovery.ts';
import type { PluginEndpoint } from './host.ts';
import type { Journal } from './journal.ts';
import { contributionEntries, createContributionRegistry, declaredTagsAndInfos, RESTART_KINDS, type ContributionEntry } from './registry.ts';
import type { RuntimePlugin } from './runtime.ts';
import type { FaultCode, PluginState } from './state.ts';
import { createPluginTaggers } from './taggers.ts';

/** Racine des textes d'un plugin dans les catalogues : `pluginTexts.<id, points remplacés par _>.` */
export const pluginTextKey = (id: string): string => id.replaceAll('.', '_');
export const pluginTextPrefix = (id: string): string => `pluginTexts.${pluginTextKey(id)}.`;

/** Plugin de code démarré : son canal (attaché à son port) et de quoi l'arrêter. */
export interface RunnerHandle {
  channel: Channel;
  stop(): void;
}

/** Ce qui fait tourner le code des plugins ; les pannes remontent par `events`. */
export interface Runners {
  /** Niveau `code` : un Worker de l'hôte isolé. */
  isolated(plugin: CheckedPlugin, endpoint: PluginEndpoint, timeout: number): Promise<RunnerHandle>;
  /** Niveau `privileged` : processus principal. */
  inProcess(plugin: CheckedPlugin, endpoint: PluginEndpoint, timeout: number): Promise<RunnerHandle>;
  /** Adresse du dossier du plugin vue par son runtime (terminée par `/`). */
  base(plugin: CheckedPlugin): string;
  /** Arrête tout (fermeture de Mire). */
  shutdown(): void;
}

export interface RunnerEvents {
  /** Hôte planté : les plugins qu'il faisait tourner, et ceux qui avaient une requête en cours. */
  hostGone(plugins: string[], reason: string): void;
  /** Exception non rattrapée dans le Worker d'un plugin. */
  workerError(pluginId: string, message: string): void;
}

/** Ce que l'interface (et le futur Centre) voit d'un plugin (contrat IPC `pluginsList`). */
export type PluginInfo = PluginSummary;

export interface PluginServiceOptions {
  roots: DiscoveryRoots;
  appVersion: string;
  /** Langues de Mire dont on charge les textes des plugins. */
  languages: readonly string[];
  state: PluginState;
  journal: Journal;
  /** Registre des tags et des infos du catalogue. */
  tagRegistry: Pick<Registry, 'declarePlugin' | 'removePlugin'>;
  /** Moteur de traduction : textes des plugins. */
  setTexts(key: string, texts: Readonly<Record<string, Messages>> | null): void;
  translate(key: string, vars?: Record<string, string | number>): string;
  /** Langue de l'interface (`ctx.locale`). */
  locale(): string;
  runners(events: RunnerEvents): Runners;
  /** Tags automatiques des plugins changés : le moteur reprend la liste des contributions. */
  onTaggersChange(): void;
  /** Éléments à recalculer après un lot de tags automatiques. */
  refresh(keys: string[]): void;
  /** Délai d'une requête à un plugin (ms). */
  requestTimeout?: number;
  /** Chien de garde : intervalle des pings et délai de réponse (ms). 0 : pas de chien de garde. */
  watchdog?: { interval: number; timeout: number };
}

interface Known {
  id: string;
  origin: PluginOrigin;
  version: string | null;
  plugin: CheckedPlugin | null;
  refusal: Refusal | null;
}

interface Active {
  plugin: CheckedPlugin;
  runner: RunnerHandle | null;
  /** Requêtes en cours (pour désigner le fautif si l'hôte plante). */
  busy: number;
}

const DEFAULT_TIMEOUT = 5000;
// ADR 0002 : ping toutes les 250 ms. Délai porté de 500 ms à 1 s : un lot de 500 éléments ou une pause du
// ramasse-miettes sur une machine chargée ne doivent pas faire désactiver un plugin sain.
const DEFAULT_WATCHDOG = { interval: 250, timeout: 1000 };

export function createPluginService(opts: PluginServiceOptions) {
  const { state, journal, translate } = opts;
  const timeout = opts.requestTimeout ?? DEFAULT_TIMEOUT;
  const watchdog = opts.watchdog ?? DEFAULT_WATCHDOG;
  const known = new Map<string, Known>();
  const active = new Map<string, Active>();
  const registry = createContributionRegistry();
  const restartPending = new Set<string>();
  let watchdogTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const taggers = createPluginTaggers({
    refresh: (keys) => opts.refresh(keys),
    onError: (pluginId, err) => fault(pluginId, err),
  });

  const runners = opts.runners({
    hostGone(plugins, reason) {
      // Les plugins qui avaient une requête en cours sont désignés ; à défaut, tous ceux de l'hôte.
      const busy = plugins.filter((id) => (active.get(id)?.busy ?? 0) > 0);
      const culprits = busy.length ? busy : plugins;
      for (const id of plugins) {
        if (culprits.includes(id)) setFault(id, 'crashed', reason);
        else void restart(id);
      }
    },
    workerError(pluginId, message) {
      setFault(pluginId, 'exception', message);
    },
  });

  const nameOf = (id: string): string => {
    const k = known.get(id);
    if (!k?.plugin) return id;
    const n = translate(`${pluginTextPrefix(id)}plugin.name`);
    return n.startsWith('pluginTexts.') ? id : n;
  };
  const log = (id: string, level: 'info' | 'warn' | 'error', message: string) => journal.write(id, level, message);

  // -------------------------------------------------------------------------------------------------------------
  // Erreurs

  /** Code d'une panne d'après l'erreur d'une requête. */
  function faultCode(err: unknown): FaultCode {
    const code = (err as { code?: string })?.code;
    if (code === CHANNEL_ERRORS.timeout) return 'timeout';
    if (code === CHANNEL_ERRORS.hostGone) return 'crashed';
    return 'exception';
  }

  function fault(id: string, err: unknown): void {
    setFault(id, faultCode(err), String((err as Error)?.message ?? err));
  }

  function setFault(id: string, code: FaultCode, details: string): void {
    if (!active.has(id) || stopped) return;
    const message = translate(`plugins.faults.${code}`, { name: nameOf(id), details });
    log(id, 'error', `${message} (${details})`);
    console.error(`Plugins : ${id} désactivé (${code}) : ${details}`);
    deactivate(id);
    state.setFault(id, { code, message, at: Date.now() });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Exécution

  /** Requête à un plugin : comptée (pour désigner un fautif), et toute erreur du plugin le désactive. */
  async function call<T>(id: string, target: string, method: string, args: unknown[] = []): Promise<T> {
    const a = active.get(id);
    if (!a?.runner) throw new ChannelError(CHANNEL_ERRORS.notFound, `${id} is not active.`);
    a.busy++;
    try {
      return await a.runner.channel.request<T>(target, method, args);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Une annulation ou une méthode absente vient de l'appelant, pas du plugin.
      if (code !== CHANNEL_ERRORS.cancelled && code !== CHANNEL_ERRORS.notFound) fault(id, err);
      throw err;
    } finally {
      a.busy--;
    }
  }

  /** Ce que le plugin demande au processus principal. Le plugin est celui du port : `id` vient d'ici, jamais du message. */
  function endpoint(id: string): PluginEndpoint {
    const handle: RequestHandler = (target, method) => {
      if (target !== 'ctx') throw new ChannelError(CHANNEL_ERRORS.notFound, `${target}.${method}`);
      // Le contexte relayé (http, files, storage, settings) arrive avec P3-04.
      throw new ChannelError(CHANNEL_ERRORS.unavailable, `ctx.${method} is not available to plugins yet (P3-04).`);
    };
    return {
      handle,
      onEvent(name, data) {
        if (name !== 'log' || !data || typeof data !== 'object') return;
        const { level, message, details } = data as { level?: string; message?: unknown; details?: unknown[] };
        const lvl = level === 'warn' || level === 'error' ? level : 'info';
        const extra = Array.isArray(details) && details.length ? ` ${JSON.stringify(details).slice(0, 500)}` : '';
        log(id, lvl, `${String(message)}${extra}`);
      },
    };
  }

  function runtimePlugin(p: CheckedPlugin, locale: string): RuntimePlugin {
    const contributions = declaredKinds(p.manifest).flatMap((kind) =>
      ((p.manifest.contributes[kind] ?? []) as { id: string; main?: string }[]).filter((c) => c.main).map((c) => ({ kind, id: c.id, main: c.main! })),
    );
    const settings = Object.fromEntries((p.manifest.settings ?? []).filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
    return { id: p.id, version: p.version, locale, base: runners.base(p), contributions, settings };
  }

  async function startCode(p: CheckedPlugin): Promise<RunnerHandle> {
    const start = p.manifest.level === 'privileged' ? runners.inProcess : runners.isolated;
    const t0 = performance.now();
    const handle = await start(p, endpoint(p.id), timeout);
    try {
      await handle.channel.request('runtime', 'load', [runtimePlugin(p, opts.locale())]);
    } catch (err) {
      handle.stop();
      throw err;
    }
    log(p.id, 'info', `Démarré (${p.manifest.level}) en ${Math.round(performance.now() - t0)} ms.`);
    return handle;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Activation

  async function activate(id: string): Promise<void> {
    const k = known.get(id);
    const p = k?.plugin;
    if (!p || active.has(id) || stopped) return;
    const a: Active = { plugin: p, runner: null, busy: 0 };
    active.set(id, a);
    opts.setTexts(pluginTextKey(id), p.texts);
    opts.tagRegistry.declarePlugin(id, { ...declaredTagsAndInfos(p.manifest), textPrefix: pluginTextPrefix(id) });
    const hasCode = p.manifest.level !== 'data';
    if (hasCode) {
      try {
        a.runner = await startCode(p);
      } catch (err) {
        if (active.get(id) !== a) return;
        a.runner = null;
        setFault(id, faultCode(err) === 'exception' ? 'load' : faultCode(err), String((err as Error)?.message ?? err));
        return;
      }
      if (active.get(id) !== a) {
        a.runner?.stop();
        return;
      }
    }
    const entries = contributionEntries(p.manifest, p.dir, p.data, path.join);
    registry.set(id, entries);
    const tagEntries = entries.filter((e) => e.kind === 'taggers');
    for (const e of tagEntries) {
      const decl = e.declaration as { tags?: string[]; infos?: Record<string, { type: 'text' | 'number' | 'boolean' | 'list' }> };
      taggers.add({
        pluginId: id,
        id: e.id,
        tags: decl.tags ?? [],
        infos: decl.infos ?? {},
        computeBatch: (elements: Readonly<Element>[]) => call<unknown[]>(id, 'runtime', 'computeBatch', [`taggers/${e.id}`, elements]),
      });
    }
    if (tagEntries.length) opts.onTaggersChange();
    if (a.runner) ensureWatchdog();
    log(id, 'info', `Activé : ${entries.map((e) => `${e.kind}/${e.id}`).join(', ') || 'aucune contribution'}.`);
  }

  function deactivate(id: string): void {
    const a = active.get(id);
    if (!a) return;
    active.delete(id);
    const hadTaggers = registry.ofPlugin(id).some((e) => e.kind === 'taggers');
    taggers.remove(id);
    registry.remove(id);
    a.runner?.stop();
    opts.tagRegistry.removePlugin(id);
    opts.setTexts(pluginTextKey(id), null);
    if (hadTaggers) opts.onTaggersChange();
    log(id, 'info', 'Désactivé.');
  }

  /** Redémarre un plugin sain dont l'hôte a planté à cause d'un autre. */
  async function restart(id: string): Promise<void> {
    deactivate(id);
    await activate(id);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Chien de garde : un ping par plugin de code ; sans réponse dans le délai, il est désactivé (son Worker arrêté).

  function ensureWatchdog(): void {
    if (watchdogTimer || !watchdog.interval) return;
    const inFlight = new Set<string>();
    watchdogTimer = setInterval(() => {
      const running = [...active.entries()].filter(([, a]) => a.runner && a.plugin.manifest.level !== 'privileged');
      if (!running.length) {
        clearInterval(watchdogTimer!);
        watchdogTimer = null;
        return;
      }
      for (const [id, a] of running) {
        if (inFlight.has(id)) continue;
        inFlight.add(id);
        a.runner!.channel.request('runtime', 'ping', [], { timeout: watchdog.timeout })
          .catch((err) => {
            if (active.get(id) === a) setFault(id, faultCode(err) === 'timeout' ? 'timeout' : 'crashed', String((err as Error)?.message ?? err));
          })
          .finally(() => inFlight.delete(id));
      }
    }, watchdog.interval);
    watchdogTimer.unref?.();
  }

  // -------------------------------------------------------------------------------------------------------------

  function refusalMessage(id: string, r: Refusal): string {
    return translate(`plugins.refused.${r.code}`, { name: id, details: '', ...r.vars });
  }

  function info(k: Known): PluginInfo {
    const s = state.get(k.id);
    const p = k.plugin;
    const status: PluginInfo['status'] = k.refusal ? 'refused' : active.has(k.id) ? 'active' : s.fault ? 'fault' : 'disabled';
    return {
      id: k.id,
      version: p?.version ?? k.version,
      origin: k.origin,
      level: p?.manifest.level ?? null,
      name: nameOf(k.id),
      enabled: s.enabled,
      status,
      message: k.refusal ? refusalMessage(k.id, k.refusal) : (s.fault?.message ?? null),
      contributions: p
        ? declaredKinds(p.manifest).flatMap((kind) => ((p.manifest.contributes[kind] ?? []) as { id: string }[]).map((c) => ({ kind, id: c.id })))
        : [],
      restartRequired: restartPending.has(k.id),
    };
  }

  return {
    /** Découvre, vérifie et active les plugins voulus actifs. Les plugins refusés sont notés dans leur journal. */
    async start(): Promise<void> {
      state.load();
      const found = discoverPlugins(opts.roots);
      for (const s of found.skipped) console.error(`Plugins : ${s.where} écarté (${s.refusal.code}).`);
      for (const c of found.candidates) {
        const r = await checkPlugin(c, { appVersion: opts.appVersion, languages: opts.languages });
        const k: Known = { id: c.id, origin: c.origin, version: c.version, plugin: r.ok ? r.plugin : null, refusal: r.ok ? null : r.refusal };
        known.set(c.id, k);
        if (k.refusal) {
          log(c.id, 'warn', `Refusé : ${refusalMessage(c.id, k.refusal)} ${JSON.stringify(k.refusal.vars)}`);
          continue;
        }
        if (state.get(c.id).enabled) await activate(c.id);
      }
    },

    /** Tous les plugins trouvés, avec leur état (pour le futur Centre). */
    list: (): PluginInfo[] => [...known.values()].map(info),

    /** Active ou désactive un plugin ; à chaud, sauf les natures branchées au démarrage (redémarrage demandé). */
    async setEnabled(id: unknown, enabled: unknown): Promise<PluginInfo | null> {
      const k = typeof id === 'string' ? known.get(id) : undefined;
      if (!k || typeof enabled !== 'boolean' || k.refusal) return k ? info(k) : null;
      state.setEnabled(k.id, enabled);
      const needsRestart = !!k.plugin && declaredKinds(k.plugin.manifest).some((kind) => RESTART_KINDS.includes(kind));
      if (needsRestart) restartPending.add(k.id);
      if (enabled) await activate(k.id);
      else deactivate(k.id);
      return info(k);
    },

    /** Contributions actives d'une nature (registre). */
    contributions: (kind: ContributionKind): ContributionEntry[] => registry.list(kind),
    onContributionsChange: registry.onChange,

    /**
     * Appelle une méthode d'une contribution de code active (« même API par messages ») : sources, infos en ligne,
     * recherche… Une erreur du plugin le désactive.
     */
    call(pluginId: string, kind: ContributionKind, contributionId: string, method: string, args: unknown[] = []): Promise<unknown> {
      return call(pluginId, `${kind}/${contributionId}`, method, args);
    },

    /** Tags automatiques des plugins actifs, pour le moteur de tags. */
    taggerContributors: (): Contributor[] => taggers.contributors(),

    /** Événement de Mire transmis aux plugins actifs (`ctx.events.on`). */
    emit(name: string, payload?: unknown): void {
      for (const a of active.values()) a.runner?.channel.event('event', { name, payload });
    },

    /** Fermeture de Mire : tout s'arrête, l'état est écrit. */
    async stop(): Promise<void> {
      stopped = true;
      if (watchdogTimer) clearInterval(watchdogTimer);
      for (const a of active.values()) a.runner?.stop();
      active.clear();
      runners.shutdown();
      await state.flush();
    },
  };
}

export type PluginService = ReturnType<typeof createPluginService>;
