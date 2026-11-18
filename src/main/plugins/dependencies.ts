/**
 * Dépendances entre plugins (D-19, architecture cible « Plugins inclus, plugins à installer ») : un plugin déclare
 * dans `dependencies` les autres plugins dont il a besoin, avec une plage de versions semver (`satisfies` de
 * `semver.ts`). Ce module ne touche à aucun fichier :
 * - `checkPresent` vérifie les plugins présents au démarrage (une version de chacun) : dépendance absente, version qui
 *   ne convient pas, dépendance circulaire, ou dépendance elle-même refusée ; et rend l'ordre d'activation ;
 * - `resolveInstall` choisit les versions à installer avec un plugin, parmi celles connues (installées, incluses, et
 *   celles des dépôts avec P3-07), dans l'ordre d'installation, ou dit pourquoi c'est impossible ;
 * - `dependentsOf` dit quels plugins ont besoin d'un autre (refus de désinstaller).
 */
import { compareVersions, parseVersion, satisfies } from './semver.ts';

/** Ce qu'il faut savoir d'une version d'un plugin. */
export interface DependencyNode {
  id: string;
  version: string;
  /** Identifiant → plage de versions (`dependencies` du manifeste). */
  dependencies: Readonly<Record<string, string>>;
}

/** Demande d'une dépendance : par qui (`null` : l'utilisateur), quelle plage. */
export interface Requirement {
  by: string | null;
  range: string;
}

/** Raison stable d'un refus ; les messages viennent des catalogues (`plugins.refused.dependency`, `.cycle`). */
export type DependencyProblem =
  /** `id` a besoin de `dependency` dans la plage `range` : absent, ou aucune version ne convient. */
  | { code: 'missing'; id: string | null; dependency: string; range: string }
  /** Plusieurs plugins demandent `dependency` dans des plages qu'aucune version ne satisfait ensemble. */
  | { code: 'conflict'; dependency: string; requirements: Requirement[] }
  /** Les plugins de `cycle` dépendent les uns des autres (le premier est répété à la fin). */
  | { code: 'cycle'; cycle: string[] }
  /** `id` a besoin de `dependency`, présent mais refusé (invalide, incompatible, ou ses propres dépendances). */
  | { code: 'refused'; id: string; dependency: string };

const deps = (n: DependencyNode): [string, string][] => Object.entries(n.dependencies ?? {});
const byVersionDesc = (a: DependencyNode, b: DependencyNode) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!);

/**
 * Ordre « dépendances d'abord » des nœuds donnés (à égalité, par identifiant), ou le premier cycle trouvé. Les
 * dépendances absentes de `nodes` sont ignorées ici (vérifiées ailleurs).
 */
export function dependencyOrder(nodes: readonly DependencyNode[]): { order: DependencyNode[]; cycle: string[] | null } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const path: string[] = [];
  const order: DependencyNode[] = [];
  const visit = (id: string): string[] | null => {
    if (done.has(id)) return null;
    const at = path.indexOf(id);
    if (at >= 0) return [...path.slice(at), id];
    path.push(id);
    const node = byId.get(id)!;
    for (const [d] of deps(node).sort(([a], [b]) => a.localeCompare(b))) {
      if (!byId.has(d)) continue;
      const cycle = visit(d);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(id);
    order.push(node);
    return null;
  };
  for (const id of [...byId.keys()].sort((a, b) => a.localeCompare(b))) {
    const cycle = visit(id);
    if (cycle) return { order, cycle };
  }
  return { order, cycle: null };
}

/**
 * Plugins présents au démarrage : ceux dont une dépendance manque, ne convient pas, est refusée ou forme un cycle sont
 * refusés (de proche en proche) ; les autres sont rendus dans l'ordre d'activation (dépendances d'abord).
 * `refused` : identifiants déjà refusés pour une autre raison (manifeste, compatibilité).
 */
export function checkPresent(
  nodes: readonly DependencyNode[],
  refused: ReadonlySet<string> = new Set(),
): { order: string[]; problems: Map<string, DependencyProblem> } {
  const problems = new Map<string, DependencyProblem>();
  let ok = nodes.filter((n) => !refused.has(n.id));
  // De proche en proche : un plugin refusé fait refuser ceux qui en ont besoin.
  for (let changed = true; changed;) {
    changed = false;
    const present = new Map(ok.map((n) => [n.id, n]));
    for (const n of ok) {
      for (const [d, range] of deps(n)) {
        const dep = present.get(d);
        let problem: DependencyProblem | null = null;
        if (dep) problem = satisfies(dep.version, range) ? null : { code: 'missing', id: n.id, dependency: d, range };
        else if (refused.has(d) || problems.has(d)) problem = { code: 'refused', id: n.id, dependency: d };
        else problem = { code: 'missing', id: n.id, dependency: d, range };
        if (problem) {
          problems.set(n.id, problem);
          changed = true;
          break;
        }
      }
    }
    ok = ok.filter((n) => !problems.has(n.id));
    if (changed) continue;
    const { cycle } = dependencyOrder(ok);
    if (cycle) {
      for (const id of new Set(cycle)) problems.set(id, { code: 'cycle', cycle });
      ok = ok.filter((n) => !problems.has(n.id));
      changed = true;
    }
  }
  return { order: dependencyOrder(ok).order.map((n) => n.id), problems };
}

export interface ResolveOptions {
  /** Toutes les versions connues d'un plugin (installées, incluses, dépôts). */
  available(id: string): readonly DependencyNode[];
  /** Version installée d'un plugin, s'il l'est : gardée tant qu'elle convient (pas de mise à jour non demandée). */
  installed?(id: string): string | null;
  /** Garde-fou contre les va-et-vient entre versions (choix successifs). */
  maxSteps?: number;
}

export type ResolveResult = { ok: true; order: DependencyNode[] } | { ok: false; problem: DependencyProblem };

/**
 * Versions à installer pour le plugin `id` (dans la plage `range`, par défaut toutes) et ses dépendances, dans l'ordre
 * d'installation (dépendances d'abord, le plugin demandé en dernier). Pour chaque plugin : la version installée si elle
 * convient à toutes les demandes, sinon la plus haute qui y convient. Quand une demande nouvelle écarte une version
 * déjà choisie, elle est choisie de nouveau et ses propres demandes sont reprises.
 */
export function resolveInstall(id: string, range: string, opts: ResolveOptions): ResolveResult {
  const requirements = new Map<string, Map<string | null, string>>([[id, new Map([[null, range]])]]);
  const chosen = new Map<string, DependencyNode>();
  const queue = [id];
  let steps = opts.maxSteps ?? 1000;
  // Échecs remis à plus tard : la demande fautive peut venir d'une version qui sera écartée (encore en file).
  let deferred = 0;

  const require = (from: DependencyNode) => {
    for (const [d, r] of deps(from)) {
      const reqs = requirements.get(d) ?? new Map<string | null, string>();
      reqs.set(from.id, r);
      requirements.set(d, reqs);
      const pick = chosen.get(d);
      if (!pick || !satisfies(pick.version, r)) queue.push(d);
    }
  };
  // Une version écartée : ce qu'elle demandait ne compte plus.
  const forget = (from: string) => {
    for (const reqs of requirements.values()) reqs.delete(from);
  };

  while (queue.length) {
    if (--steps < 0) return { ok: false, problem: conflictOf(queue[0], requirements) };
    const current = queue.shift()!;
    const reqs = [...(requirements.get(current) ?? new Map()).entries()].map(([by, r]) => ({ by, range: r }));
    if (!reqs.length) continue;
    const prev = chosen.get(current);
    if (prev && reqs.every((r) => satisfies(prev.version, r.range))) continue;
    const pick = choose(current, reqs, opts);
    if (!pick.ok) {
      if (deferred++ >= queue.length) return pick;
      queue.push(current);
      continue;
    }
    deferred = 0;
    if (prev) forget(current);
    chosen.set(current, pick.node);
    require(pick.node);
  }

  // Seuls les plugins encore demandés depuis `id` sont gardés (une version écartée a pu en attirer d'autres).
  const kept = new Map<string, DependencyNode>();
  const walk = (n: DependencyNode) => {
    if (kept.has(n.id)) return;
    kept.set(n.id, n);
    for (const [d] of deps(n)) walk(chosen.get(d)!);
  };
  walk(chosen.get(id)!);
  const { order, cycle } = dependencyOrder([...kept.values()]);
  return cycle ? { ok: false, problem: { code: 'cycle', cycle } } : { ok: true, order };
}

function choose(id: string, reqs: Requirement[], opts: ResolveOptions): { ok: true; node: DependencyNode } | { ok: false; problem: DependencyProblem } {
  const versions = [...opts.available(id)].filter((n) => parseVersion(n.version)).sort(byVersionDesc);
  const fits = (n: DependencyNode) => reqs.every((r) => satisfies(n.version, r.range));
  const current = opts.installed?.(id);
  const node = versions.find((n) => n.version === current && fits(n)) ?? versions.find(fits);
  if (node) return { ok: true, node };
  // Une plage qu'aucune version ne satisfait seule : la dépendance est introuvable ; sinon, les plages se contredisent.
  const alone = reqs.find((r) => !versions.some((n) => satisfies(n.version, r.range)));
  if (alone) return { ok: false, problem: { code: 'missing', id: alone.by, dependency: id, range: alone.range } };
  return { ok: false, problem: { code: 'conflict', dependency: id, requirements: reqs } };
}

function conflictOf(id: string, requirements: Map<string, Map<string | null, string>>): DependencyProblem {
  const reqs = [...(requirements.get(id) ?? new Map()).entries()].map(([by, range]) => ({ by, range }));
  return { code: 'conflict', dependency: id, requirements: reqs };
}

/** Plugins qui ont besoin de `id` (refus de le désinstaller), par identifiant. */
export function dependentsOf(id: string, nodes: readonly DependencyNode[]): string[] {
  return nodes
    .filter((n) => n.id !== id && Object.hasOwn(n.dependencies ?? {}, id))
    .map((n) => n.id)
    .sort((a, b) => a.localeCompare(b));
}
