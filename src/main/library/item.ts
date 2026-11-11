/** Règles communes aux éléments de la bibliothèque, quelle que soit leur source. */
import { parseEpisode } from '@mire/shared';
import { parseVideo } from '../scraper.js';
import type { LibraryItem } from './types.ts';

/** Épisode de série : titre de la série, saison et épisode d'après le nom du fichier et son dossier. */
export function addSeriesInfo(item: LibraryItem, dir: string): void {
  const p = parseVideo({ name: item.name, dir });
  if (p.type !== 'tv') return;
  item.seriesTitle = p.title;
  const { season, episode } = parseEpisode(item.name);
  Object.assign(item, { season, episode });
}
