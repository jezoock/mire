// Noms tirés des dossiers et des fichiers de musique. Repris de Mire (`@mire/shared` : `folders.ts`, `GENERIC_DIR`) :
// un plugin de code n'importe rien du cœur.

/** Dossier sans intérêt pour nommer un album (« CD 2 », « Disc 1 »…). */
const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

// Numéro de piste en tête du nom : « 01 - », « 3. », « 1-05 - », « 07_ », « 12 ».
const TRACK_PREFIX = /^(?:\d{1,2}[-.])?(\d{1,3})\s*[-._)]\s*|^(\d{2})\s+(?=\S)/;

/** Titre d'un morceau sans son numéro de piste : « 01 - One More Time » → « One More Time ». */
export const cleanTrack = (name) => name.replace(TRACK_PREFIX, '') || name;

/** Numéro de piste en tête du nom (« 01 - One More Time » → 1), `null` s'il n'y en a pas. */
export function trackNumber(name) {
  const m = TRACK_PREFIX.exec(name);
  if (!m || !name.slice(m[0].length)) return null;
  return Number(m[1] ?? m[2]);
}

/** Dossier d'album nommé « Artiste - Album » : l'artiste et l'album, sinon `null`. */
export function splitAlbumFolder(folder) {
  const m = /^(.+?)\s+-\s+(.+)$/.exec(String(folder ?? ''));
  return m ? { artist: m[1], album: m[2] } : null;
}

/** Nom d'un album rangé dans des dossiers : le dossier, ou son parent pour un « CD 2 ». */
export function albumName(folder, dir) {
  if (!GENERIC_DIR.test(folder || '')) return folder;
  const parts = String(dir || '')
    .split(/[\\/]/)
    .filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : '') || folder;
}
