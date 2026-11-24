/**
 * Bibliothèque vue du reste de l'application : analyse des sources de la configuration, élément d'un fichier
 * ouvert, sous-titres d'une vidéo. Garde les sous-titres des vidéos en ligne trouvés par la dernière analyse.
 * Chaque analyse alimente aussi le catalogue d'éléments, un emplacement à la fois (`element-sources.ts`).
 */
import path from 'node:path';
import { isHttpUrl, safeDecode, type Config, type Element, type ElementSourceRef, type MediaKind } from '@mire/shared';
import type { Catalog } from '../catalog/index.ts';
import { urlGranted } from '../plugins/permissions.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import { isLibrarySource, librarySources, locationInstance, type LibraryElementSource } from './element-sources.ts';
import { resolveLocation } from './location.ts';
import { itemFromElement } from './from-element.ts';
import { itemFromPath } from './item-from-path.ts';
import { scanLibrary, unreachable, type ScanOptions } from './scan.ts';
import { findSubtitles, type Subtitle } from './subtitles.ts';
import { t } from '../i18n/current.ts';
import type { LibraryItem, RemoteSubtitle, RemoteSubtitles, ScannedLocation, ScanResult, SourceTarget } from './types.ts';

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
  /**
   * Message de la dernière analyse en échec d'un emplacement lu par un plugin (instance), texte brut du plugin ;
   * `null` si elle a réussi (P5-12). Montré comme état de la source, dans un texte du cœur.
   */
  pluginFailure?: (instance: string) => string | null;
  /** Sous-titres trouvés par les plugins pour une vidéo locale déjà autorisée (P5-11b). */
  pluginSubtitles?: (videoPath: string) => Promise<Subtitle[]>;
  /** Un emplacement n'a pas pu alimenter le catalogue (journal par défaut) ; l'analyse continue. */
  onCatalogError?: (err: Error) => void;
  /** Sources d'éléments du cœur (tests : une source factice) ; par défaut `librarySources()`. */
  sources?: LibraryElementSource[];
}

const refId = (ref: ElementSourceRef) => JSON.stringify([ref.plugin, ref.instance]);

const SUBTITLE = /\.(srt|vtt)$/i;

/**
 * Sous-titres d'une vidéo d'un serveur web lue par un plugin (info `subtitles`, P5-12) : le cœur les télécharge à
 * l'ouverture, donc seulement des `.srt` ou `.vtt` de la même origine, sous l'adresse de l'emplacement (comme l'accord
 * du plugin), au plus 32.
 */
function remoteSubtitlesOf(e: Readonly<Element>, item: LibraryItem, target: SourceTarget): RemoteSubtitle[] {
  const list = e.infos?.subtitles;
  if (!item.remote || item.kind !== 'video' || target.resolved.type !== 'url' || !Array.isArray(list)) return [];
  const grant = [target.resolved.url];
  const base = path.basename(safeDecode(new URL(item.path).pathname.split('/').pop() ?? ''), item.ext).toLowerCase();
  return list
    .filter((u): u is string => typeof u === 'string' && isHttpUrl(u))
    .flatMap((u) => {
      try {
        const url = new URL(u);
        const name = safeDecode(url.pathname.split('/').pop() ?? '');
        return SUBTITLE.test(name) && urlGranted(url, grant) ? [{ url: url.href, name, base }] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 32);
}

export function createLibraryService(deps: LibraryServiceDeps) {
  const { config, access, catalog, scan = scanLibrary } = deps;
  const elementSources = deps.sources ?? librarySources();
  const ownSource = (plugin: string) => isLibrarySource(plugin) || elementSources.some((s) => s.id === plugin);
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
    for (const ref of cat.sources()) if (ownSource(ref.plugin) && !seen.has(refId(ref))) cat.removeSource(ref);
  }

  /** Fichiers qu'un plugin a mis au catalogue pour l'emplacement qu'il lit ; `null` si aucun plugin ne le lit. */
  function pluginItems(
    cat: NonNullable<LibraryServiceDeps['catalog']>,
    target: SourceTarget,
    kinds: ReadonlySet<MediaKind>,
    subtitles: RemoteSubtitles,
  ): LibraryItem[] | null {
    const instance = locationInstance(target);
    if (!deps.claimed?.(instance)) return null;
    const ref = cat.sources().find((r) => r.instance === instance && !ownSource(r.plugin));
    if (!ref) return [];
    const where = target.resolved.type === 'url' ? target.resolved.url : target.resolved.path;
    return cat.keysOf(ref).flatMap((key) => {
      const e = cat.get(key);
      const item = e ? itemFromElement(e, kinds, where) : null;
      if (!e || !item) return [];
      const subs = remoteSubtitlesOf(e, item, target);
      if (subs.length) subtitles.set(item.path, subs);
      return [item];
    });
  }

  /** Échec de la dernière analyse du plugin qui lit cet emplacement, dans un texte du cœur ; `null` sinon. */
  function failureOf(target: SourceTarget): string | null {
    const message = deps.pluginFailure?.(locationInstance(target));
    if (message == null) return null;
    return message ? t('library.errors.sourceFailed', { details: message }) : t('library.errors.sourceFailedPlain');
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
      // État des dossiers et des partages vérifié pendant les analyses des plugins, pas après : un partage réseau
      // absent ne fait attendre qu'une fois (le plugin et le cœur le découvrent en même temps).
      const checks = new Map<string, Promise<string | null>>();
      for (const src of catalog ? config.get().library.sources : []) {
        const resolved = resolveLocation(src.location);
        if (resolved.type === 'path' && !checks.has(resolved.path)) checks.set(resolved.path, unreachable({ location: src.location, resolved }));
      }
      // Une source de plugin en panne ne bloque pas la bibliothèque : elle garde sa dernière analyse.
      if (plugins) await deps.pluginScans?.().catch((err: Error) => onCatalogError(err));
      const cfg = config.get();
      const opts: ScanOptions = { sources: cfg.library.sources, bookmarks: cfg.bookmarks || [] };
      const seen = new Set<string>();
      // Sous-titres des vidéos en ligne lues par un plugin (P5-12).
      const fromPlugins: RemoteSubtitles = new Map();
      if (catalog) {
        opts.onScanned = (scanned) => guarded(() => feed(catalog, scanned, seen));
        opts.pluginItems = (target, kinds) => pluginItems(catalog, target, kinds, fromPlugins);
        opts.unreachable = async (target) =>
          (await ((target.resolved.type === 'path' && checks.get(target.resolved.path)) || unreachable(target))) ?? failureOf(target);
      }
      const { items, status, subtitles } = await scan(opts);
      if (catalog) guarded(() => prune(catalog, seen));
      remote = new Map([...subtitles, ...fromPlugins]);
      return { items, status };
    },
    itemFromPath: (p: unknown) => itemFromPath(p, { allowFile: access.allowFile }),
    findSubtitles: (videoPath: unknown) => findSubtitles(videoPath, { remote, isAllowed: access.isAllowed, plugins: deps.pluginSubtitles }),
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
