/**
 * Récupération d'infos de base et d'une image pour les listes de Mire. Les sources sont des plugins à installer,
 * branchés par les ponts des plugins (`plugins/bridges.ts`) ; le cœur n'en a plus aucune à lui :
 *
 *   Films et séries : TMDB (`mire.tmdb`, P5-15)
 *   Albums          : MusicBrainz et Cover Art Archive (`mire.musicbrainz`, P5-16)
 *   Jeux de console : libretro-thumbnails et libretro-database (`mire.libretro`, P5-16)
 *   Jeux PC         : magasin Steam (`mire.steam`, P5-16)
 */
import { createScrapeEngine, type ScrapeEngineDeps } from './engine.ts';

export { createScrapeEngine, MISS_RETRY_MS, REV, type ScrapeEngine, type ScrapeEngineDeps, type OneJob, type CandidatesJob } from './engine.ts';
export { parseVideo, type ParsedVideo } from './parse.ts';
export { ScrapeRefusal } from './refusal.ts';
export { guessSystem } from '@mire/shared';
export type * from './types.ts';

export type ScraperDeps = Omit<ScrapeEngineDeps, 'providers'>;

/** Moteur sans source à lui : celles des plugins arrivent par `extraProviders`. */
export function createScraper(deps: ScraperDeps) {
  return createScrapeEngine({ ...deps, providers: [] });
}
