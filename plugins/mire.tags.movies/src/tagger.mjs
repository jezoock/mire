/**
 * Tags automatiques des films (contribution `taggers`, id `movie`) : repris du cœur de Mire
 * (`src/main/catalog/tags/taggers.ts`, avant P5-09). Toute vidéo qui n'est pas un épisode : tag `movie`, infos
 * `title` et `year` d'après le nom du fichier (« Amélie (2001) »).
 */
import { fileOf } from './element.mjs';
import { parseVideo } from './video.mjs';

/** Tags et infos d'un élément, ou `null` (pas une vidéo, ou un épisode). */
export function compute(e) {
  const file = fileOf(e, 'video');
  if (!file) return null;
  const p = parseVideo({ name: e.name, dir: file.dir });
  if (p.type !== 'movie') return null;
  const infos = {};
  if (p.title) infos.title = p.title;
  if (p.year) infos.year = Number(p.year);
  return { tags: ['movie'], infos };
}

export default function createTagger() {
  return { id: 'movie', compute };
}
