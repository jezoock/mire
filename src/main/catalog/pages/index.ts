/**
 * Pages (P2-07) : définitions (`userData/catalog/pages.json` par-dessus les pages prêtes à l'emploi) et calcul de ce
 * qu'une page affiche, un niveau à la fois et par tranches (`catalog.page`).
 *
 * Rien n'est calculé au démarrage : une page se calcule à la première demande, à partir de l'index du moteur de tags
 * (tags → clés), puis reste en cache. Les changements du moteur mettent à jour les éléments d'une page déjà calculée,
 * effacent ses niveaux en cache et annoncent les pages touchées (`onChange`).
 */
import type { ElementKey, PageDefinition, PageGroup, PageLevel, PagePath, PageSaveResult } from '@mire/shared';
import { tagIdOfPage, validatePage } from '@mire/shared';
import type { Catalog } from '../index.ts';
import type { TagEngine } from '../tags/engine.ts';
import { corruptReason, createJsonStore } from '../../storage/json-store.ts';
import { BUILTIN_PAGES } from './builtin.ts';
import { followPath, groupBy, matchesPage, matchesWhere, sortKeys, type RawGroup } from './compute.ts';

export const PAGES_VERSION = 1;
/** Taille d'une tranche (regroupements ou éléments). */
export const PAGE_SIZE = 100;
/** Au-delà de ce nombre d'éléments changés d'un coup (analyse complète, règles), toutes les pages sont annoncées. */
const BULK = 500;

export interface PagesFile {
  version: number;
  /** Pages créées ou modifiées par l'utilisateur, par identifiant (une page prête à l'emploi modifiée y est aussi). */
  pages: Record<string, PageDefinition>;
  /** Pages prêtes à l'emploi supprimées. */
  removed: string[];
}

export interface PagesOptions {
  /** `userData/catalog/pages.json` */
  file: string;
  engine: Pick<TagEngine, 'query' | 'peek' | 'keys' | 'element' | 'onChange'> & Partial<Pick<TagEngine, 'nameOf'>>;
  catalog: Pick<Catalog, 'get'>;
  /** Texte des catalogues (nom du groupe « Autres »). */
  translate: (key: string) => string;
  builtin?: readonly PageDefinition[];
  onIgnored?: (file: string, reason: string) => void;
}

type Level = { kind: 'groups'; info: string; groups: RawGroup[] } | { kind: 'elements'; keys: ElementKey[] };

interface PageCache {
  /** Éléments de la page (avant les regroupements), ou `undefined` tant qu'elle n'a pas été calculée. */
  members?: Set<ElementKey>;
  /** Niveaux déjà calculés, par chemin. */
  levels: Map<string, Level>;
}

const empty = (): PagesFile => ({ version: PAGES_VERSION, pages: {}, removed: [] });
const isScalarOrNull = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

export function createPages({ file, engine, catalog, translate, builtin = BUILTIN_PAGES, onIgnored = logIgnored }: PagesOptions) {
  const store = createJsonStore<PagesFile>(file, {
    defaults: empty,
    space: 2,
    setAside: true,
    onCorrupt: (err, f, kept) => onIgnored(f, corruptReason(err, kept)),
  });
  const builtinById = new Map(builtin.map((p) => [p.id, p]));
  let data = empty();
  const caches = new Map<string, PageCache>();
  const listeners = new Set<(ids: string[]) => void>();

  function load(): void {
    const raw = store.load();
    data = empty();
    if (raw.version !== PAGES_VERSION) {
      if (raw.version !== undefined) onIgnored(file, `version ${raw.version}`);
      return;
    }
    for (const [id, def] of Object.entries(raw.pages ?? {})) {
      const r = validatePage(def);
      if (r.ok && r.page.id === id) data.pages[id] = r.page;
      else onIgnored(file, `page ${id}`);
    }
    data.removed = (Array.isArray(raw.removed) ? raw.removed : []).filter((id) => typeof id === 'string' && builtinById.has(id));
    caches.clear();
  }

  function definition(id: unknown): PageDefinition | undefined {
    if (typeof id !== 'string') return undefined;
    if (Object.hasOwn(data.pages, id)) return data.pages[id];
    return data.removed.includes(id) ? undefined : builtinById.get(id);
  }

  /**
   * Page d'un tag (`tag:<id>`, explorateur P4-08) : les éléments qui portent ce tag, triés par nom. Elle se calcule et
   * se garde en cache comme une page, mais n'est jamais listée ni annoncée : un changement du moteur l'efface.
   */
  function scope(id: unknown): PageDefinition | undefined {
    const tag = tagIdOfPage(id);
    return tag === null ? definition(id) : { id: id as string, name: tag, require: [tag] };
  }

  function all(): PageDefinition[] {
    const ids = new Set([...builtin.map((p) => p.id), ...Object.keys(data.pages)]);
    const pages = [...ids].map(definition).filter((p): p is PageDefinition => !!p);
    const order = (p: PageDefinition) => p.menu?.order ?? Number.POSITIVE_INFINITY;
    return pages.sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : 1));
  }

  function emit(ids: string[]): void {
    if (ids.length) for (const l of listeners) l(ids);
  }

  function cacheOf(id: string): PageCache {
    let c = caches.get(id);
    if (!c) caches.set(id, (c = { levels: new Map() }));
    return c;
  }

  function members(page: PageDefinition): Set<ElementKey> {
    const cache = cacheOf(page.id);
    if (cache.members) return cache.members;
    const exclude = page.exclude ?? [];
    const candidates = page.require.length ? engine.query(page.require, exclude) : [...engine.keys()];
    const out = new Set<ElementKey>();
    for (const key of candidates) {
      const eff = engine.peek(key);
      if (!eff) continue;
      if (page.require.length ? matchesWhere(page, eff) : matchesPage(page, eff)) out.add(key);
    }
    return (cache.members = out);
  }

  function level(page: PageDefinition, path: PagePath): Level {
    const cache = cacheOf(page.id);
    const id = JSON.stringify(path);
    const known = cache.levels.get(id);
    if (known) return known;
    const levels = page.groupBy ?? [];
    const keys = path.length ? followPath(members(page), levels, path, engine.peek) : members(page);
    const next: Level =
      path.length < levels.length
        ? { kind: 'groups', info: levels[path.length], groups: groupBy(keys, levels[path.length], engine.peek) }
        : { kind: 'elements', keys: sortKeys([...keys], page.sort ?? [], subject) };
    cache.levels.set(id, next);
    return next;
  }

  function subject(key: ElementKey) {
    const eff = engine.peek(key);
    const e = catalog.get(key);
    // Tri par nom : le nom affiché (un titre saisi à la main l'emporte, P4-22).
    return eff && e ? { eff, name: engine.nameOf?.(e) ?? e.name, added: e.added } : undefined;
  }

  const groupName = (g: RawGroup): PageGroup => ({
    value: g.value,
    name: g.value === null ? translate('pages.others') : String(g.value),
    count: g.count,
    ...(g.poster ? { poster: g.poster } : {}),
  });

  /** Changements du moteur : pages touchées, éléments et niveaux en cache mis à jour. */
  engine.onChange((keys) => {
    for (const id of [...caches.keys()]) if (tagIdOfPage(id) !== null) caches.delete(id);
    const pages = all();
    if (keys.length > BULK) {
      caches.clear();
      emit(pages.map((p) => p.id));
      return;
    }
    const touched: string[] = [];
    for (const page of pages) {
      const cache = caches.get(page.id);
      let hit = false;
      for (const key of keys) {
        const eff = engine.peek(key);
        const now = !!eff && matchesPage(page, eff);
        const was = cache?.members?.has(key) ?? false;
        if (!now && !was) continue;
        hit = true;
        if (cache?.members) {
          if (now) cache.members.add(key);
          else cache.members.delete(key);
        }
      }
      if (!hit) continue;
      cache?.levels.clear();
      touched.push(page.id);
    }
    emit(touched);
  });

  function changed(id: string): void {
    caches.delete(id);
    emit([id]);
  }

  return {
    load,

    /** Pages, dans l'ordre du menu (`pages.list`). */
    list: (): PageDefinition[] => structuredClone(all()),

    /** Définition d'une page, ou `null` (`pages.get`). */
    get: (id: unknown): PageDefinition | null => {
      const p = definition(id);
      return p ? structuredClone(p) : null;
    },

    /** Crée ou remplace une page (`pages.save`) ; une page prête à l'emploi supprimée revient ainsi. */
    save(def: unknown): PageSaveResult {
      const r = validatePage(def);
      if (!r.ok) return r;
      data.pages[r.page.id] = r.page;
      data.removed = data.removed.filter((id) => id !== r.page.id);
      store.set(data);
      changed(r.page.id);
      return { ok: true, page: structuredClone(r.page) };
    },

    /** Supprime une page (`pages.remove`) ; une page prête à l'emploi modifiée est supprimée elle aussi. */
    remove(id: unknown): boolean {
      if (typeof id !== 'string' || !definition(id)) return false;
      delete data.pages[id];
      if (builtinById.has(id)) data.removed = [...data.removed, id];
      store.set(data);
      changed(id);
      return true;
    },

    /**
     * Un niveau d'une page (`catalog.page`) : ses regroupements tant que le chemin n'a pas atteint le dernier niveau
     * de `groupBy`, puis ses éléments triés. `cursor` : celui de la tranche précédente (`next`). `null` si la page
     * n'existe pas ou si le chemin ne convient pas. `tag:<id>` : les éléments d'un tag (`scope`).
     */
    page(pageId: unknown, path: unknown = [], cursor: unknown = null): PageLevel | null {
      const page = scope(pageId);
      const p = path ?? [];
      if (!page || !Array.isArray(p) || p.length > (page.groupBy?.length ?? 0) || !p.every(isScalarOrNull)) return null;
      const from = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : 0;
      const lvl = level(page, p as PagePath);
      const items = lvl.kind === 'groups' ? lvl.groups : lvl.keys;
      const total = items.length;
      const next = from + PAGE_SIZE < total ? String(from + PAGE_SIZE) : null;
      const base = { page: page.id, path: [...p] as PagePath, total, next };
      if (lvl.kind === 'groups') return { ...base, kind: 'groups', info: lvl.info, groups: lvl.groups.slice(from, from + PAGE_SIZE).map(groupName) };
      const elements = lvl.keys
        .slice(from, from + PAGE_SIZE)
        .map((k) => engine.element(k))
        .filter((e) => !!e);
      return { ...base, kind: 'elements', elements };
    },

    /** Abonnement aux pages dont le contenu a pu changer. */
    onChange(listener: (ids: string[]) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function logIgnored(file: string, reason: string): void {
  console.error(`Pages : ${file} écarté en partie (${reason}).`);
}

export type Pages = ReturnType<typeof createPages>;
