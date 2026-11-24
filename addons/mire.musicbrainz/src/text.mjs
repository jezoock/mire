// Nettoyage et classement des titres. Repris de Mire (`@mire/shared`, `text.ts`) : un plugin de code n'importe rien
// du cœur.

/** Minuscules sans accents (« Été » → « ete »). */
export const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Tout ce qui suit une mention technique (résolution, source, codec, langue…) est retiré du titre.
const JUNK =
  /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|eac3|dts|truehd|atmos|10bit|multi|vff|vfq|vfi|vf2|vf|vostfr|vost|truefrench|french|subfrench|custom|proper|repack|extended|unrated|remastered|imax|internal|complete|integrale|intégrale)\b.*$/i;

/** Titre lisible d'après un nom de dossier : « Discovery.[FLAC] » → « Discovery ». */
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

/** Clé de comparaison de titres : « Tom & Jerry ! » → « tom and jerry ». */
const titleKey = (s) =>
  fold(s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Classe des résultats d'après leur titre : identique > commence par > contient, l'ordre d'origine départage. */
export function rankByTitle(list, query, getTitle) {
  const q = titleKey(query);
  return list
    .map((x, i) => {
      const t = titleKey(getTitle(x));
      const score = t === q ? 3 : t.startsWith(`${q} `) || q.startsWith(`${t} `) ? 1.5 : t.includes(q) ? 1 : 0;
      return { x, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.x);
}
