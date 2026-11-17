/**
 * Calcul d'une page, en fonctions pures : conditions sur les infos (`where`), comparaison des valeurs, regroupement
 * d'un niveau, filtre d'un chemin et tri des éléments.
 */
import type { ElementKey, InfoScalar, InfoValue, PageCondition, PageDefinition, PagePath, PageSort } from '@mire/shared';
import type { Effective } from '../tags/merge.ts';

/** Ce que le calcul lit d'un élément : ses tags, infos et images effectifs, son nom et sa date d'ajout. */
export interface PageSubject {
  eff: Readonly<Effective>;
  name: string;
  added: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Valeurs simples d'une info (un élément d'une liste est pris seul) ; aucune si l'info est absente ou vide. */
export const scalars = (v: InfoValue | undefined): readonly InfoScalar[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Ordre des valeurs : les nombres entre eux, le reste en texte (ordre alphabétique, « 2 » avant « 10 »). */
export function compareValues(a: InfoScalar, b: InfoScalar): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return collator.compare(String(a), String(b));
}

function matchesCondition(infos: Readonly<Record<string, InfoValue>>, c: PageCondition): boolean {
  const values = scalars(infos[c.info]);
  if ('equals' in c) return values.some((v) => v === c.equals || (typeof v === 'string' && typeof c.equals === 'string' && !collator.compare(v, c.equals)));
  if ('contains' in c) {
    const needle = c.contains.toLocaleLowerCase();
    return values.some((v) => String(v).toLocaleLowerCase().includes(needle));
  }
  const [min, max] = c.between;
  return values.some((v) => typeof v === typeof min && compareValues(v, min) >= 0 && compareValues(v, max) <= 0);
}

/** Vrai si l'élément entre dans la page : tous les tags de `require`, aucun de `exclude`, toutes les conditions. */
export function matchesPage(page: Readonly<PageDefinition>, eff: Readonly<Effective>): boolean {
  if (!page.require.every((t) => eff.tags.includes(t))) return false;
  if (page.exclude?.some((t) => eff.tags.includes(t))) return false;
  return (page.where ?? []).every((c) => matchesCondition(eff.infos, c));
}

/** Vrai si l'élément respecte les conditions `where` (les tags sont déjà filtrés par l'index). */
export const matchesWhere = (page: Readonly<PageDefinition>, eff: Readonly<Effective>): boolean =>
  (page.where ?? []).every((c) => matchesCondition(eff.infos, c));

/** Éléments qui suivent le chemin : à chaque niveau, la valeur choisie, ou l'absence de l'info (`null`, « Autres »). */
export function followPath(
  keys: Iterable<ElementKey>,
  groupBy: readonly string[],
  path: PagePath,
  peek: (key: ElementKey) => Readonly<Effective> | undefined,
): ElementKey[] {
  const out: ElementKey[] = [];
  for (const key of keys) {
    const eff = peek(key);
    if (eff && path.every((value, i) => inGroup(scalars(eff.infos[groupBy[i]]), value))) out.push(key);
  }
  return out;
}

const inGroup = (values: readonly InfoScalar[], value: InfoScalar | null): boolean => (value === null ? !values.length : values.includes(value));

/** Regroupement d'un niveau avant traduction : valeur, nombre d'éléments, affiche du premier qui en a une. */
export interface RawGroup {
  value: InfoScalar | null;
  count: number;
  poster?: string;
}

/** Regroupements des éléments selon une info, dans l'ordre des valeurs ; « Autres » (`null`) en dernier. */
export function groupBy(keys: Iterable<ElementKey>, info: string, peek: (key: ElementKey) => Readonly<Effective> | undefined): RawGroup[] {
  const groups = new Map<InfoScalar | null, RawGroup>();
  const add = (value: InfoScalar | null, poster: string | undefined) => {
    let g = groups.get(value);
    if (!g) groups.set(value, (g = { value, count: 0 }));
    g.count++;
    if (!g.poster && poster) g.poster = poster;
  };
  for (const key of keys) {
    const eff = peek(key);
    if (!eff) continue;
    const values = scalars(eff.infos[info]);
    if (!values.length) add(null, eff.images.poster);
    for (const v of new Set(values)) add(v, eff.images.poster);
  }
  const others = groups.get(null);
  groups.delete(null);
  const sorted = [...groups.values()].sort((a, b) => compareValues(a.value as InfoScalar, b.value as InfoScalar));
  return others ? [...sorted, others] : sorted;
}

function sortValue(s: PageSubject, by: string): InfoScalar | undefined {
  if (by === 'name') return s.name;
  if (by === 'added') return s.added;
  return scalars(s.eff.infos[by])[0];
}

/** Trie les éléments critère après critère (un élément sans la valeur va après les autres), puis par nom. */
export function sortKeys(keys: readonly ElementKey[], sort: readonly PageSort[], subject: (key: ElementKey) => PageSubject | undefined): ElementKey[] {
  const specs = [...sort, { by: 'name' }];
  const rows = keys.flatMap((key) => {
    const s = subject(key);
    return s ? [{ key, values: specs.map((spec) => sortValue(s, spec.by)) }] : [];
  });
  rows.sort((a, b) => {
    for (let i = 0; i < specs.length; i++) {
      const x = a.values[i];
      const y = b.values[i];
      if (x === y) continue;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      const c = compareValues(x, y);
      if (c) return specs[i].order === 'desc' ? -c : c;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return rows.map((r) => r.key);
}
