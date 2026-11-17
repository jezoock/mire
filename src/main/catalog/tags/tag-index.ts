/**
 * Index en mémoire des tags et des infos effectifs : tag → clés, et info → valeur → clés. Une page se calcule par
 * intersection d'ensembles, sans parcourir tout le catalogue (objectif : moins de 50 ms pour 20 000 éléments).
 */
import type { ElementKey, InfoValue } from '@mire/shared';
import type { Effective } from './merge.ts';

/** Valeur indexée : un élément d'une liste est indexé seul (genres). */
type Scalar = string | number | boolean;

const EMPTY: ReadonlySet<ElementKey> = new Set();

const scalars = (v: InfoValue): readonly Scalar[] => (Array.isArray(v) ? v : [v]);

function addTo<K>(map: Map<K, Set<ElementKey>>, k: K, key: ElementKey): void {
  let set = map.get(k);
  if (!set) map.set(k, (set = new Set()));
  set.add(key);
}

function removeFrom<K>(map: Map<K, Set<ElementKey>>, k: K, key: ElementKey): void {
  const set = map.get(k);
  if (!set) return;
  set.delete(key);
  if (!set.size) map.delete(k);
}

export function createTagIndex() {
  const byTag = new Map<string, Set<ElementKey>>();
  const byInfo = new Map<string, Map<Scalar, Set<ElementKey>>>();

  function infoMap(id: string): Map<Scalar, Set<ElementKey>> {
    let m = byInfo.get(id);
    if (!m) byInfo.set(id, (m = new Map()));
    return m;
  }

  return {
    add(key: ElementKey, e: Readonly<Effective>): void {
      for (const t of e.tags) addTo(byTag, t, key);
      for (const [id, v] of Object.entries(e.infos)) for (const s of scalars(v)) addTo(infoMap(id), s, key);
    },

    remove(key: ElementKey, e: Readonly<Effective>): void {
      for (const t of e.tags) removeFrom(byTag, t, key);
      for (const [id, v] of Object.entries(e.infos)) {
        const m = byInfo.get(id);
        if (!m) continue;
        for (const s of scalars(v)) removeFrom(m, s, key);
        if (!m.size) byInfo.delete(id);
      }
    },

    clear(): void {
      byTag.clear();
      byInfo.clear();
    },

    /** Clés des éléments qui portent tous les tags de `require` et aucun de `exclude`. */
    withTags(require: readonly string[], exclude: readonly string[] = []): ElementKey[] {
      if (!require.length) return [];
      const sets = require.map((t) => byTag.get(t) ?? EMPTY).sort((a, b) => a.size - b.size);
      const [smallest, ...others] = sets;
      const excluded = exclude.map((t) => byTag.get(t)).filter((s): s is Set<ElementKey> => !!s);
      const out: ElementKey[] = [];
      for (const key of smallest) if (others.every((s) => s.has(key)) && !excluded.some((s) => s.has(key))) out.push(key);
      return out;
    },

    /** Clés des éléments dont l'info vaut `value` (ou dont la liste la contient). */
    withInfo(id: string, value: Scalar): ElementKey[] {
      return [...(byInfo.get(id)?.get(value) ?? EMPTY)];
    },

    /** Valeurs d'une info et nombre d'éléments pour chacune. */
    infoValues(id: string): { value: Scalar; count: number }[] {
      return [...(byInfo.get(id) ?? new Map<Scalar, Set<ElementKey>>())].map(([value, keys]) => ({ value, count: keys.size }));
    },

    /** Nombre d'éléments qui portent un tag. */
    tagCount: (tag: string): number => byTag.get(tag)?.size ?? 0,

    /** Tags présents dans le catalogue. */
    tags: (): string[] => [...byTag.keys()],
  };
}

export type TagIndex = ReturnType<typeof createTagIndex>;
