/**
 * Bibliothèque vue du reste de l'application : analyse des sources de la configuration, élément d'un fichier
 * ouvert, sous-titres d'une vidéo. Garde les sous-titres des vidéos en ligne trouvés par la dernière analyse.
 * Chaque analyse alimente aussi le catalogue d'éléments, un emplacement à la fois (`element-sources.ts`).
 */
import type { Config, ElementSourceRef, MediaKind } from '@mire/shared';
import type { Catalog } from '../catalog/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import { isLibrarySource, librarySources, locationInstance } from './element-sources.ts';
import { itemFromElement } from './from-element.ts';
import { itemFromPath } from './item-from-path.ts';
import { scanLibrary, type ScanOptions } from './scan.ts';
import { findSubtitles } from './subtitles.ts';
import type { LibraryItem, RemoteSubtitles, ScannedLocation, ScanResult, SourceTarget } from './types.ts';

export interface LibraryServiceDeps {
  config: { get(): Config };
  access: Pick<AccessPolicy, 'allowFile' | 'isAllowed'>;
  /** Catalogue d'éléments que chaque analyse alimente. */
  catalog?: Pick<Catalog, 'setSource' | 'removeSource' | 'sources' | 'keysOf' | 'get'>;
  /** Analyse (tests). */
  scan?: (opts: ScanOptions) => Promise<ScanResult>;
  /**
   * Vrai si un plugin lit cet emplacement (instance : chemin ou adresse normalisés, P5-11a) : ses éléments viennent
   * alors du plugin, et ceux du cœur quittent le catalogue.
   */
  claimed?: (instance: string) => boolean;
  /**
   * Analyses des sources des plugins (P5-11c) : attendues avant de rendre la bibliothèque, pour que les fichiers d'un
   * emplacement lu par un plugin soient à jour (l'interface historique les reçoit depuis le catalogue).
   */
  pluginScans?: () => Promise<void>;
  /** Un emplacement n'a pas pu alimenter le catalogue (journal par défaut) ; l'analyse continue. */
  onCatalogError?: (err: Error) => void;
}

const refId = (ref: ElementSourceRef) => JSON.stringify([ref.plugin, ref.instance]);

export function createLibraryService(deps: LibraryServiceDeps) {
  const { config, access, catalog, scan = scanLibrary } = deps;
  const elementSources = librarySources();
  const onCatalogError = deps.onCatalogError ?? ((err: Error) => console.error('Catalogue (bibliothèque) :', err.message));
  let remote: RemoteSubtitles = new Map();

  /**
   * Éléments d'un emplacement analysé → catalogue. Un emplacement inaccessible ou coupé par le nombre maximal
   * d'éléments garde ses éléments de l'analyse précédente : rien n'est retiré à tort.
   */
  function feed(cat: NonNullable<LibraryServiceDeps['catalog']>, scanned: ScannedLocation, seen: Set<string>): void {
    const source = elementSources.find((s) => s.handles(scanned));
    if (!source) return;
    const ref = { plugin: source.id, instance: source.instance(scanned) };
    if (deps.claimed?.(ref.instance)) return;
    seen.add(refId(ref));
    if (scanned.complete) cat.setSource(ref, source.elementsOf(scanned));
  }

  /** Emplacements de la bibliothèque qui ne sont plus dans la configuration : leurs éléments quittent le catalogue. */
  function prune(cat: NonNullable<LibraryServiceDeps['catalog']>, seen: Set<string>): void {
    for (const ref of cat.sources()) if (isLibrarySource(ref.plugin) && !seen.has(refId(ref))) cat.removeSource(ref);
  }

  /** Fichiers qu'un plugin a mis au catalogue pour l'emplacement qu'il lit ; `null` si aucun plugin ne le lit. */
  function pluginItems(cat: NonNullable<LibraryServiceDeps['catalog']>, target: SourceTarget, kinds: ReadonlySet<MediaKind>): LibraryItem[] | null {
    const instance = locationInstance(target);
    if (!deps.claimed?.(instance)) return null;
    const ref = cat.sources().find((r) => r.instance === instance && !isLibrarySource(r.plugin));
    if (!ref) return [];
    return cat.keysOf(ref).flatMap((key) => {
      const e = cat.get(key);
      const item = e ? itemFromElement(e, kinds) : null;
      return item ? [item] : [];
    });
  }

  /** Le catalogue ne doit jamais empêcher la bibliothèque de répondre. */
  function guarded(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      onCatalogError(err as Error);
    }
  }

  return {
    /**
     * Analyse de toutes les sources ; renvoie aussi l'état de chacune (nombre d'éléments, erreur). `plugins: false` :
     * sans attendre de nouvelles analyses des plugins (le catalogue du cœur seulement suit la configuration).
     */
    async scan({ plugins = true }: { plugins?: boolean } = {}) {
      // Une source de plugin en panne ne bloque pas la bibliothèque : elle garde sa dernière analyse.
      if (plugins) await deps.pluginScans?.().catch((err: Error) => onCatalogError(err));
      const cfg = config.get();
      const opts: ScanOptions = { sources: cfg.library.sources, bookmarks: cfg.bookmarks || [] };
      const seen = new Set<string>();
      if (catalog) {
        opts.onScanned = (scanned) => guarded(() => feed(catalog, scanned, seen));
        opts.pluginItems = (target, kinds) => pluginItems(catalog, target, kinds);
      }
      const { items, status, subtitles } = await scan(opts);
      if (catalog) guarded(() => prune(catalog, seen));
      remote = subtitles;
      return { items, status };
    },
    itemFromPath: (p: unknown) => itemFromPath(p, { allowFile: access.allowFile }),
    findSubtitles: (videoPath: string) => findSubtitles(videoPath, { remote, isAllowed: access.isAllowed }),
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
