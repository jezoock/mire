/**
 * Registre des contributions des plugins actifs, par nature (architecture cible, « Contributions »). Le cœur le
 * consulte là où il a déjà une interface ; pour les natures dont le lecteur n'existe pas encore (pages, thèmes,
 * palettes, langues, manettes, apps, consoles, packs, sites), il expose les contributions telles quelles : le
 * lecteur et le schéma de leur contenu viennent avec leur tâche.
 */
import type { ContributionKind, InfoDeclaration, PluginManifest } from '@mire/plugin-sdk';
// Sources du SDK plutôt que son paquet : son dist/ n'est construit que pour son archive (les tests lisent les sources).
import { CODE_CONTRIBUTIONS, CONTRIBUTION_KINDS } from '../../../packages/plugin-sdk/src/manifest.ts';

/** Une contribution d'un plugin actif. */
export interface ContributionEntry {
  pluginId: string;
  kind: ContributionKind;
  id: string;
  /** Entrée du manifeste (`main` ou `file`, `tags`, `infos`, `kinds`…). */
  declaration: Readonly<Record<string, unknown>>;
  /** Contribution de données : contenu du fichier JSON lu par le cœur (`null` pour un autre fichier). */
  data?: unknown;
  /** Contribution de données : chemin du fichier. */
  file?: string;
}

/** Natures dont l'activation à chaud n'est pas possible : elles se branchent au démarrage (session des vues web, moteurs). */
export const RESTART_KINDS: readonly ContributionKind[] = ['webExtensions', 'downloaders'];

const isCode = (k: ContributionKind) => (CODE_CONTRIBUTIONS as readonly string[]).includes(k);

/** Entrées du registre pour un plugin : une par contribution déclarée. */
export function contributionEntries(
  m: PluginManifest,
  dir: string,
  data: ReadonlyMap<string, unknown>,
  join: (dir: string, file: string) => string,
): ContributionEntry[] {
  return CONTRIBUTION_KINDS.flatMap((kind) =>
    ((m.contributes[kind] ?? []) as unknown as Record<string, unknown>[]).map((decl) => {
      const entry: ContributionEntry = { pluginId: m.id, kind, id: String(decl.id), declaration: decl };
      if (!isCode(kind)) {
        entry.file = join(dir, String(decl.file));
        entry.data = data.get(`${kind}/${String(decl.id)}`) ?? null;
      }
      return entry;
    }),
  );
}

/** Tags et infos déclarés par les contributions d'un plugin (`tags` et `infos` de `sources`, `metadata`, `taggers`). */
export function declaredTagsAndInfos(m: PluginManifest): { tags: string[]; infos: Record<string, InfoDeclaration> } {
  const tags = new Set<string>();
  const infos: Record<string, InfoDeclaration> = {};
  for (const kind of CODE_CONTRIBUTIONS) {
    for (const c of (m.contributes[kind] ?? []) as { tags?: string[]; infos?: Record<string, InfoDeclaration> }[]) {
      for (const t of c.tags ?? []) tags.add(t);
      for (const [id, d] of Object.entries(c.infos ?? {})) if (!Object.hasOwn(infos, id)) infos[id] = d;
    }
  }
  return { tags: [...tags], infos };
}

export type RegistryListener = (kinds: ContributionKind[]) => void;

export function createContributionRegistry() {
  const byPlugin = new Map<string, ContributionEntry[]>();
  const listeners = new Set<RegistryListener>();
  const emit = (entries: readonly ContributionEntry[]) => {
    const kinds = [...new Set(entries.map((e) => e.kind))];
    if (!kinds.length) return;
    for (const l of listeners) l(kinds);
  };

  return {
    /** Contributions d'un plugin activé (remplace les précédentes). */
    set(pluginId: string, entries: ContributionEntry[]): void {
      const before = byPlugin.get(pluginId) ?? [];
      byPlugin.set(pluginId, entries);
      emit([...before, ...entries]);
    },
    /** Plugin désactivé : ses contributions quittent le registre. */
    remove(pluginId: string): void {
      const before = byPlugin.get(pluginId);
      if (!before) return;
      byPlugin.delete(pluginId);
      emit(before);
    },
    /** Contributions actives d'une nature, dans l'ordre d'activation des plugins. */
    list(kind: ContributionKind): ContributionEntry[] {
      return [...byPlugin.values()].flatMap((list) => list.filter((e) => e.kind === kind));
    },
    /** Contributions d'un plugin actif. */
    ofPlugin: (pluginId: string): ContributionEntry[] => [...(byPlugin.get(pluginId) ?? [])],
    /** Abonnement : natures dont les contributions ont changé. */
    onChange(listener: RegistryListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ContributionRegistry = ReturnType<typeof createContributionRegistry>;
