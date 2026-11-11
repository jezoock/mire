/** Analyse des noms de fichiers vidéo, pour savoir quoi chercher. */
import { cleanTitle, GENERIC_DIR, parseEpisode } from '@mire/shared';

export interface ParsedVideo {
  type: 'movie' | 'tv';
  title: string;
  year: string;
}

/**
 * « Le.Fabuleux.Destin.2001.1080p.mkv » → film « Le Fabuleux Destin », 2001 ;
 * « S01E03.mkv » dans « Le Bureau des légendes/Saison 1 » → série « Le Bureau des légendes ».
 */
export function parseVideo(item: { name: string; dir?: string }): ParsedVideo {
  const name = item.name;
  const ep = parseEpisode(name);
  if (ep.index >= 0) {
    let title = cleanTitle(name.slice(0, ep.index));
    if (!title) {
      const parts = String(item.dir || '')
        .split(/[\\/]/)
        .filter(Boolean);
      const folder = parts[parts.length - 1] || '';
      title = GENERIC_DIR.test(folder) ? parts[parts.length - 2] || '' : folder;
      title = cleanTitle(title);
    }
    return { type: 'tv', title, year: '' };
  }
  const years = [...name.matchAll(/(?:^|[\s.(_[-])((?:19|20)\d{2})(?=$|[\s.)_\]-])/g)];
  let year = '';
  let title = name;
  if (years.length) {
    const last = years[years.length - 1];
    // Le séparateur capturé devant l'année est absent quand l'année ouvre le nom.
    const before = name.slice(0, last.index + last[0].length - last[1].length);
    if (cleanTitle(before)) {
      year = last[1];
      title = before;
    }
  }
  return { type: 'movie', title: cleanTitle(title), year };
}
