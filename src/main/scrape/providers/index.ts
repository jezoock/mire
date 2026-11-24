/** Les sources d'infos du cœur, dans l'ordre où la récupération groupée les traite (TMDB : plugin `mire.tmdb`, P5-15). */
import type { MetadataProvider } from '../types.ts';
import { libretroProvider } from './libretro.ts';
import { musicBrainzProvider, type MusicBrainzOptions } from './musicbrainz.ts';
import { steamProvider } from './steam.ts';

export { libretroProvider, bestMatch, romKey } from './libretro.ts';
export { musicBrainzProvider } from './musicbrainz.ts';
export { steamProvider } from './steam.ts';

export function defaultProviders({ musicBrainz }: { musicBrainz?: MusicBrainzOptions } = {}): MetadataProvider[] {
  return [musicBrainzProvider(musicBrainz), libretroProvider(), steamProvider()];
}
