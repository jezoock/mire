/**
 * Jeux à plusieurs disques : une liste `.m3u` cite ses disques (souvent des `.cue`), qui ne doivent pas apparaître
 * seuls. Reprise de la lecture des listes locales du cœur de Mire (`src/main/games/disc/index.ts`, `citedByPlaylists`
 * de `src/main/games/roms/list.ts`) ; le cœur garde la sienne pour les téléchargements et les sources en ligne.
 */
import { dirOf, isWindowsPath, pathKey } from './names.mjs';

/** Texte d'une liste : UTF-8, ou Latin-1 pour les vieux fichiers aux noms accentués. */
export function decode(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Le décodeur retire de lui-même la marque d'ordre des octets (BOM) en tête du texte.
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  let latin1 = '';
  for (const b of buf) latin1 += String.fromCharCode(b);
  return latin1;
}

/** Chemin relatif sûr : pas de chemin absolu, pas de remontée hors du dossier de la liste. */
export function safeRel(ref) {
  const clean = String(ref || '')
    .trim()
    .replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean)) return null;
  const parts = [];
  for (const p of clean.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') return null;
    parts.push(p);
  }
  return parts.length ? parts.join('/') : null;
}

/** Adresse complète (« https:… », « file:… ») : un schéma d'au moins deux lettres, pour ne pas confondre avec « C: ». */
const isAbsoluteUrl = (ref) => /^[a-z][a-z0-9+.-]+:/i.test(String(ref).trim());

/** Disques cités par une liste `.m3u` (chemins relatifs à son dossier, avec des `/`). */
export function m3uRefs(text) {
  const refs = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^"(.*)"$/, '$1'))
    .filter((r) => !isAbsoluteUrl(r))
    .map(safeRel)
    .filter((r) => !!r);
  return [...new Set(refs)];
}

const isPlaylist = (p) => /\.m3u$/i.test(p);

/** Disques cités par les listes `.m3u` parmi ces fichiers : leurs chemins sous forme de clé (`pathKey`). */
export async function citedByPlaylists(files, paths) {
  const hidden = new Set();
  for (const p of paths.filter(isPlaylist)) {
    const text = await files.readBytes(p).then(decode, () => null);
    if (text === null) continue;
    const win = isWindowsPath(p);
    const sep = win ? '\\' : '/';
    for (const ref of m3uRefs(text)) hidden.add(pathKey([dirOf(p), ...ref.split('/')].join(sep), win));
  }
  return hidden;
}
