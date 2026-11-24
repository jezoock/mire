// Analyse des noms de fichiers vidéo. Repris de Mire (`@mire/shared` : `cleanTitle`, `GENERIC_DIR`, `parseEpisode` ;
// `src/main/scrape/parse.ts` : `parseVideo`) : un plugin de code n'importe rien du cœur.

// Tout ce qui suit une mention technique (résolution, source, codec, langue…) est retiré du titre.
const JUNK =
  /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|eac3|dts|truehd|atmos|10bit|multi|vff|vfq|vfi|vf2|vf|vostfr|vost|truefrench|french|subfrench|custom|proper|repack|extended|unrated|remastered|imax|internal|complete|integrale|intégrale)\b.*$/i;

/** Titre lisible d'après un nom de fichier : « Le.Fabuleux.Destin.1080p » → « Le Fabuleux Destin ». */
export function cleanTitle(s) {
  return String(s)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(JUNK, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s([{-]+$/, '')
    .trim();
}

/** Dossier sans intérêt pour nommer une série (« Saison 1 », « Disc 2 »…). */
const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

/** Numéros de saison et d'épisode d'après le nom du fichier (S01E03, 1x03…), et la position de la mention (-1 sinon). */
export function parseEpisode(name) {
  const m = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(name) || /\b(\d{1,2})x(\d{2})\b/.exec(name);
  return m ? { season: Number(m[1]), episode: Number(m[2]), index: m.index } : { season: null, episode: null, index: -1 };
}

/**
 * « Le.Fabuleux.Destin.2001.1080p.mkv » → film « Le Fabuleux Destin », 2001 ;
 * « S01E03.mkv » dans « Le Bureau des légendes/Saison 1 » → série « Le Bureau des légendes ».
 */
export function parseVideo(item) {
  const name = String(item?.name ?? '');
  const ep = parseEpisode(name);
  if (ep.index >= 0) {
    let title = cleanTitle(name.slice(0, ep.index));
    if (!title) {
      const parts = String(item?.dir || '')
        .split(/[\\/]/)
        .filter(Boolean);
      const folder = parts[parts.length - 1] || '';
      title = cleanTitle(GENERIC_DIR.test(folder) ? parts[parts.length - 2] || '' : folder);
    }
    return { type: 'tv', title, year: '' };
  }
  // Une année postérieure à l'année prochaine fait partie du titre (« Blade Runner 2049 »).
  const latest = new Date().getFullYear() + 1;
  const years = [...name.matchAll(/(?:^|[\s.(_[-])((?:19|20)\d{2})(?=$|[\s.)_\]-])/g)].filter((m) => Number(m[1]) <= latest);
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
