/**
 * Noms et clés des jeux, comme dans le cœur de Mire (`src/main/catalog/keys.ts`, `@mire/shared` `cleanRomName`).
 * Les chemins rendus par `ctx.files.walk` sont déjà normalisés par le système : il reste, sous Windows, les barres
 * obliques et la casse.
 */

/** Chemin Windows (`C:\…`, `\\serveur\…`). */
export const isWindowsPath = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);

/** Position du dernier séparateur d'un chemin. */
export const lastSep = (p, win = isWindowsPath(p)) => (win ? Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) : p.lastIndexOf('/'));

/** Dossier d'un chemin de fichier. */
export const dirOf = (p) => p.slice(0, Math.max(lastSep(p), 0));

/** Nom du fichier sans son extension. */
export function nameOf(p) {
  const file = p.slice(lastSep(p) + 1);
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Chemin sous sa forme de clé (`normalizePath` du cœur) : sous Windows, en minuscules et avec des `/`. */
export function pathKey(p, win = isWindowsPath(p)) {
  const s = String(p).trim();
  const n = win ? s.replace(/\\/g, '/').toLowerCase() : s;
  if (n.length <= 1 || !n.endsWith('/')) return n;
  return win && /^[a-z]:\/$/.test(n) ? n : n.slice(0, -1);
}

const escapePart = (s) => s.replace(/%/g, '%25').replace(/\|/g, '%7C');

/** Clé d'un jeu de console : `rom:<console>|<chemin>` (`romKey` du cœur). */
export const romKey = (consoleId, file, win = isWindowsPath(file)) => `rom:${escapePart(String(consoleId).trim())}|${pathKey(file, win)}`;

/** Retire les mentions entre parenthèses ou crochets : « Tetris (Europe) [!] » → « Tetris ». */
const stripTags = (s) => s.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();

/** Nom de jeu lisible : « Super Mario World (Europe) (En,Fr) [!] » → « Super Mario World ». */
export const cleanRomName = (name) => stripTags(name).replace(/_/g, ' ').trim() || name;
