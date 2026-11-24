/** Bibliothèque : emplacements, fournisseurs de sources, analyse, sous-titres, fichiers ouverts. */
export { resolveLocation, locationError, type ResolvedLocation, type ResolveOptions } from './location.ts';
export { scanLibrary, bookmarkItem, MAX_ITEMS, DEFAULT_PROVIDERS, type ScanOptions } from './scan.ts';
export {
  librarySources,
  isLibrarySource,
  LIBRARY_SOURCE_TAGS,
  type LibraryElementSource,
  type LibraryLocation,
  type LibrarySourceId,
} from './element-sources.ts';
export { findSubtitles, type Subtitle, type SubtitleOptions } from './subtitles.ts';
export { itemFromPath, type ItemFromPathOptions } from './item-from-path.ts';
export { folderProvider, networkProvider, walkLibrary } from './providers/local.ts';
export { httpIndexProvider, crawlHttp, type CrawlVisitor } from './providers/http-index.ts';
export { m3uProvider, isM3uUrl } from './providers/m3u.ts';
export type * from './types.ts';
