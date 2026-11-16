/**
 * Catalogue d'éléments (architecture cible, « Éléments, tags et infos ») : garde en mémoire tout ce que les sources
 * ont trouvé, l'enregistre par emplacement de source dans `userData/catalog/sources/`, et annonce les éléments
 * ajoutés, changés et retirés.
 *
 * Une source donne, à chaque analyse d'un de ses emplacements, la liste complète de ses éléments (`setSource`) ; le
 * catalogue en déduit les changements. Une même clé peut venir de deux emplacements (dossier inclus dans un autre) :
 * l'élément est alors celui de l'emplacement qui l'a fourni le premier, et il reste tant qu'un emplacement le fournit.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Element, ElementKey, ElementSourceRef } from '@mire/shared';
import { createJsonStore, readJsonFile, type JsonStore } from '../storage/json-store.ts';
import { listSourceFiles, readSourceFile, SOURCE_FILE_VERSION, sourceFileName, sourceId } from './persistence.ts';
import type { CatalogChange, CatalogListener, ElementInput, SourceFile } from './types.ts';

export type { CatalogChange, CatalogListener, ElementInput, SourceFile } from './types.ts';

export interface CatalogOptions {
  /** `userData/catalog/sources/` */
  dir: string;
  /** Délai de regroupement des écritures (une analyse peut en déclencher plusieurs à la suite). */
  debounceMs?: number;
  now?: () => number;
  /** Fichier d'emplacement illisible ou d'une version inconnue : écarté (journal par défaut). */
  onIgnored?: (file: string, reason: string) => void;
}

interface Instance {
  ref: ElementSourceRef;
  elements: Map<ElementKey, Element>;
  scanned: number;
}

const sameElement = (a: Element | undefined, b: Element | undefined) => JSON.stringify(a) === JSON.stringify(b);

export function createCatalog({ dir, debounceMs = 1000, now = Date.now, onIgnored }: CatalogOptions) {
  const ignored = onIgnored ?? ((file: string, reason: string) => console.error(`Catalogue : ${file} écarté (${reason}).`));
  const instances = new Map<string, Instance>();
  // Clé → emplacements qui la fournissent, dans l'ordre où ils l'ont fournie ; le premier donne l'élément.
  const owners = new Map<ElementKey, string[]>();
  const stores = new Map<string, JsonStore<SourceFile>>();
  const removals = new Set<Promise<void>>();
  const listeners = new Set<CatalogListener>();

  const current = (key: ElementKey): Element | undefined => {
    const id = owners.get(key)?.[0];
    return id ? instances.get(id)?.elements.get(key) : undefined;
  };

  function storeFor(id: string, ref: ElementSourceRef, file = path.join(dir, sourceFileName(ref))): JsonStore<SourceFile> {
    let store = stores.get(id);
    if (!store) {
      const empty = (): SourceFile => ({ version: SOURCE_FILE_VERSION, source: ref, scanned: 0, elements: [] });
      store = createJsonStore<SourceFile>(file, { defaults: empty, debounceMs, onCorrupt: (err, f) => ignored(f, err.message) });
      stores.set(id, store);
    }
    return store;
  }

  /** Remplace les éléments d'un emplacement en mémoire et renvoie les changements visibles. */
  function apply(id: string, next: Instance | null): CatalogChange {
    const prev = instances.get(id);
    const affected = new Set<ElementKey>([...(prev?.elements.keys() ?? []), ...(next?.elements.keys() ?? [])]);
    const before = new Map([...affected].map((k) => [k, current(k)]));
    if (next) instances.set(id, next);
    else instances.delete(id);
    for (const key of affected) {
      const list = (owners.get(key) ?? []).filter((o) => o !== id || next?.elements.has(key));
      if (next?.elements.has(key) && !list.includes(id)) list.push(id);
      if (list.length) owners.set(key, list);
      else owners.delete(key);
    }
    const change: CatalogChange = { added: [], changed: [], removed: [] };
    for (const key of affected) {
      const was = before.get(key);
      const is = current(key);
      if (!was && is) change.added.push(key);
      else if (was && !is) change.removed.push(key);
      else if (!sameElement(was, is)) change.changed.push(key);
    }
    return change;
  }

  function emit(change: CatalogChange): void {
    if (!change.added.length && !change.changed.length && !change.removed.length) return;
    for (const listener of listeners) listener(change);
  }

  function persist(id: string, inst: Instance): void {
    storeFor(id, inst.ref).set({ version: SOURCE_FILE_VERSION, source: inst.ref, scanned: inst.scanned, elements: [...inst.elements.values()] });
  }

  return {
    /** Lit les fichiers des emplacements (démarrage). Les éléments lus sont là avant toute nouvelle analyse. */
    load(): void {
      for (const file of listSourceFiles(dir)) {
        let data: SourceFile | null;
        try {
          data = readSourceFile(readJsonFile(file));
        } catch (err) {
          ignored(file, (err as Error).message);
          continue;
        }
        if (!data) {
          ignored(file, 'contenu inattendu');
          continue;
        }
        const id = sourceId(data.source);
        storeFor(id, data.source, file);
        apply(id, { ref: data.source, scanned: data.scanned, elements: new Map(data.elements.map((e) => [e.key, e])) });
      }
    },

    /** Élément d'après sa clé (copie), ou `null`. */
    element(key: unknown): Element | null {
      if (typeof key !== 'string') return null;
      const found = current(key);
      return found ? structuredClone(found) : null;
    },

    /** Nombre d'éléments. */
    size: () => owners.size,

    /** Clés de tous les éléments. */
    keys: (): ElementKey[] => [...owners.keys()],

    /** Emplacements de source connus. */
    sources: (): ElementSourceRef[] => [...instances.values()].map((i) => ({ ...i.ref })),

    /**
     * Résultat d'une analyse d'un emplacement : la liste complète de ses éléments. Ceux qui manquent sont retirés ;
     * un élément déjà connu garde sa date d'ajout. Deux éléments de même clé dans une même analyse : le dernier
     * l'emporte.
     */
    setSource(source: ElementSourceRef, inputs: Iterable<ElementInput>): CatalogChange {
      const ref = { plugin: source.plugin, instance: source.instance };
      const id = sourceId(ref);
      const prev = instances.get(id)?.elements;
      const elements = new Map<ElementKey, Element>();
      for (const input of inputs) {
        if (typeof input.key !== 'string' || !input.key) throw new Error('Catalogue : élément sans clé.');
        const added = prev?.get(input.key)?.added ?? input.added ?? now();
        elements.set(input.key, { ...structuredClone(input), source: { ...ref }, added });
      }
      const inst = { ref, elements, scanned: now() };
      const change = apply(id, inst);
      persist(id, inst);
      emit(change);
      return change;
    },

    /** Emplacement retiré de la configuration : ses éléments quittent le catalogue, et son fichier le disque. */
    removeSource(source: ElementSourceRef): CatalogChange {
      const id = sourceId(source);
      if (!instances.has(id)) return { added: [], changed: [], removed: [] };
      const change = apply(id, null);
      const store = stores.get(id);
      if (store) {
        // Le fichier est supprimé une fois les écritures en attente terminées, sauf si l'emplacement est revenu entre-temps.
        const removal = store
          .flush()
          .then(() => {
            if (!instances.has(id)) fs.rmSync(store.file, { force: true });
          })
          .catch((err: Error) => ignored(store.file, err.message))
          .finally(() => removals.delete(removal));
        removals.add(removal);
      }
      emit(change);
      return change;
    },

    /** Abonnement aux changements ; renvoie de quoi se désabonner. */
    onChange(listener: CatalogListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Écrit tout de suite ce qui attend (fermeture de Mire). */
    async flush(): Promise<void> {
      await Promise.all([...stores.values()].map((s) => s.flush()));
      await Promise.all([...removals]);
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
