/** Bibliothèque : emplacements, analyse, sous-titres, fichiers ouverts. */
export { resolveLocation, locationError, type ResolvedLocation, type ResolveOptions } from './location.ts';
export { scanLibrary, bookmarkItem, MAX_ITEMS, DEFAULT_PROVIDERS, type ScanOptions } from './scan.ts';
export {
  librarySources,
  librarySource,
  isLibrarySource,
  LIBRARY_SOURCE_TAGS,
  type LibraryElementSource,
  type LibraryLocation,
  type LibrarySourceId,
} from './element-sources.ts';
export { findSubtitles, type Subtitle, type SubtitleOptions } from './subtitles.ts';
export { itemFromPath, type ItemFromPathOptions } from './item-from-path.ts';
export type * from './types.ts';
