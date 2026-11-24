/**
 * Les sources d'infos du cœur, dans l'ordre où la récupération groupée les traite. TMDB : plugin `mire.tmdb` (P5-15) ;
 * MusicBrainz et Steam : plugins `mire.musicbrainz` et `mire.steam` (P5-16).
 */
import type { MetadataProvider } from '../types.ts';
import { libretroProvider } from './libretro.ts';

export { libretroProvider, bestMatch, romKey } from './libretro.ts';

export function defaultProviders(): MetadataProvider[] {
  return [libretroProvider()];
}
