/**
 * Noms tirés des dossiers et des fichiers de musique et d'images : titre d'un morceau, album, groupe de dossier.
 * Déplacé de `src/renderer/domain/items.ts` (P2-05) : les tags automatiques du processus principal et l'interface
 * historique s'en servent tous les deux.
 */
import { GENERIC_DIR } from './text.ts';

// Numéro de piste en tête du nom : « 01 - », « 3. », « 1-05 - », « 07_ », « 12 ».
const TRACK_PREFIX = /^(?:\d{1,2}[-.])?(\d{1,3})\s*[-._)]\s*|^(\d{2})\s+(?=\S)/;

/** Titre d'un morceau sans son numéro de piste : « 01 - One More Time » → « One More Time ». */
export const cleanTrack = (name: string): string => name.replace(TRACK_PREFIX, '') || name;

/** Numéro de piste en tête du nom (« 01 - One More Time » → 1), `null` s'il n'y en a pas. */
export function trackNumber(name: string): number | null {
  const m = TRACK_PREFIX.exec(name);
  if (!m || !name.slice(m[0].length)) return null;
  return Number(m[1] ?? m[2]);
}

/** Dossier d'album nommé « Artiste - Album » : l'artiste et l'album, sinon `null`. */
export function splitAlbumFolder(folder: unknown): { artist: string; album: string } | null {
  const m = /^(.+?)\s+-\s+(.+)$/.exec(String(folder ?? ''));
  return m ? { artist: m[1], album: m[2] } : null;
}

/** Ce dont les groupes de dossier ont besoin d'un élément : nom de son dossier et chemin de ce dossier. */
export interface FolderHint {
  folder?: string;
  dir?: string;
}

const parentName = (dir: unknown): string => {
  const parts = String(dir || '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
};

/** Titre d'un groupe de dossier. « Saison 1 » seul ne dit rien : on ajoute le dossier parent (le nom de la série). */
export function folderLabel(it: FolderHint): { title: string | undefined; sub: string } {
  const parent = GENERIC_DIR.test(it.folder || '') ? parentName(it.dir) : '';
  return parent ? { title: parent, sub: it.folder as string } : { title: it.folder, sub: '' };
}

/** Le même titre sur une ligne : « Ma série, Saison 1 ». */
export const folderText = (it: FolderHint): string | undefined => {
  const f = folderLabel(it);
  return f.sub ? `${f.title}, ${f.sub}` : f.title;
};
