// Utilitaires de texte partagés : comparaison de titres, noms de fichiers, noms de ROM, épisodes.

/** Minuscules sans accents (« Été » → « ete ») ; ne retire pas les espaces aux extrémités. */
export const fold = (s: unknown): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Identifiant lisible : « Ma Vidéothèque — Été 2024 ! » → « ma-videotheque-ete-2024 ». */
export const slug = (s: unknown): string =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface SafeFileNameOptions {
  /** Longueur maximale (200 par défaut). */
  max?: number;
  /** Nom utilisé quand il ne reste rien (« fichier » par défaut). */
  fallback?: string;
}

/** Nom de fichier accepté par Windows : caractères interdits et caractères de contrôle remplacés par « _ ». */
export function safeFileName(s: unknown, { max = 200, fallback = 'fichier' }: SafeFileNameOptions = {}): string {
  // eslint-disable-next-line no-control-regex
  return (
    String(s || fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, max) || fallback
  );
}

// Tout ce qui suit une mention technique (résolution, source, codec, langue…) est retiré du titre.
const JUNK =
  /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|eac3|dts|truehd|atmos|10bit|multi|vff|vfq|vfi|vf2|vf|vostfr|vost|truefrench|french|subfrench|custom|proper|repack|extended|unrated|remastered|imax|internal|complete|integrale|intégrale)\b.*$/i;

/** Titre lisible d'après un nom de fichier vidéo : « Le.Fabuleux.Destin.1080p » → « Le Fabuleux Destin ». */
export function cleanTitle(s: unknown): string {
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
export const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

/** Clé de comparaison de titres : « Tom & Jerry ! » → « tom and jerry ». */
export const titleKey = (s: unknown): string =>
  fold(s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Coefficient de Dice sur les paires de lettres : 1 pour deux textes identiques, 0 sans paire commune. */
export function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

/**
 * Classe des résultats d'après leur titre : identique > commence par > contient, l'ordre d'origine départage.
 * (« Replaced » doit donner REPLACED, pas « The Farmer Was Replaced », même s'il arrive en second.)
 * Une année identique à `year` fait passer devant.
 */
export function rankByTitle<T>(list: T[], query: string, getTitle: (x: T) => unknown, getYear?: (x: T) => unknown, year?: string | number): T[] {
  const q = titleKey(query);
  return list
    .map((x, i) => {
      const t = titleKey(getTitle(x));
      let score = t === q ? 3 : t.startsWith(`${q} `) || q.startsWith(`${t} `) ? 1.5 : t.includes(q) ? 1 : 0;
      if (year && getYear && String(getYear(x) || '').slice(0, 4) === String(year)) score += 2;
      return { x, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.x);
}

/** Retire les mentions entre parenthèses ou crochets : « Tetris (Europe) [!] » → « Tetris ». */
export const stripTags = (s: string): string => s.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();

/** Nom de jeu lisible : « Super Mario World (Europe) (En,Fr) [!] » → « Super Mario World ». */
export const cleanRomName = (name: string): string => stripTags(name).replace(/_/g, ' ').trim() || name;

export interface Episode {
  season: number | null;
  episode: number | null;
  /** Position de la mention d'épisode dans le nom (-1 s'il n'y en a pas). */
  index: number;
}

/** Numéros de saison et d'épisode d'après le nom du fichier (S01E03, 1x03…). */
export function parseEpisode(name: string): Episode {
  const m = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(name) || /\b(\d{1,2})x(\d{2})\b/.exec(name);
  return m ? { season: Number(m[1]), episode: Number(m[2]), index: m.index } : { season: null, episode: null, index: -1 };
}

/** Ressemblance de deux noms : 1 identiques, 0,8 si l'un contient l'autre, sinon 0 (accents et ponctuation ignorés). */
export function similarity(a: unknown, b: unknown): number {
  const x = fold(a).replace(/[^a-z0-9]/g, '');
  const y = fold(b).replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  return 0;
}
