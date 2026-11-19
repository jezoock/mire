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
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ContributionKind } from '@mire/plugin-sdk';
import type { Element } from '@mire/shared';
import type { PluginSettingsInfo, PluginSummary } from '@mire/shared/ipc';
import type { Messages } from '@mire/shared/i18n';
import type { Contributor } from '../catalog/tags/engine.ts';
import type { Registry } from '../catalog/tags/registry.ts';
import { CHANNEL_ERRORS, ChannelError, type Channel, type RequestHandler } from './channel.ts';
import { checkPlugin, declaredKinds, discoverPlugins, type CheckedPlugin, type DiscoveryRoots, type PluginOrigin, type Refusal } from './discovery.ts';
import type { createContextHandler } from './context.ts';
import { checkPresent, dependentsOf, type DependencyNode, type DependencyProblem } from './dependencies.ts';
import type { PluginEndpoint } from './host.ts';
import type { Journal } from './journal.ts';
import { contributionEntries, createContributionRegistry, declaredTagsAndInfos, RESTART_KINDS, type ContributionEntry } from './registry.ts';
import type { RuntimePlugin } from './runtime.ts';
import type { PluginSettingsStore } from './settings.ts';
import type { FaultCode, PluginState } from './state.ts';
import { createPluginTaggers } from './taggers.ts';

/** Racine des textes d'un plugin dans les catalogues : `pluginTexts.<id, points remplacés par _>.` */
export const pluginTextKey = (id: string): string => id.replaceAll('.', '_');
export const pluginTextPrefix = (id: string): string => `pluginTexts.${pluginTextKey(id)}.`;

/** Plugin de code démarré : son canal (attaché à son port) et de quoi l'arrêter. */
export interface RunnerHandle {
  channel: Channel;
  stop(): void;
  /** Processus principal : contributions `webExtensions` et `downloaders` par `<nature>/<id>` (voir `in-process.ts`). */
  local?: ReadonlyMap<string, object>;
}

/** Contribution de code sensible d'un plugin inclus, branchée par référence au démarrage. */
export interface LocalContribution {
  pluginId: string;
  id: string;
  instance: object;
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
export type { PluginSettingsInfo };

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
  /** Contexte des plugins (`ctx.http`, `ctx.files`, `ctx.storage`), P3-04 ; sans lui, ces appels sont refusés. */
  context?: ReturnType<typeof createContextHandler>;
  /** Réglages des plugins (`plugins.<id>` de la configuration) ; sans eux, les valeurs par défaut du manifeste. */
  settings?: PluginSettingsStore;
  /** Fermeture de Mire : écrire ce qui attend (stockage des plugins). */
  flush?: () => Promise<void>;
  /** Désinstallation sans garder les données : effacer `userData/plugin-data/<id>/` (stockage fermé d'abord). */
  dropData?: (id: string) => Promise<void>;
  /** Délai d'une requête à un plugin (ms). */
  requestTimeout?: number;
  /** Chien de garde : intervalle des pings et délai de réponse (ms). 0 : pas de chien de garde. */
  watchdog?: { interval: number; timeout: number };
}

/** Résultat d'une désinstallation (`uninstall`) ; un refus porte son message, dans la langue de l'interface. */
export type UninstallResult =
  | { ok: true; keptData: boolean; restored: PluginInfo | null }
  | { ok: false; code: 'needed'; by: string[]; message: string }
  | { ok: false; code: 'bundled'; message: string };

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

  /** Nom du plugin dans la langue de l'interface (ses textes, lus même s'il n'est pas actif), sinon en anglais. */
  const nameOf = (id: string): string => {
    const texts = known.get(id)?.plugin?.texts;
    const name = (lang: string) => (texts?.[lang]?.plugin as { name?: unknown } | undefined)?.name;
    const n = name(opts.locale()) ?? name('en');
    return typeof n === 'string' && n ? n : id;
  };
  const log = (id: string, level: 'info' | 'warn' | 'error', message: string) => journal.write(id, level, message);
  const nodeOf = (p: CheckedPlugin): DependencyNode => ({ id: p.id, version: p.version, dependencies: p.manifest.dependencies ?? {} });
  const dependenciesOf = (id: string): string[] => Object.keys(known.get(id)?.plugin?.manifest.dependencies ?? {});
  /** Première dépendance d'un plugin qui n'est pas active (il l'attend), ou `null`. */
  const waitingFor = (id: string): string | null => dependenciesOf(id).find((d) => !active.has(d)) ?? null;
  /** Plugins présents qui déclarent une dépendance à `id`. */
  const dependents = (id: string): string[] =>
    dependentsOf(
      id,
      [...known.values()].flatMap((k) => (k.plugin ? [nodeOf(k.plugin)] : [])),
    );

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
  async function call<T>(id: string, target: string, method: string, args: unknown[] = [], options: { timeout?: number } = {}): Promise<T> {
    const a = active.get(id);
    if (!a?.runner) throw new ChannelError(CHANNEL_ERRORS.notFound, `${id} is not active.`);
    a.busy++;
    try {
      return await a.runner.channel.request<T>(target, method, args, options);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Une annulation ou une méthode absente vient de l'appelant, pas du plugin.
      if (code !== CHANNEL_ERRORS.cancelled && code !== CHANNEL_ERRORS.notFound) fault(id, err);
      throw err;
    } finally {
      a.busy--;
    }
  }

  /**
   * Ce que le plugin demande au processus principal. Le plugin est celui du port : `p` vient d'ici, jamais du message,
   * et ses permissions sont celles de son manifeste vérifié (ADR 0002).
   */
  function endpoint(p: CheckedPlugin): PluginEndpoint {
    const id = p.id;
    const ctx = opts.context?.({ id, manifest: p.manifest }) ?? null;
    const handle: RequestHandler = (target, method, args, signal) => {
      if (target !== 'ctx') throw new ChannelError(CHANNEL_ERRORS.notFound, `${target}.${method}`);
      if (!ctx) throw new ChannelError(CHANNEL_ERRORS.unavailable, `ctx.${method} is not available.`);
      return ctx.handle(method, args, signal);
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
    const settings =
      opts.settings?.values(p.id, p.manifest.settings) ??
      Object.fromEntries((p.manifest.settings ?? []).filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
    return { id: p.id, version: p.version, locale, base: runners.base(p), contributions, settings };
  }

  async function startCode(p: CheckedPlugin): Promise<RunnerHandle> {
    const start = p.manifest.level === 'privileged' ? runners.inProcess : runners.isolated;
    const t0 = performance.now();
    const handle = await start(p, endpoint(p), timeout);
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
    if (!p || k.refusal || active.has(id) || stopped || waitingFor(id)) return;
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
    // Ceux qui attendaient ce plugin (voulus actifs) démarrent à leur tour.
    for (const d of dependents(id)) if (state.get(d).enabled && !active.has(d)) await activate(d);
  }

  function deactivate(id: string): void {
    const a = active.get(id);
    if (!a) return;
    active.delete(id);
    // Ceux qui en ont besoin s'arrêtent aussi ; ils restent voulus actifs et reviendront avec lui.
    for (const d of dependents(id)) deactivate(d);
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

  /** Plugin voulu actif qui attend une dépendance désactivée ou en panne. */
  function waitingMessage(k: Known): string | null {
    if (!k.plugin || active.has(k.id) || !state.get(k.id).enabled) return null;
    const d = waitingFor(k.id);
    return d ? translate('plugins.waiting', { name: nameOf(k.id), dependency: nameOf(d) }) : null;
  }

  /** Refus pour une dépendance (`plugins.refused.dependency`, `dependency-refused`, `cycle`). */
  function dependencyRefusal(problem: DependencyProblem): Refusal {
    if (problem.code === 'cycle') return { code: 'cycle', vars: { details: problem.cycle.map(nameOf).join(' → ') } };
    if (problem.code === 'refused') return { code: 'dependency-refused', vars: { dependency: nameOf(problem.dependency) } };
    if (problem.code === 'missing') return { code: 'dependency', vars: { dependency: nameOf(problem.dependency), range: problem.range } };
    return { code: 'dependency', vars: { dependency: nameOf(problem.dependency), range: problem.requirements.map((r) => r.range).join(', ') } };
  }

  /** Vérifie un plugin trouvé et le note ; un plugin inclus nouveau (ou d'une nouvelle version) est installé. */
  async function examine(c: ReturnType<typeof discoverPlugins>['candidates'][number]): Promise<Known> {
    const r = await checkPlugin(c, { appVersion: opts.appVersion, languages: opts.languages });
    const k: Known = { id: c.id, origin: c.origin, version: c.version, plugin: r.ok ? r.plugin : null, refusal: r.ok ? null : r.refusal };
    known.set(c.id, k);
    if (k.refusal) log(c.id, 'warn', `Refusé : ${refusalMessage(c.id, k.refusal)} ${JSON.stringify(k.refusal.vars)}`);
    else if (c.origin === 'bundled' && state.get(c.id).bundled !== k.plugin!.version) {
      state.installBundled(c.id, k.plugin!.version);
      log(c.id, 'info', `Installé (livré avec Mire) : version ${k.plugin!.version}.`);
    }
    return k;
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
      message: k.refusal ? refusalMessage(k.id, k.refusal) : (s.fault?.message ?? waitingMessage(k)),
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
      for (const c of found.candidates) await examine(c);
      // Dépendances (D-19) : refus de ce qui manque, ne convient pas ou tourne en rond ; activation dans l'ordre.
      const present = [...known.values()].flatMap((k) => (k.plugin ? [nodeOf(k.plugin)] : []));
      const refused = new Set([...known.values()].filter((k) => k.refusal).map((k) => k.id));
      const { order, problems } = checkPresent(present, refused);
      for (const [id, problem] of problems) {
        const k = known.get(id)!;
        k.refusal = dependencyRefusal(problem);
        log(id, 'warn', `Refusé : ${refusalMessage(id, k.refusal)} ${JSON.stringify(k.refusal.vars)}`);
      }
      for (const id of order) if (state.get(id).enabled) await activate(id);
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

    /**
     * Désinstalle un plugin installé (`userData/plugins/<id>/`), sans écran (le Centre viendra avec P4-18). Refusé si un
     * autre plugin présent en a besoin (en disant lequel), ou si le plugin est livré avec Mire (il se désactive). Ses
     * données (`userData/plugin-data/<id>/`) sont gardées si `keepData`. Un plugin inclus que la version installée
     * remplaçait (mise à jour par le dépôt, P3-07) reprend sa place, actif ou non comme avant.
     */
    async uninstall(id: string, { keepData }: { keepData: boolean }): Promise<UninstallResult | null> {
      const k = known.get(id);
      if (!k) return null;
      const by = dependents(id);
      if (by.length)
        return { ok: false, code: 'needed', by, message: translate('plugins.uninstall.needed', { name: nameOf(id), by: by.map(nameOf).join(', ') }) };
      if (k.origin === 'bundled') return { ok: false, code: 'bundled', message: translate('plugins.uninstall.bundled', { name: nameOf(id) }) };
      deactivate(id);
      known.delete(id);
      restartPending.delete(id);
      await fsp.rm(path.join(opts.roots.installed, id), { recursive: true, force: true });
      if (!keepData) await opts.dropData?.(id);
      log(id, 'info', `Désinstallé${keepData ? ' (données gardées)' : ''}.`);
      // Le dossier installé n'est plus là : ce qui reste sous cet identifiant est la version incluse, s'il y en a une.
      const bundled = discoverPlugins(opts.roots).candidates.find((c) => c.id === id);
      if (!bundled) {
        state.forget(id);
        return { ok: true, keptData: keepData, restored: null };
      }
      // La version incluse garde l'état voulu (actif ou non) ; l'erreur éventuelle de la version retirée est oubliée.
      state.setEnabled(id, state.get(id).enabled);
      const back = await examine(bundled);
      const problem = back.plugin && checkPresent([...known.values()].flatMap((x) => (x.plugin && !x.refusal ? [nodeOf(x.plugin)] : []))).problems.get(id);
      if (problem) back.refusal = dependencyRefusal(problem);
      if (!back.refusal && state.get(id).enabled) await activate(id);
      return { ok: true, keptData: keepData, restored: info(back) };
    },

    /** Contributions actives d'une nature (registre). */
    contributions: (kind: ContributionKind): ContributionEntry[] => registry.list(kind),
    onContributionsChange: registry.onChange,

    /**
     * Appelle une méthode d'une contribution de code active (« même API par messages ») : sources, infos en ligne,
     * recherche… Une erreur du plugin le désactive.
     */
    call(
      pluginId: string,
      kind: ContributionKind,
      contributionId: string,
      method: string,
      args: unknown[] = [],
      options: { timeout?: number } = {},
    ): Promise<unknown> {
      return call(pluginId, `${kind}/${contributionId}`, method, args, options);
    },

    /**
     * `webExtensions` ou `downloaders` des plugins actifs, à brancher au démarrage (vues web, téléchargements). Code
     * sensible : seulement un plugin `privileged` livré avec Mire (règle de P3-03), qui tourne dans ce processus.
     */
    local(kind: 'webExtensions' | 'downloaders'): LocalContribution[] {
      return [...active.values()].flatMap(({ plugin: p, runner }) => {
        if (p.manifest.level !== 'privileged' || known.get(p.id)?.origin !== 'bundled' || !runner?.local) return [];
        return (p.manifest.contributes[kind] ?? []).flatMap((c) => {
          const instance = runner.local!.get(`${kind}/${c.id}`);
          return instance ? [{ pluginId: p.id, id: c.id, instance }] : [];
        });
      });
    },

    /** Niveau d'un plugin actif (`null` sinon) : les ponts appliquent ses règles aux résultats qu'il rend. */
    levelOf: (id: string) => active.get(id)?.plugin.manifest.level ?? null,

    /** Tags automatiques des plugins actifs, pour le moteur de tags. */
    taggerContributors: (): Contributor[] => taggers.contributors(),

    /** Événement de Mire transmis aux plugins actifs (`ctx.events.on`). */
    emit(name: string, payload?: unknown): void {
      for (const a of active.values()) a.runner?.channel.event('event', { name, payload });
    },

    /**
     * Change un réglage déclaré d'un plugin (`null` : valeur par défaut) ; le plugin actif le voit aussitôt
     * (`ctx.settings.get`, `onChange`). Pour les réglages des plugins (P4-20). Une erreur ne cite jamais la valeur.
     */
    setSetting(id: string, key: string, value: unknown): void {
      const p = known.get(id)?.plugin;
      if (!p || !opts.settings) throw new ChannelError(CHANNEL_ERRORS.notFound, `${id} has no settings.`);
      opts.settings.set(id, p.manifest.settings ?? [], key, value);
      const v = opts.settings.values(id, p.manifest.settings)[key];
      active.get(id)?.runner?.channel.event('settings', { key, value: v });
    },

    /**
     * Plugins qui déclarent des réglages, pour l'écran Réglages (P4-20) : leurs déclarations, et leurs valeurs sans
     * celles des secrets (`view` de `settings.ts`). Les textes sont dans les catalogues (`pluginTexts.<id>.settings.…`).
     */
    settingsList(): PluginSettingsInfo[] {
      return [...known.values()].flatMap((k) => {
        const declared = k.plugin?.manifest.settings ?? [];
        if (!declared.length) return [];
        const { values, secrets } = opts.settings?.view(k.id, declared) ?? { values: {}, secrets: [] };
        return [{ id: k.id, name: nameOf(k.id), settings: structuredClone(declared), values, secrets }];
      });
    },

    /** Dossiers accordés à un plugin (`ctx.files`). */
    folders: (id: string): string[] => state.folders(id),
    /** Accorde un dossier à un plugin, comme s'il l'avait demandé (`ctx.files.requestFolder`) et que l'utilisateur l'avait choisi. */
    grantFolder: (id: string, dir: string): void => state.addFolder(id, path.resolve(dir)),
    revokeFolder: (id: string, dir: string): void => state.removeFolder(id, dir),

    /** Fermeture de Mire : tout s'arrête, l'état et le stockage des plugins sont écrits. */
    async stop(): Promise<void> {
      stopped = true;
      if (watchdogTimer) clearInterval(watchdogTimer);
      for (const a of active.values()) a.runner?.stop();
      active.clear();
      runners.shutdown();
      await Promise.all([state.flush(), opts.flush?.()]);
    },
  };
}

export type PluginService = ReturnType<typeof createPluginService>;
