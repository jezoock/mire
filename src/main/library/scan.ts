/**
 * Analyse de toutes les sources de la bibliothèque : une même source déclarée pour plusieurs types n'est parcourue
 * qu'une fois ; l'état de chaque source (nombre d'éléments, erreur) est rendu avec les éléments, ainsi que les
 * sous-titres trouvés à côté des vidéos en ligne. Les marque-pages de streaming s'ajoutent comme des vidéos.
 */
import type { Bookmark, LibrarySource, MediaKind } from '@mire/shared';
import fsp from 'node:fs/promises';
import { pathKey } from '../fs/walk.ts';
import { locationError, resolveLocation } from './location.ts';
import { networkProvider } from './providers/local.ts';
import { httpIndexProvider } from './providers/http-index.ts';
import { m3uProvider } from './providers/m3u.ts';
import type { LibraryItem, RemoteSubtitles, ScanContext, ScannedLocation, ScanResult, SourceProvider, SourceStatus, SourceTarget } from './types.ts';
import { t } from '../i18n/current.ts';

/** Nombre maximal d'éléments d'une analyse. */
export const MAX_ITEMS = 150000;

/** Fournisseurs essayés dans l'ordre : le premier qui sait lire l'emplacement l'analyse. */
export const DEFAULT_PROVIDERS: readonly SourceProvider[] = [m3uProvider, httpIndexProvider, networkProvider];

export interface ScanOptions {
  sources: readonly LibrarySource[];
  bookmarks?: readonly Bookmark[];
  providers?: readonly SourceProvider[];
  maxItems?: number;
  platform?: NodeJS.Platform;
  /** Appelé après chaque emplacement analysé (catalogue d'éléments). */
  onScanned?: (scanned: ScannedLocation) => void;
  /**
   * Fichiers d'un emplacement lu par un plugin (P5-11c), ou `null` si aucun plugin ne le lit : le cœur ne le parcourt
   * pas, il vérifie seulement qu'il est accessible (état de la source).
   */
  pluginItems?: (target: SourceTarget, kinds: ReadonlySet<MediaKind>) => LibraryItem[] | null;
}

/** Message d'un dossier inaccessible ; `null` s'il est là (ou pour une adresse). */
async function unreachable(target: SourceTarget): Promise<string | null> {
  if (target.resolved.type !== 'path') return null;
  try {
    await fsp.access(target.resolved.path);
    return null;
  } catch {
    return locationError(target.location, target.resolved);
  }
}

interface SourceGroup {
  target: SourceTarget;
  kinds: Set<MediaKind>;
  sources: LibrarySource[];
}

// Regroupe les sources qui désignent le même emplacement.
function groupSources(sources: readonly LibrarySource[], platform?: NodeJS.Platform): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const src of sources) {
    const resolved = resolveLocation(src.location, platform ? { platform } : {});
    const k = resolved.type === 'url' ? resolved.url : pathKey(resolved.path, platform);
    if (!groups.has(k)) groups.set(k, { target: { location: src.location, resolved }, kinds: new Set(), sources: [] });
    const g = groups.get(k) as SourceGroup;
    g.kinds.add(src.kind);
    g.sources.push(src);
  }
  return [...groups.values()];
}

/** Marque-page de streaming présenté comme une vidéo qui rouvre la page du site. */
export function bookmarkItem(b: Bookmark): LibraryItem {
  const tv = b.type === 'tv';
  return {
    path: b.url,
    name: b.title || b.url,
    ext: '',
    kind: 'video',
    folder: b.site || t('library.streamingFolder'),
    dir: b.site || t('library.streamingFolder'),
    native: false,
    cover: null,
    fanart: null,
    bookmark: true,
    bookmarkId: b.id,
    series: tv,
    seriesTitle: tv ? b.title || '' : undefined,
    season: tv ? b.season || null : null,
    episode: tv ? b.episode || null : null,
    bookmarkType: b.type,
  };
}

export async function scanLibrary(opts: ScanOptions): Promise<ScanResult> {
  const { sources, bookmarks = [], providers = DEFAULT_PROVIDERS, maxItems = MAX_ITEMS, platform, onScanned, pluginItems } = opts;
  const items: LibraryItem[] = [];
  const subtitles: RemoteSubtitles = new Map();
  const status: Record<string, SourceStatus> = {};
  const ctx: ScanContext = { out: items, maxItems, subtitles, platform };
  if (onScanned) ctx.localSubtitles = new Map();
  const subtitlesOf = (p: string) => ctx.localSubtitles?.get(p) ?? subtitles.get(p)?.map((s) => s.url) ?? [];
  for (const g of groupSources(sources, platform)) {
    const start = items.length;
    let error: string | null = null;
    try {
      const taken = pluginItems?.(g.target, g.kinds);
      if (taken) {
        error = await unreachable(g.target);
        items.push(...taken.slice(0, Math.max(0, maxItems - items.length)));
      } else {
        const provider = providers.find((p) => p.canHandle(g.target));
        if (provider) await provider.scan(g.target, g.kinds, ctx);
      }
    } catch (err) {
      error = (err as Error).message;
    }
    for (const src of g.sources) {
      const count = items.slice(start).filter((it) => it.kind === src.kind).length;
      status[src.id] = { ok: !error, error, count };
    }
    // Nombre maximal atteint : la liste de cet emplacement peut être incomplète.
    const complete = !error && items.length < maxItems;
    onScanned?.({ target: g.target, kinds: g.kinds, items: items.slice(start), subtitles: subtitlesOf, complete });
  }
  for (const b of bookmarks) items.push(bookmarkItem(b));
  return { items, status, subtitles };
}
