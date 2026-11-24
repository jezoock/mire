/**
 * Tags automatiques des séries (contribution `taggers`, id `series`) : repris du cœur de Mire
 * (`src/main/catalog/tags/taggers.ts`, avant P5-09). « Friends S01E03 », ou « S01E03 » dans « Friends/Saison 1 » :
 * tag `series`, infos `series`, `season` et `episode`.
 */
import { fileOf } from './element.mjs';
import { parseEpisode, parseVideo } from './video.mjs';

/** Tags et infos d'un élément, ou `null` (pas une vidéo, ou pas un épisode). */
export function compute(e) {
  const file = fileOf(e, 'video');
  if (!file) return null;
  const p = parseVideo({ name: e.name, dir: file.dir });
  if (p.type !== 'tv') return null;
  const { season, episode } = parseEpisode(e.name);
  const infos = {};
  if (p.title) infos.series = p.title;
  if (season !== null) infos.season = season;
  if (episode !== null) infos.episode = episode;
  return { tags: ['series'], infos };
}

export default function createTagger() {
  return { id: 'series', compute };
}
