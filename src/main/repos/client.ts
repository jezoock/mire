/**
 * Client des dépôts (P3-07) : ce que l'interface (le Centre, P4-18) demande sur les plugins des dépôts.
 * - plugins disponibles d'après les index vérifiés (en ligne ou en cache), avec leur origine, leur niveau, leurs
 *   permissions, leurs dépendances, la version installée et la mise à jour proposée ;
 * - installation avec les dépendances (`resolveInstall` de P3-05), mise à jour, désinstallation (hôte de plugins) ;
 * - une opération à la fois, en transaction : tout est téléchargé et vérifié avant que rien ne soit remplacé ; si un
 *   plugin est refusé par l'hôte après sa mise en place, toute l'opération revient à l'état d'avant ;
 * - progression envoyée à l'interface (`onProgress`), sans texte : l'interface rédige (comme la boutique).
 *
 * Dépôts tiers et confiance (P3-08) :
 * - un identifiant appartient au dépôt qui l'a installé (`origin.json`) ; un plugin inclus ou installé à la main
 *   appartient au dépôt officiel. Seul ce dépôt le met à jour ; aucun autre ne peut le remplacer ;
 * - les versions d'un plugin viennent d'un seul dépôt (jamais un mélange) ; un plugin pas encore installé vient du
 *   dépôt demandé, sinon du dépôt officiel, sinon du premier dépôt tiers qui le propose ;
 * - une dépendance pas encore installée vient du dépôt officiel, sinon du dépôt du plugin demandé ;
 * - un plugin tiers de code sensible n'est installé qu'avec l'accord de l'utilisateur pour cette version précise
 *   (`consent`) ; une mise à jour qui ne demande rien de plus garde l'accord de la version installée ;
 * - ajout d'un dépôt tiers (index vérifié avec sa clé, empreinte confirmée) et retrait (plugins gardés sans mise à
 *   jour, ou désinstallés).
 */
import type {
  AvailablePlugin,
  PluginConsentRequest,
  PluginsOutcome,
  PluginsProgress,
  PluginSummary,
  RepositoryInfo,
  RepositoryOutcome,
  RepositoryRemoveOutcome,
} from '@mire/shared/ipc';
import { resolveInstall, type DependencyNode, type DependencyProblem } from '../plugins/dependencies.ts';
import { compareVersions, parseVersion, satisfies } from '../plugins/semver.ts';
import { RepoError, repoErrorCode } from './errors.ts';
import type { IndexVersion, Localized } from './index-file.ts';
import type { Committed, InstallItem, Installer } from './installer.ts';
import { OFFICIAL_REPOSITORY } from './official.ts';
import type { Repositories } from './repositories.ts';
import {
  checkIndexUrl,
  isSensitive,
  keyFingerprint,
  MAX_REPOSITORIES,
  thirdPartyId,
  toConfig,
  type ConsentRequest,
  type ThirdPartyRepository,
  type TrustStore,
} from './trust.ts';

/** Ce que le client utilise de l'hôte de plugins. */
export interface PluginHost {
  list(): PluginSummary[];
  reload(ids: readonly string[]): Promise<PluginSummary[]>;
  uninstall(id: string, opts: { keepData: boolean }): Promise<{ ok: true } | { ok: false; code: string; by?: string[] } | null>;
}

/** Accord nécessaire avant d'installer : les versions concernées, plugin par plugin. */
export class ConsentError extends RepoError {
  requests: ConsentRequest[];

  constructor(requests: ConsentRequest[]) {
    super('consent', `Consent needed: ${requests.map((r) => `${r.plugin} ${r.version} (${r.repository})`).join(', ')}`, {});
    this.requests = requests;
  }
}

export interface RepoClientOptions {
  repositories: Repositories;
  installer: Installer;
  plugins: PluginHost;
  appVersion: string;
  locale(): string;
  translate(key: string, vars?: Record<string, string | number>): string;
  onProgress?(p: PluginsProgress): void;
  log?(message: string): void;
  /** Dépôts tiers et accords (P3-08) ; sans lui, aucun dépôt tiers ni aucun accord. */
  trust?: TrustStore;
}

interface Offer {
  repository: string;
  official: boolean;
  entry: IndexVersion;
}

const byVersionDesc = (a: string, b: string) => compareVersions(parseVersion(b)!, parseVersion(a)!);

const OFFICIAL = OFFICIAL_REPOSITORY.id;

export function createRepoClient(opts: RepoClientOptions) {
  const log = opts.log ?? ((m: string) => console.error(m));
  let busy = false;

  const pick = (texts: Localized | undefined): string | null => texts?.[opts.locale()] ?? texts?.en ?? null;
  const compatible = (e: IndexVersion) => satisfies(opts.appVersion, e.engines.mire);

  /** Index utilisables, dépôt officiel d'abord, puis les dépôts tiers dans l'ordre où ils ont été ajoutés. */
  const indexes = () => [...opts.repositories.indexes()].sort((a, b) => Number(b.config.official) - Number(a.config.official));

  /** Versions d'un plugin publiées par un dépôt, de la plus récente à la plus ancienne. */
  function offers(id: string, repository: string | null): Offer[] {
    const r = indexes().find(({ config }) => config.id === repository);
    const p = r?.index.plugins.find((x) => x.id === id);
    if (!r || !p) return [];
    return p.versions
      .map((entry) => ({ repository: r.config.id, official: r.config.official, entry }))
      .sort((a, b) => byVersionDesc(a.entry.version, b.entry.version));
  }

  const has = (id: string, repository: string) => offers(id, repository).length > 0;
  /** Dépôts qui proposent ce plugin, dans l'ordre de préférence. */
  const reposWith = (id: string): string[] => indexes().flatMap(({ config, index }) => (index.plugins.some((p) => p.id === id) ? [config.id] : []));

  const installedOf = (list: PluginSummary[], id: string) => list.find((p) => p.id === id && p.version && p.status !== 'refused') ?? null;
  /** Dépôt propriétaire d'un plugin présent (même refusé) : celui qui l'a installé ; inclus ou à la main : l'officiel. */
  const ownerOf = (list: PluginSummary[], id: string): string | null => {
    const here = list.find((p) => p.id === id);
    return here ? (here.repository ?? OFFICIAL) : null;
  };

  /** Dépôt d'où vient `id` : son propriétaire s'il est présent, sinon `preferred`, l'officiel, ou le premier qui l'a. */
  function sourceOf(list: PluginSummary[], id: string, preferred: string | null): string | null {
    const owner = ownerOf(list, id);
    if (owner) return owner;
    if (preferred && has(id, preferred)) return preferred;
    return reposWith(id)[0] ?? null;
  }

  /** Ce que l'utilisateur accepte : d'après l'index vérifié (identique au manifeste installé), jamais d'après le paquet. */
  const consentFor = (id: string, o: Offer): ConsentRequest => ({
    plugin: id,
    repository: o.repository,
    version: o.entry.version,
    level: o.entry.level,
    permissions: structuredClone(o.entry.permissions),
  });
  const needsConsent = (o: Offer) => !o.official && isSensitive(o.entry.level, o.entry.permissions);

  function available(): AvailablePlugin[] {
    const list = opts.plugins.list();
    const out: AvailablePlugin[] = [];
    for (const { config, index } of indexes()) {
      for (const { id } of [...index.plugins].sort((a, b) => a.id.localeCompare(b.id))) {
        const all = offers(id, config.id);
        const best = all.find((o) => compatible(o.entry)) ?? null;
        const shown = best ?? all[0];
        const owner = ownerOf(list, id);
        const mine = owner === config.id;
        const installed = mine ? installedOf(list, id) : null;
        const update = best && installed?.version && byVersionDesc(installed.version, best.entry.version) > 0 ? best.entry.version : null;
        const sensitive = needsConsent(shown);
        out.push({
          id,
          repository: config.id,
          official: config.official,
          trust: config.official ? 'official' : 'third-party',
          name: pick(shown.entry.name) ?? id,
          description: pick(shown.entry.description),
          version: best?.entry.version ?? null,
          latest: all[0].entry.version,
          level: shown.entry.level,
          permissions: structuredClone(shown.entry.permissions),
          dependencies: { ...shown.entry.dependencies },
          contributes: [...shown.entry.contributes],
          size: shown.entry.package.size,
          installed: installed?.version ?? null,
          update,
          sensitive,
          consented: sensitive ? !!opts.trust?.consented(consentFor(id, shown)) : true,
          conflict: owner !== null && !mine,
        });
      }
    }
    return out;
  }

  function progress(p: PluginsProgress): void {
    try {
      opts.onProgress?.(p);
    } catch {
      // L'interface fermée ne doit pas interrompre une installation.
    }
  }

  function failure(err: unknown, id: string): PluginsOutcome {
    const code = repoErrorCode(err);
    const vars = err instanceof RepoError ? err.vars : {};
    const name = available().find((p) => p.id === id)?.name ?? id;
    const out: PluginsOutcome = { ok: false, code, error: opts.translate(`repos.errors.${code}`, { name, ...vars }) };
    if (err instanceof ConsentError) out.consent = err.requests.map((r) => structuredClone(r) as PluginConsentRequest);
    return out;
  }

  function dependencyError(problem: DependencyProblem): RepoError {
    const dependency = problem.code === 'cycle' ? problem.cycle.join(' → ') : problem.dependency;
    return new RepoError('dependency', `Dependencies: ${JSON.stringify(problem)}`, { dependency });
  }

  /**
   * Plugins à installer pour `id` (dans la plage `range`, depuis `repository`), dépendances d'abord ; ceux déjà
   * présents sont omis.
   */
  function plan(id: string, range: string, repository: string | null): (InstallItem & { version: string })[] {
    const list = opts.plugins.list();
    const owner = ownerOf(list, id);
    if (owner && repository && owner !== repository)
      throw new RepoError('owner', `${id} belongs to ${owner}, not ${repository}.`, { repository: repositoryName(owner) });
    const source = sourceOf(list, id, repository);
    const all = offers(id, source);
    if (!all.length) {
      if (owner && !opts.repositories.indexes().some((r) => r.config.id === owner))
        throw new RepoError('repository', `${id}: repository ${owner} is not configured.`);
      throw new RepoError('unknown', `${id}: not in the repositories.`);
    }
    if (!all.some((o) => compatible(o.entry) && satisfies(o.entry.version, range))) {
      if (all.some((o) => satisfies(o.entry.version, range)))
        throw new RepoError('engine', `${id} ${range}: no version compatible with Mire ${opts.appVersion}.`);
      throw new RepoError('unknown', `${id} ${range}: version not in the repositories.`);
    }
    // Dépôt de chaque plugin du plan : le demandé vient de `source` ; une dépendance de son propriétaire, sinon du
    // dépôt officiel, sinon du même dépôt que le plugin demandé.
    const from = (x: string): string | null => (x === id ? source : (ownerOf(list, x) ?? (has(x, OFFICIAL) ? OFFICIAL : source)));
    const result = resolveInstall(id, range, {
      available: (x) => {
        const fromRepos: DependencyNode[] = offers(x, from(x))
          .filter((o) => compatible(o.entry))
          .map((o) => ({ id: x, version: o.entry.version, dependencies: o.entry.dependencies }));
        const here = installedOf(list, x);
        // Un plugin présent mais absent des dépôts (inclus, installé à la main) reste utilisable comme dépendance.
        return here?.version && !fromRepos.some((n) => n.version === here.version)
          ? [...fromRepos, { id: x, version: here.version, dependencies: {} }]
          : fromRepos;
      },
      // Le plugin demandé prend la plus haute version qui convient ; ses dépendances gardent la leur si elle convient.
      installed: (x) => (x === id ? null : (installedOf(list, x)?.version ?? null)),
    });
    if (!result.ok) throw dependencyError(result.problem);
    return result.order
      .filter((n) => installedOf(list, n.id)?.version !== n.version)
      .map((n) => {
        const o = offers(n.id, from(n.id)).find((x) => x.entry.version === n.version)!;
        return { id: n.id, version: n.version, entry: o.entry, repository: o.repository, official: o.official };
      });
  }

  /**
   * Accords qui manquent pour les plugins tiers de code sensible du plan. Une mise à jour qui ne demande rien de plus
   * que la version installée (du même dépôt) garde son accord : il est noté pour la nouvelle version (`carried`).
   */
  function consents(items: InstallItem[]): { missing: ConsentRequest[]; carried: ConsentRequest[] } {
    const list = opts.plugins.list();
    const missing: ConsentRequest[] = [];
    const carried: ConsentRequest[] = [];
    for (const item of items) {
      const o: Offer = { repository: item.repository, official: item.official, entry: item.entry };
      if (!needsConsent(o)) continue;
      const r = consentFor(item.id, o);
      if (opts.trust?.consented(r)) continue;
      const here = list.find((p) => p.id === item.id && p.repository === item.repository && p.version);
      if (here?.version && opts.trust?.carried(r, here.version)) carried.push(r);
      else missing.push(r);
    }
    return { missing, carried };
  }

  const repositoryName = (id: string): string => repositoriesInfo().find((r) => r.id === id)?.name ?? id;

  /** Installe `id` (dans la plage `range`, depuis `repository`) et ses dépendances, en transaction. */
  async function run(id: string, range: string, repository: string | null): Promise<PluginsOutcome> {
    if (busy) return failure(new RepoError('busy', 'An installation is already running.'), id);
    busy = true;
    const prepared: { item: InstallItem; staging: string }[] = [];
    const committed: Committed[] = [];
    try {
      progress({ id, phase: 'resolve' });
      const items = plan(id, range, repository);
      const { missing, carried } = consents(items);
      if (missing.length) throw new ConsentError(missing);
      for (const item of items) {
        const staging = await opts.installer.prepare(item, (phase, received, total) =>
          progress({ id, plugin: item.id, version: item.entry.version, phase, received, total }),
        );
        prepared.push({ item, staging });
      }
      progress({ id, phase: 'install' });
      // Noté avant le chargement : l'hôte de plugins vérifie l'accord de la version qu'il charge.
      for (const r of carried) opts.trust?.grant(r);
      for (const { item, staging } of prepared) committed.push(await opts.installer.commit(item, staging));
      prepared.length = 0;
      const ids = committed.map((c) => c.id);
      const after = await opts.plugins.reload(ids);
      const refused = after.find((p) => p.status === 'refused');
      if (refused || after.length !== ids.length) {
        await undo(committed);
        await opts.plugins.reload(ids);
        const who = refused?.id ?? ids.find((x) => !after.some((p) => p.id === x)) ?? id;
        throw new RepoError('refused', `${who} refused after installation: ${refused?.message ?? 'not found'}`, { details: refused?.message ?? '' });
      }
      for (const c of committed) await opts.installer.finish(c);
      for (const c of committed) log(`Dépôts : ${c.id} ${c.version} installé.`);
      progress({ id, phase: 'done' });
      return { ok: true, plugins: opts.plugins.list() };
    } catch (err) {
      for (const p of prepared) await opts.installer.discard(p.staging).catch(() => {});
      if (committed.length && !(err instanceof RepoError && err.code === 'refused')) {
        await undo(committed);
        await opts.plugins.reload(committed.map((c) => c.id)).catch(() => []);
      }
      log(`Dépôts : installation de ${id} annulée (${(err as Error).message}).`);
      const out = failure(err, id);
      progress({ id, phase: 'error', message: out.ok ? undefined : out.error });
      return out;
    } finally {
      busy = false;
    }
  }

  async function undo(committed: Committed[]): Promise<void> {
    for (const c of [...committed].reverse()) {
      await opts.installer.rollback(c).catch((err: Error) => log(`Dépôts : retour arrière de ${c.id} incomplet (${err.message}).`));
    }
  }

  /** Dépôts configurés et état de leur index, sans réseau. */
  function repositoriesInfo(): RepositoryInfo[] {
    return opts.repositories.status().map((s) => ({
      ...s,
      trust: s.official ? ('official' as const) : ('third-party' as const),
      name: pick(s.name ?? undefined) ?? s.id,
      message: s.error ? opts.translate(`repos.errors.${s.error}`, { name: pick(s.name ?? undefined) ?? s.id }) : null,
    }));
  }

  /** Une opération à la fois (installations, ajout et retrait de dépôts). */
  async function exclusive<T>(fail: (err: unknown) => NoInfer<T>, fn: () => Promise<T>): Promise<T> {
    if (busy) return fail(new RepoError('busy', 'An operation is already running.'));
    busy = true;
    try {
      return await fn();
    } catch (err) {
      return fail(err);
    } finally {
      busy = false;
    }
  }

  const repoFailure =
    (name: string) =>
    (err: unknown): { ok: false; code: string; error: string } => {
      const code = repoErrorCode(err);
      if (!(err instanceof RepoError)) log(`Dépôts : ${(err as Error)?.message ?? err}`);
      const vars = err instanceof RepoError ? err.vars : {};
      return { ok: false, code, error: opts.translate(`repos.errors.${code}`, { name, ...vars }) };
    };

  /**
   * Vérifie un dépôt tiers avant son ajout : adresse `https:`, clé PEM ed25519, ni le dépôt officiel ni un dépôt déjà
   * configuré, index téléchargé et vérifié avec cette clé (préfixe `mire.` refusé). Rend ce qu'il faut montrer.
   */
  async function inspect(
    indexUrl: string,
    publicKey: string,
  ): Promise<{ config: ThirdPartyRepository; preview: RepositoryOutcome & { ok: true }; bytes: Buffer }> {
    const index = checkIndexUrl(indexUrl);
    if (!index) throw new RepoError('url', `Index address refused: ${indexUrl}`);
    const fingerprint = keyFingerprint(publicKey);
    if (!fingerprint) throw new RepoError('key', 'Public key refused: PEM of an ed25519 key expected.');
    if (!opts.trust) throw new RepoError('repository', 'Third-party repositories are not available.');
    const id = thirdPartyId(fingerprint);
    const existing = [OFFICIAL_REPOSITORY, ...opts.trust.repositories().map(toConfig)];
    if (existing.some((r) => r.index === index || keyFingerprint(r.publicKey) === fingerprint))
      throw new RepoError('exists', `Repository already configured: ${index}`);
    if (opts.trust.repositories().length >= MAX_REPOSITORIES) throw new RepoError('limit', 'Too many third-party repositories.');
    const config: ThirdPartyRepository = { id, index, publicKey: publicKey.trim() + '\n', fingerprint, addedAt: Date.now() };
    const { index: parsed, bytes } = await opts.repositories.probe(toConfig(config));
    const latest = parsed.plugins.map((p) => p.versions[0]).filter((v) => !!v);
    return {
      config,
      bytes,
      preview: {
        ok: true,
        repository: {
          id,
          index,
          fingerprint,
          name: pick(parsed.repository.name) ?? id,
          plugins: parsed.plugins.length,
          sensitive: latest.filter((v) => isSensitive(v.level, v.permissions)).length,
        },
        repositories: repositoriesInfo(),
      },
    };
  }

  /** Retire un dépôt tiers ; avec `uninstall`, ses plugins sont désinstallés (sauf ceux dont un autre a besoin). */
  async function removeRepository(id: string, uninstall: boolean, keepData: boolean): Promise<RepositoryRemoveOutcome> {
    const r = opts.trust?.get(id);
    if (!r) throw new RepoError('repository', `Repository not configured: ${id}`);
    const uninstalled: string[] = [];
    const kept: { id: string; by: string[] }[] = [];
    if (uninstall) {
      // Plusieurs passes : un plugin dont un autre plugin du même dépôt a besoin part après lui.
      let pending = opts.plugins
        .list()
        .filter((p) => p.repository === id)
        .map((p) => p.id);
      let progressed = true;
      while (pending.length && progressed) {
        progressed = false;
        const next: string[] = [];
        for (const pluginId of pending) {
          const out = await opts.plugins.uninstall(pluginId, { keepData });
          if (out?.ok) {
            uninstalled.push(pluginId);
            opts.trust?.revoke(pluginId, id);
            progressed = true;
          } else next.push(pluginId);
        }
        pending = next;
      }
      for (const pluginId of pending) {
        const out = await opts.plugins.uninstall(pluginId, { keepData });
        kept.push({ id: pluginId, by: out && !out.ok ? (out.by ?? []) : [] });
      }
    }
    opts.trust!.remove(id);
    await opts.repositories.drop(id);
    log(`Dépôts : dépôt ${id} retiré (${uninstall ? `${uninstalled.length} plugin(s) désinstallé(s)` : 'plugins gardés'}).`);
    return { ok: true, uninstalled, kept, repositories: repositoriesInfo() };
  }

  return {
    /** Met à jour les index des dépôts (réseau) ; sans réseau, le cache sert. */
    async refresh(): Promise<RepositoryInfo[]> {
      await opts.repositories.refresh();
      return repositoriesInfo();
    },

    repositories: repositoriesInfo,

    available,
    /** Plugins installés pour lesquels leur dépôt propose une version plus récente compatible. */
    updates: (): AvailablePlugin[] => available().filter((p) => p.update),

    /** Le plugin est-il connu des dépôts (vérification des arguments de l'IPC) ? */
    knows: (id: string): boolean => reposWith(id).length > 0,
    /** Le dépôt est-il configuré (vérification des arguments de l'IPC) ? */
    hasRepository: (id: string): boolean => opts.repositories.status().some((r) => r.id === id),

    /** Installe un plugin (une version précise, ou la plus récente compatible) avec ses dépendances. */
    install: (id: string, version?: string, repository?: string): Promise<PluginsOutcome> => run(id, version ?? '*', repository ?? null),

    /** Met à jour un plugin installé vers la plus récente version compatible de son dépôt. */
    async update(id: string): Promise<PluginsOutcome> {
      const list = opts.plugins.list();
      if (!installedOf(list, id)) return failure(new RepoError('unknown', `${id} is not installed.`), id);
      return run(id, '*', ownerOf(list, id));
    },

    /**
     * Accord de l'utilisateur pour une version d'un plugin tiers de code sensible, après l'avertissement renforcé. Ce
     * qui est accepté (niveau, permissions) vient de l'index vérifié du dépôt. `null` : rien à accepter.
     */
    consent(id: string, repository: string, version: string): PluginConsentRequest | null {
      const o = offers(id, repository).find((x) => x.entry.version === version);
      if (!o || !needsConsent(o) || !opts.trust) return null;
      const r = consentFor(id, o);
      opts.trust.grant(r);
      log(`Dépôts : accord donné pour ${id} ${version} (${repository}).`);
      return structuredClone(r) as PluginConsentRequest;
    },

    /** Vérifie un dépôt tiers sans l'ajouter : son nom, l'empreinte de sa clé, ce qu'il propose. */
    inspectRepository: (indexUrl: string, publicKey: string): Promise<RepositoryOutcome> =>
      exclusive<RepositoryOutcome>(repoFailure(indexUrl), async () => (await inspect(indexUrl, publicKey)).preview),

    /**
     * Ajoute un dépôt tiers. `fingerprint` est l'empreinte que l'utilisateur a vue (`inspectRepository`) : elle doit
     * être celle de la clé, sinon rien n'est ajouté.
     */
    addRepository: (indexUrl: string, publicKey: string, fingerprint: string): Promise<RepositoryOutcome> =>
      exclusive<RepositoryOutcome>(repoFailure(indexUrl), async () => {
        const { config, preview, bytes } = await inspect(indexUrl, publicKey);
        if (fingerprint !== config.fingerprint) throw new RepoError('fingerprint', `Fingerprint ${fingerprint} differs from the key's.`);
        opts.trust!.add(config);
        await opts.repositories.seed(toConfig(config), bytes);
        log(`Dépôts : dépôt ${config.id} ajouté (${config.index}, clé ${config.fingerprint}).`);
        return { ...preview, repositories: repositoriesInfo() };
      }),

    removeRepository: (id: string, { uninstall, keepData }: { uninstall: boolean; keepData: boolean }): Promise<RepositoryRemoveOutcome> =>
      exclusive<RepositoryRemoveOutcome>(repoFailure(repositoryName(id)), () => removeRepository(id, uninstall, keepData)),
  };
}

export type RepoClient = ReturnType<typeof createRepoClient>;
