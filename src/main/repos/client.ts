/**
 * Client des dépôts (P3-07) : ce que l'interface (le Centre, P4-18) demande sur les plugins des dépôts.
 * - plugins disponibles d'après les index vérifiés (en ligne ou en cache), avec leur origine, leur niveau, leurs
 *   permissions, leurs dépendances, la version installée et la mise à jour proposée ;
 * - installation avec les dépendances (`resolveInstall` de P3-05), mise à jour, désinstallation (hôte de plugins) ;
 * - une opération à la fois, en transaction : tout est téléchargé et vérifié avant que rien ne soit remplacé ; si un
 *   plugin est refusé par l'hôte après sa mise en place, toute l'opération revient à l'état d'avant ;
 * - progression envoyée à l'interface (`onProgress`), sans texte : l'interface rédige (comme la boutique).
 */
import type { AvailablePlugin, PluginsOutcome, PluginsProgress, PluginSummary, RepositoryInfo } from '@mire/shared/ipc';
import { resolveInstall, type DependencyNode, type DependencyProblem } from '../plugins/dependencies.ts';
import { compareVersions, parseVersion, satisfies } from '../plugins/semver.ts';
import { RepoError, repoErrorCode } from './errors.ts';
import type { IndexVersion, Localized } from './index-file.ts';
import type { Committed, InstallItem, Installer } from './installer.ts';
import type { Repositories } from './repositories.ts';

/** Ce que le client utilise de l'hôte de plugins. */
export interface PluginHost {
  list(): PluginSummary[];
  reload(ids: readonly string[]): Promise<PluginSummary[]>;
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
}

interface Offer {
  repository: string;
  official: boolean;
  entry: IndexVersion;
}

const byVersionDesc = (a: string, b: string) => compareVersions(parseVersion(b)!, parseVersion(a)!);

export function createRepoClient(opts: RepoClientOptions) {
  const log = opts.log ?? ((m: string) => console.error(m));
  let busy = false;

  const pick = (texts: Localized | undefined): string | null => texts?.[opts.locale()] ?? texts?.en ?? null;
  const compatible = (e: IndexVersion) => satisfies(opts.appVersion, e.engines.mire);

  /**
   * Versions publiées d'un plugin, tous dépôts confondus (dépôt officiel d'abord), de la plus récente à la plus ancienne ;
   * `officialOnly` : celles du dépôt officiel seulement (installations de la continuité, P5-01).
   */
  function offers(id: string, officialOnly = false): Offer[] {
    const out: Offer[] = [];
    const indexes = [...opts.repositories.indexes()]
      .filter((x) => !officialOnly || x.config.official)
      .sort((a, b) => Number(b.config.official) - Number(a.config.official));
    for (const { config, index } of indexes) {
      const p = index.plugins.find((x) => x.id === id);
      for (const entry of p?.versions ?? [])
        if (!out.some((o) => o.entry.version === entry.version)) out.push({ repository: config.id, official: config.official, entry });
    }
    return out.sort((a, b) => byVersionDesc(a.entry.version, b.entry.version));
  }

  const installedOf = (list: PluginSummary[], id: string) => list.find((p) => p.id === id && p.version && p.status !== 'refused') ?? null;

  function available(): AvailablePlugin[] {
    const list = opts.plugins.list();
    const ids = new Set(opts.repositories.indexes().flatMap(({ index }) => index.plugins.map((p) => p.id)));
    return [...ids].sort().map((id) => {
      const all = offers(id);
      const best = all.find((o) => compatible(o.entry)) ?? null;
      const shown = best ?? all[0];
      const installed = installedOf(list, id);
      const update = best && installed?.version && byVersionDesc(installed.version, best.entry.version) > 0 ? best.entry.version : null;
      return {
        id,
        repository: shown.repository,
        official: shown.official,
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
      };
    });
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
    return { ok: false, code, error: opts.translate(`repos.errors.${code}`, { name, ...vars }) };
  }

  function dependencyError(problem: DependencyProblem): RepoError {
    const dependency = problem.code === 'cycle' ? problem.cycle.join(' → ') : problem.dependency;
    return new RepoError('dependency', `Dependencies: ${JSON.stringify(problem)}`, { dependency });
  }

  /** Plugins à installer pour `id` (dans la plage `range`), dépendances d'abord ; ceux déjà présents sont omis. */
  function plan(id: string, range: string, officialOnly: boolean): (InstallItem & { version: string })[] {
    const list = opts.plugins.list();
    const all = offers(id, officialOnly);
    if (!all.length) throw new RepoError('unknown', `${id}: not in the repositories.`);
    if (!all.some((o) => compatible(o.entry) && satisfies(o.entry.version, range))) {
      if (all.some((o) => satisfies(o.entry.version, range)))
        throw new RepoError('engine', `${id} ${range}: no version compatible with Mire ${opts.appVersion}.`);
      throw new RepoError('unknown', `${id} ${range}: version not in the repositories.`);
    }
    const result = resolveInstall(id, range, {
      available: (x) => {
        const fromRepos: DependencyNode[] = offers(x, officialOnly)
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
        const o = offers(n.id, officialOnly).find((x) => x.entry.version === n.version)!;
        return { id: n.id, version: n.version, entry: o.entry, repository: o.repository, official: o.official };
      });
  }

  /** Installe `id` (dans la plage `range`) et ses dépendances, en transaction. */
  async function run(id: string, range: string, officialOnly = false): Promise<PluginsOutcome> {
    if (busy) return failure(new RepoError('busy', 'An installation is already running.'), id);
    busy = true;
    const prepared: { item: InstallItem; staging: string }[] = [];
    const committed: Committed[] = [];
    try {
      progress({ id, phase: 'resolve' });
      const items = plan(id, range, officialOnly);
      for (const item of items) {
        const staging = await opts.installer.prepare(item, (phase, received, total) =>
          progress({ id, plugin: item.id, version: item.entry.version, phase, received, total }),
        );
        prepared.push({ item, staging });
      }
      progress({ id, phase: 'install' });
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

  return {
    /** Met à jour les index des dépôts (réseau) ; sans réseau, le cache sert. */
    async refresh(): Promise<RepositoryInfo[]> {
      await opts.repositories.refresh();
      return this.repositories();
    },

    /** Dépôts configurés et état de leur index, sans réseau. */
    repositories(): RepositoryInfo[] {
      return opts.repositories.status().map((s) => ({
        ...s,
        name: pick(s.name ?? undefined) ?? s.id,
        message: s.error ? opts.translate(`repos.errors.${s.error}`, { name: pick(s.name ?? undefined) ?? s.id }) : null,
      }));
    },

    available,
    /** Plugins installés pour lesquels un dépôt propose une version plus récente compatible. */
    updates: (): AvailablePlugin[] => available().filter((p) => p.update),

    /** Le plugin est-il connu des dépôts (vérification des arguments de l'IPC) ? */
    knows: (id: string): boolean => offers(id).length > 0,

    /** Installe un plugin (une version précise, ou la plus récente compatible) avec ses dépendances. */
    install: (id: string, version?: string): Promise<PluginsOutcome> => run(id, version ?? '*'),

    /**
     * Installe un plugin et ses dépendances depuis le dépôt officiel seulement (continuité, P5-01) : même transaction,
     * mêmes vérifications que `install`.
     */
    installOfficial: (id: string): Promise<PluginsOutcome> => run(id, '*', true),

    /** Met à jour un plugin installé vers la plus récente version compatible. */
    async update(id: string): Promise<PluginsOutcome> {
      if (!installedOf(opts.plugins.list(), id)) return failure(new RepoError('unknown', `${id} is not installed.`), id);
      return run(id, '*');
    },
  };
}

export type RepoClient = ReturnType<typeof createRepoClient>;
