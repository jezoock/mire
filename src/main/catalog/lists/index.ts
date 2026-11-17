/**
 * Listes (P2-08) : regroupements faits à la main, ordonnés (`userData/catalog/lists.json`).
 *
 * Une liste garde les clés de ses éléments et, pour chacun, ce qu'il faut pour l'afficher s'il disparaît du catalogue
 * (nom, source, ouverture, affiche, tels qu'ils étaient). Rien n'est calculé au démarrage : un élément est disponible
 * s'il est dans le moteur de tags au moment de la demande. Les changements du moteur (analyse, infos, modification
 * à la main) mettent à jour ce que les listes gardent et annoncent les listes touchées : un élément disparu puis
 * revenu les fait annoncer deux fois.
 */
import type { Element, ElementKey, ListDefinition, ListItem, ListSummary, ListView, PageElement, PageLevel } from '@mire/shared';
import { isListName, listIdOfPage, listPageId, newId, validateList } from '@mire/shared';
import type { TagEngine } from '../tags/engine.ts';
import { corruptReason, createJsonStore } from '../../storage/json-store.ts';
import { PAGE_SIZE } from '../pages/index.ts';
import { movedKey } from '../keys.ts';

export const LISTS_VERSION = 1;

export interface ListsFile {
  version: number;
  /** Listes, dans l'ordre où elles ont été créées. */
  lists: ListDefinition[];
}

export interface ListsOptions {
  /** `userData/catalog/lists.json` */
  file: string;
  engine: Pick<TagEngine, 'element' | 'onChange'>;
  onIgnored?: (file: string, reason: string) => void;
  /** Identifiant d'une nouvelle liste (aléatoire par défaut). */
  newId?: () => string;
  /** Règle des chemins des clés (`movePath`) ; par défaut, celle de Mire. */
  platform?: NodeJS.Platform;
}

const empty = (): ListsFile => ({ version: LISTS_VERSION, lists: [] });

function snapshot(e: Element): ListItem {
  const item: ListItem = { key: e.key, name: e.name, source: { ...e.source }, open: structuredClone(e.open), added: e.added };
  if (e.images.poster) item.poster = e.images.poster;
  return item;
}

const sameItem = (a: ListItem, b: ListItem) => JSON.stringify(a) === JSON.stringify(b);

export function createLists({ file, engine, onIgnored = logIgnored, newId: makeId = newId, platform = process.platform }: ListsOptions) {
  const store = createJsonStore<ListsFile>(file, {
    defaults: empty,
    space: 2,
    setAside: true,
    onCorrupt: (err, f, kept) => onIgnored(f, corruptReason(err, kept)),
  });
  let data = empty();
  /** Clé d'élément → listes qui le contiennent (pour suivre les changements du moteur). */
  const byKey = new Map<ElementKey, Set<string>>();
  const listeners = new Set<(ids: string[]) => void>();

  function index(list: ListDefinition, key: ElementKey, add: boolean): void {
    let ids = byKey.get(key);
    if (add) {
      if (!ids) byKey.set(key, (ids = new Set()));
      ids.add(list.id);
      return;
    }
    ids?.delete(list.id);
    if (ids && !ids.size) byKey.delete(key);
  }

  function load(): void {
    const raw = store.load();
    data = empty();
    byKey.clear();
    if (raw.version !== LISTS_VERSION) {
      if (raw.version !== undefined) onIgnored(file, `version ${raw.version}`);
      return;
    }
    const ids = new Set<string>();
    for (const [i, def] of (Array.isArray(raw.lists) ? raw.lists : []).entries()) {
      const r = validateList(def);
      if (!r.ok || ids.has(r.list.id)) {
        onIgnored(file, `list ${i}`);
        continue;
      }
      if (r.dropped) onIgnored(file, `list ${r.list.id}: ${r.dropped} item(s)`);
      ids.add(r.list.id);
      data.lists.push(r.list);
      for (const item of r.list.items) index(r.list, item.key, true);
    }
  }

  const find = (id: unknown) => (typeof id === 'string' ? data.lists.find((l) => l.id === id) : undefined);

  function emit(ids: Iterable<string>): void {
    const list = [...new Set(ids)];
    if (list.length) for (const l of listeners) l(list);
  }

  function changed(list: ListDefinition): void {
    store.set(data);
    emit([list.id]);
  }

  const summary = (l: ListDefinition): ListSummary => ({ id: l.id, name: structuredClone(l.name), count: l.items.length });

  /** Élément rendu par `catalog.page` : celui du catalogue, ou celui que la liste garde, marqué indisponible. */
  function pageElement(item: ListItem): PageElement {
    const e = engine.element(item.key);
    if (e) return e;
    const { key, name, source, open, added, poster } = structuredClone(item);
    return { key, source, name, open, tags: [], infos: {}, images: poster ? { poster } : {}, added, unavailable: true };
  }

  /** Changements du moteur : ce que les listes gardent est mis à jour, les listes touchées sont annoncées. */
  engine.onChange((keys) => {
    const touched = new Set<string>();
    let write = false;
    for (const key of keys) {
      const ids = byKey.get(key);
      if (!ids) continue;
      for (const id of ids) touched.add(id);
      const e = engine.element(key);
      if (!e) continue;
      const fresh = snapshot(e);
      for (const id of ids) {
        const list = find(id);
        const at = list?.items.findIndex((i) => i.key === key) ?? -1;
        if (list && at >= 0 && !sameItem(list.items[at], fresh)) {
          list.items[at] = structuredClone(fresh);
          write = true;
        }
      }
    }
    if (write) store.set(data);
    emit(touched);
  });

  return {
    load,

    /** Listes, dans l'ordre de création (`lists.list`). */
    list: (): ListSummary[] => data.lists.map(summary),

    /** Une liste et ses éléments, disponibles ou non (`lists.get`), ou `null`. */
    get(id: unknown): ListView | null {
      const list = find(id);
      if (!list) return null;
      const items = list.items.map((item) => {
        const e = engine.element(item.key);
        const name = e?.name ?? item.name;
        const poster = e ? e.images.poster : item.poster;
        return { key: item.key, name, ...(poster ? { poster } : {}), available: !!e };
      });
      return { id: list.id, name: structuredClone(list.name), items };
    },

    /** Crée une liste vide (`lists.create`) ; `null` si le nom ne convient pas. */
    create(name: unknown): ListSummary | null {
      if (!isListName(name)) return null;
      let id = makeId();
      while (find(id)) id = makeId();
      const list: ListDefinition = { id, name: structuredClone(name), items: [] };
      data.lists.push(list);
      changed(list);
      return summary(list);
    },

    /** Renomme une liste (`lists.rename`). */
    rename(id: unknown, name: unknown): boolean {
      const list = find(id);
      if (!list || !isListName(name)) return false;
      list.name = structuredClone(name);
      changed(list);
      return true;
    },

    /** Supprime une liste (`lists.remove`). Les éléments, eux, restent dans le catalogue. */
    remove(id: unknown): boolean {
      const list = find(id);
      if (!list) return false;
      data.lists = data.lists.filter((l) => l !== list);
      for (const item of list.items) index(list, item.key, false);
      changed(list);
      return true;
    },

    /**
     * Ajoute des éléments du catalogue à une liste (`lists.add`), à la position `at` (à la fin par défaut), dans
     * l'ordre donné. Un élément déjà dans la liste n'y est pas mis deux fois ; un élément absent du catalogue est
     * ignoré. Rend le nombre d'éléments ajoutés, ou `null` si la liste n'existe pas.
     */
    add(id: unknown, keys: unknown, at?: unknown): number | null {
      const list = find(id);
      if (!list || !Array.isArray(keys)) return null;
      const known = new Set(list.items.map((i) => i.key));
      const added: ListItem[] = [];
      for (const key of keys) {
        const e = typeof key === 'string' && !known.has(key) ? engine.element(key) : null;
        if (!e) continue;
        known.add(e.key);
        added.push(snapshot(e));
      }
      if (!added.length) return 0;
      list.items.splice(position(at, list.items.length), 0, ...added);
      for (const item of added) index(list, item.key, true);
      changed(list);
      return added.length;
    },

    /** Retire des éléments d'une liste (`lists.removeItems`), disponibles ou non. Rend le nombre retiré, ou `null`. */
    removeItems(id: unknown, keys: unknown): number | null {
      const list = find(id);
      if (!list || !Array.isArray(keys)) return null;
      const gone = new Set(keys.filter((k) => typeof k === 'string'));
      const before = list.items.length;
      list.items = list.items.filter((i) => !gone.has(i.key));
      if (list.items.length === before) return 0;
      for (const key of gone) index(list, key, false);
      changed(list);
      return before - list.items.length;
    },

    /** Déplace un élément à la position `to` (`lists.move`) ; une position trop grande le met à la fin. */
    move(id: unknown, key: unknown, to: unknown): boolean {
      const list = find(id);
      const from = list ? list.items.findIndex((i) => i.key === key) : -1;
      if (!list || from < 0 || typeof to !== 'number' || !Number.isInteger(to) || to < 0) return false;
      const [item] = list.items.splice(from, 1);
      list.items.splice(Math.min(to, list.items.length), 0, item);
      changed(list);
      return true;
    },

    /**
     * Une liste vue comme une page (`catalog.page('list:<id>')`) : ses éléments dans l'ordre de la liste, sans
     * regroupement ni tri, par tranches. `null` si ce n'est pas une liste connue ou si un chemin est donné.
     */
    page(pageId: unknown, path: unknown = [], cursor: unknown = null): PageLevel | null {
      const list = find(listIdOfPage(pageId));
      if (!list || (path !== null && (!Array.isArray(path) || path.length))) return null;
      const from = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : 0;
      const total = list.items.length;
      const next = from + PAGE_SIZE < total ? String(from + PAGE_SIZE) : null;
      const elements = list.items.slice(from, from + PAGE_SIZE).map(pageElement);
      return { page: listPageId(list.id), path: [], total, next, kind: 'elements', elements };
    },

    /**
     * Fichier ou dossier renommé ou déplacé de `from` vers `to` (P2-10) : ses éléments, et ceux de tout ce qu'il
     * contient, gardent leur place dans les listes sous leur nouvelle clé (ce que la liste garde d'eux est mis à jour
     * quand le catalogue les retrouve). Rend les identifiants des listes touchées.
     */
    movePath(from: string, to: string): string[] {
      const touched = new Set<string>();
      for (const list of data.lists) {
        const seen = new Set(list.items.filter((i) => !movedKey(i.key, from, to, platform)).map((i) => i.key));
        const items: ListItem[] = [];
        for (const item of list.items) {
          const next = movedKey(item.key, from, to, platform);
          if (!next) {
            items.push(item);
            continue;
          }
          touched.add(list.id);
          index(list, item.key, false);
          // L'élément était déjà dans la liste sous sa nouvelle clé (ancien fichier au même endroit) : une seule place.
          if (seen.has(next)) continue;
          seen.add(next);
          items.push({ ...item, key: next });
          index(list, next, true);
        }
        list.items = items;
      }
      if (touched.size) {
        store.set(data);
        emit(touched);
      }
      return [...touched];
    },

    /** Abonnement aux listes dont la définition ou le contenu a changé. */
    onChange(listener: (ids: string[]) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Écrit le fichier sans attendre (fermeture de Mire, tests). */
    flush: () => store.flush(),
  };
}

function position(at: unknown, length: number): number {
  return typeof at === 'number' && Number.isInteger(at) && at >= 0 ? Math.min(at, length) : length;
}

function logIgnored(file: string, reason: string): void {
  console.error(`Listes : ${file} écarté en partie (${reason}).`);
}

export type Lists = ReturnType<typeof createLists>;
