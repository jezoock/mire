/**
 * Recherche dans le catalogue (P2-09, `catalog.search`) : noms des éléments, infos texte et noms des tags, sans tenir
 * compte des accents ni de la casse, comme la recherche de l'interface historique (`src/renderer/domain/search.ts`) :
 * un élément est trouvé s'il contient tous les mots, dans n'importe quel ordre.
 *
 * Rien n'est calculé au démarrage : le texte de recherche de chaque élément (nom et infos texte, simplifiés) est
 * préparé à la première recherche, puis tenu à jour par les changements du moteur de tags. Les noms des tags ne sont
 * pas dans ce texte : ils dépendent de la langue et sont comparés à chaque recherche (il y en a peu).
 */
import type { Element, ElementKey, PageDefinition, SearchGroup, SearchOptions, SearchResult } from '@mire/shared';
import { fold } from '@mire/shared';
import type { Catalog } from '../index.ts';
import { matchesPage } from '../pages/compute.ts';
import type { Pages } from '../pages/index.ts';
import type { Effective } from '../tags/merge.ts';
import type { Registry } from '../tags/registry.ts';
import type { TagEngine } from '../tags/engine.ts';

/** Éléments rendus par groupe, par défaut et au plus. */
export const SEARCH_LIMIT = 24;
export const SEARCH_LIMIT_MAX = 100;
/** Au-delà de ce nombre d'éléments changés d'un coup, les textes sont oubliés (recalculés à la recherche suivante). */
const BULK = 500;

export interface SearchServiceOptions {
  engine: Pick<TagEngine, 'peek' | 'keys' | 'element' | 'onChange'>;
  catalog: Pick<Catalog, 'get'>;
  pages: Pick<Pages, 'list'>;
  registry: Pick<Registry, 'tagName' | 'infoType'>;
  /** Texte des catalogues (noms des pages, groupe des éléments hors pages). */
  translate: (key: string) => string;
}

/** Texte de recherche d'un élément, simplifié (`fold`). */
interface Entry {
  name: string;
  /** Nom et infos texte, séparés par des retours à la ligne (un mot ne peut pas en chevaucher deux). */
  text: string;
}

/** Mots de la recherche, simplifiés (comme `matcher` de l'interface historique). */
export const searchWords = (query: unknown): string[] => fold(query).split(/\s+/).filter(Boolean);

/** Valeurs texte des infos : infos de type texte, éléments texte des listes ; une info non déclarée si c'est un texte. */
export function infoTexts(infos: Readonly<Effective['infos']>, infoType: Registry['infoType']): string[] {
  const out: string[] = [];
  for (const [id, value] of Object.entries(infos)) {
    const type = infoType(id);
    if (type === 'text' || type === undefined) {
      if (typeof value === 'string') out.push(value);
    } else if (type === 'list' && Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

export function createSearch({ engine, catalog, pages, registry, translate }: SearchServiceOptions) {
  let entries: Map<ElementKey, Entry> | null = null;

  function entryOf(key: ElementKey, eff: Readonly<Effective>): Entry | undefined {
    const e = catalog.get(key);
    if (!e) return undefined;
    const name = fold(e.name);
    return { name, text: [name, ...infoTexts(eff.infos, registry.infoType).map(fold)].join('\n') };
  }

  function all(): Map<ElementKey, Entry> {
    if (entries) return entries;
    entries = new Map();
    for (const key of engine.keys()) {
      const eff = engine.peek(key);
      const entry = eff && entryOf(key, eff);
      if (entry) entries.set(key, entry);
    }
    return entries;
  }

  engine.onChange((keys) => {
    if (!entries) return;
    if (keys.length > BULK) {
      entries = null;
      return;
    }
    for (const key of keys) {
      const eff = engine.peek(key);
      const entry = eff && entryOf(key, eff);
      if (entry) entries.set(key, entry);
      else entries.delete(key);
    }
  });

  const pageName = (p: PageDefinition): string => (typeof p.name === 'string' ? p.name : translate(p.name.key));

  return {
    /** Éléments qui contiennent tous les mots de `query`, groupés par page (`catalog.search`). */
    search(query: unknown, options: unknown = {}): SearchResult {
      const q = typeof query === 'string' ? query : '';
      const words = searchWords(q);
      if (!words.length) return { query: q, total: 0, groups: [] };
      const asked = (options as SearchOptions | null)?.limit;
      const limit = Number.isInteger(asked) && (asked as number) > 0 ? Math.min(asked as number, SEARCH_LIMIT_MAX) : SEARCH_LIMIT;

      // Noms des tags (dans la langue de l'interface) : pour chaque tag rencontré, les mots que son nom contient.
      const tagMatches = new Map<string, boolean[]>();
      const tagWords = (tag: string): boolean[] => {
        let m = tagMatches.get(tag);
        if (!m) {
          const name = fold(registry.tagName(tag));
          tagMatches.set(tag, (m = words.map((w) => name.includes(w))));
        }
        return m;
      };

      const hits: { key: ElementKey; eff: Readonly<Effective>; name: string; byName: boolean }[] = [];
      for (const [key, entry] of all()) {
        const eff = engine.peek(key);
        if (!eff) continue;
        let ok = true;
        for (let i = 0; i < words.length && ok; i++) {
          if (entry.text.includes(words[i])) continue;
          ok = eff.tags.some((t) => tagWords(t)[i]);
        }
        if (ok) hits.push({ key, eff, name: entry.name, byName: words.every((w) => entry.name.includes(w)) });
      }
      // Les éléments dont le nom correspond d'abord, puis par nom simplifié (comparaison simple : rapide sur 20 000).
      hits.sort((a, b) => Number(b.byName) - Number(a.byName) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1));

      const defs = pages.list();
      const groups = new Map<string | null, { total: number; keys: ElementKey[] }>();
      const add = (id: string | null, key: ElementKey) => {
        let g = groups.get(id);
        if (!g) groups.set(id, (g = { total: 0, keys: [] }));
        if (g.total++ < limit) g.keys.push(key);
      };
      for (const hit of hits) {
        let placed = false;
        for (const page of defs) {
          if (!matchesPage(page, hit.eff)) continue;
          add(page.id, hit.key);
          placed = true;
        }
        if (!placed) add(null, hit.key);
      }

      const render = (page: string | null, name: string): SearchGroup[] => {
        const g = groups.get(page);
        if (!g) return [];
        const elements = g.keys.map((k) => engine.element(k)).filter((e): e is Element => !!e);
        return [{ page, name, total: g.total, elements }];
      };
      return {
        query: q,
        total: hits.length,
        groups: [...defs.flatMap((p) => render(p.id, pageName(p))), ...render(null, translate('pages.outside'))],
      };
    },
  };
}

export type Search = ReturnType<typeof createSearch>;
