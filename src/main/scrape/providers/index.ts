/** Les quatre sources d'infos, dans l'ordre où la récupération groupée les traite. */
import type { TmdbClient } from '../../net/tmdb.ts';
import type { MetadataProvider } from '../types.ts';
import { libretroProvider } from './libretro.ts';
import { musicBrainzProvider, type MusicBrainzOptions } from './musicbrainz.ts';
import { steamProvider } from './steam.ts';
import { tmdbProvider } from './tmdb.ts';

export { libretroProvider, bestMatch, romKey } from './libretro.ts';
export { musicBrainzProvider } from './musicbrainz.ts';
export { steamProvider } from './steam.ts';
export { tmdbProvider } from './tmdb.ts';

export function defaultProviders({ tmdb, musicBrainz }: { tmdb: TmdbClient; musicBrainz?: MusicBrainzOptions }): MetadataProvider[] {
  return [tmdbProvider(tmdb), musicBrainzProvider(musicBrainz), libretroProvider(), steamProvider()];
}
