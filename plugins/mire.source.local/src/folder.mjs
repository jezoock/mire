/**
 * Éléments d'un dossier de la bibliothèque, à partir des fichiers trouvés par `ctx.files.walk` : reprise du
 * fournisseur « local » du cœur de Mire (`src/main/library/providers/local.ts`, `walkLibrary`, avant P5-11c).
 *
 * Par dossier : les affiches et fonds rattachés aux vidéos et à la musique (image du même nom que la vidéo,
 * `film-poster.jpg`, `film-fanart.jpg`, ou `cover.jpg`, `fanart.jpg`… du dossier), les illustrations écartées des
 * images, les sous-titres posés à côté d'une vidéo (nom qui commence par celui de la vidéo).
 *
 * Chaque fichier garde la clé que lui donnait le cœur, `local:<chemin normalisé>` (`src/main/catalog/keys.ts`,
 * `localFileKey`) : listes, reprise de lecture, fiches et tags le retrouvent.
 */
import { ART_RE, COVER_RE, FANART_RE, KIND, SUBTITLE_EXTS } from './formats.mjs';

/** Chemin Windows (`C:\…`, `\\serveur\partage\…`) : l'hôte isolé ne connaît pas le système, le chemin le dit. */
export const isWindowsPath = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);

const lastSep = (p, win) => (win ? Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) : p.lastIndexOf('/'));

/**
 * Clé d'un fichier : celle du cœur (`localFileKey`). Les chemins rendus par `walk` sont déjà normalisés par le
 * système (`path.join`) : il reste, sous Windows, les barres obliques et la casse.
 */
export function fileKey(p, win = isWindowsPath(p)) {
  return `local:${win ? p.replace(/\\/g, '/').toLowerCase() : p}`;
}

/** Morceaux d'un chemin de fichier : dossier, nom complet, nom sans extension, extension en minuscules. */
function parts(p, win) {
  const i = lastSep(p, win);
  const dir = p.slice(0, i);
  const file = p.slice(i + 1);
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
  return { dir, file, name: ext ? file.slice(0, dot) : file, ext };
}

/** Nom d'un dossier (vide pour la racine d'un disque). */
function folderName(dir, win) {
  if (win && /^[a-zA-Z]:$/.test(dir)) return '';
  return dir.slice(lastSep(dir, win) + 1);
}

/** Objet sans les valeurs absentes ou vides : un élément ne garde que ce qu'on sait de lui. */
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  return out;
}

/** Fichiers groupés par dossier, dans l'ordre où ils arrivent. */
function byDir(paths, win) {
  const dirs = new Map();
  for (const p of paths) {
    const f = { path: p, ...parts(p, win) };
    const list = dirs.get(f.dir);
    if (list) list.push(f);
    else dirs.set(f.dir, [f]);
  }
  return dirs;
}

// Éléments d'un dossier : affiches et fanart rattachés, images d'illustration écartées.
function elementsOfDir(dir, files, kinds, win, out, max) {
  const cover = files.find((f) => COVER_RE.test(f.file));
  const fanart = files.find((f) => FANART_RE.test(f.file));
  const folderCover = cover ? cover.path : null;
  const folderFanart = fanart ? fanart.path : null;

  // Images portant le nom d'une vidéo (film.jpg, film-poster.jpg) : ce sont des affiches.
  const imagesByBase = new Map();
  const videoBases = new Set();
  for (const f of files) {
    const kind = KIND[f.ext];
    if (kind === 'image') imagesByBase.set(f.name.toLowerCase(), f.path);
    if (kind === 'video') videoBases.add(f.name.toLowerCase());
  }
  const isPosterOfVideo = (b) => videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb|landscape)$/, ''));
  const subs = files.filter((f) => SUBTITLE_EXTS.includes(f.ext));
  const folder = folderName(dir, win);

  for (const f of files) {
    const kind = KIND[f.ext];
    if (!kind || !kinds.has(kind)) continue;
    const b = f.name.toLowerCase();
    if (kind === 'image' && (ART_RE.test(f.file) || isPosterOfVideo(b))) continue;
    let images = {};
    let subtitles = [];
    if (kind === 'video') {
      images = { poster: imagesByBase.get(b) || imagesByBase.get(`${b}-poster`) || folderCover, background: imagesByBase.get(`${b}-fanart`) || folderFanart };
      subtitles = subs.filter((s) => s.name.toLowerCase().startsWith(b)).map((s) => s.path);
    }
    if (kind === 'audio') images = { poster: folderCover, background: folderFanart };
    out.push({
      key: fileKey(f.path, win),
      name: f.name,
      open: { kind: 'file', path: f.path },
      tags: ['local'],
      infos: compact({ folder, subtitles }),
      images: compact(images),
    });
    if (out.length >= max) return;
  }
}

/**
 * Éléments des fichiers trouvés sous `root` : seulement les types demandés (`kinds`), au plus `max`. `paths` sont
 * des chemins complets, tels que les rend `walk` (dossiers et fichiers cachés déjà écartés).
 */
export function elementsOf(root, paths, kinds, max = Infinity) {
  const win = isWindowsPath(root);
  const wanted = new Set(kinds);
  const out = [];
  for (const [dir, files] of byDir(paths, win)) {
    elementsOfDir(dir, files, wanted, win, out, max);
    if (out.length >= max) break;
  }
  return out;
}
