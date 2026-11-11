/**
 * Récupération d'infos de base et d'une image pour les listes de Mire.
 *
 *   Films et séries : TMDB (clé gratuite à saisir dans Réglages)
 *   Albums          : MusicBrainz + Cover Art Archive (sans clé)
 *   Jeux de console : libretro-thumbnails, les jaquettes utilisées par RetroArch (sans clé)
 *   Jeux PC         : recherche du magasin Steam (sans clé)
 */
import { createTmdbClient } from '../net/tmdb.ts';
import { createScrapeEngine, type ScrapeEngineDeps } from './engine.ts';
import { defaultProviders } from './providers/index.ts';
import type { MusicBrainzOptions } from './providers/musicbrainz.ts';

export { createScrapeEngine, MISS_RETRY_MS, REV, type ScrapeEngine, type ScrapeEngineDeps, type OneJob, type CandidatesJob } from './engine.ts';
export { defaultProviders, tmdbProvider, musicBrainzProvider, libretroProvider, steamProvider, bestMatch, romKey } from './providers/index.ts';
export { parseVideo, type ParsedVideo } from './parse.ts';
export { ScrapeRefusal } from './refusal.ts';
export { guessSystem } from '@mire/shared';
export type * from './types.ts';

export type ScraperDeps = Omit<ScrapeEngineDeps, 'providers'> & { musicBrainz?: MusicBrainzOptions };

/** Moteur avec les quatre sources habituelles et le client TMDB (clé lue dans la configuration). */
export function createScraper(deps: ScraperDeps) {
  const tmdb = createTmdbClient({ key: () => deps.getConfig().search.tmdbToken, fetch: deps.fetch });
  return createScrapeEngine({ ...deps, providers: defaultProviders({ tmdb, musicBrainz: deps.musicBrainz }) });
}
