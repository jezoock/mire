/**
 * Éléments d'une page d'index (reprise du fournisseur « http-index » du cœur de Mire, avant P5-12) : affiches et
 * fanart rattachés aux vidéos et à la musique, images d'illustration écartées de la galerie, sous-titres `.srt` et
 * `.vtt` posés à côté d'une vidéo (nom qui commence par celui de la vidéo).
 *
 * Chaque fichier garde la clé que lui donnait le cœur, `remote:<adresse normalisée>` (`src/main/catalog/keys.ts`,
 * `remoteFileKey`) : listes, reprise de lecture, fiches et tags le retrouvent. Mire ne la garde que pour un fichier
 * sous l'adresse de l'emplacement.
 */
import { ART_RE, COVER_RE, FANART_RE, KIND, SUBTITLE_EXTS } from './formats.mjs';
import { safeDecode } from './crawl.mjs';

/** Adresse sous sa forme de clé (comme `normalizeUrl` du cœur) : forme canonique de `URL`, sans fragment. */
export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.href;
  } catch {
    return u;
  }
}

/** Clé d'un fichier d'un serveur web : `remote:https://nas.local/films/a.mkv`. */
export const remoteFileKey = (url) => `remote:${normalizeUrl(url)}`;

const extOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};
const baseOf = (name) => {
  const ext = extOf(name);
  return (ext ? name.slice(0, -ext.length) : name).toLowerCase();
};

/** Objet sans les valeurs absentes ou vides : un élément ne garde que ce qu'on sait de lui. */
function compact(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
}

/**
 * Ajoute à `out` les éléments d'une page (`files` : adresses `URL`), des types demandés, sans dépasser `max`.
 */
export function pageElements(dirName, files, kinds, out, max) {
  const byName = files.map((u) => ({ u, name: safeDecode(u.pathname.split('/').pop()) }));
  const folderCover = byName.find((f) => COVER_RE.test(f.name))?.u.href || null;
  const folderFanart = byName.find((f) => FANART_RE.test(f.name))?.u.href || null;
  const images = new Map(byName.filter((f) => KIND[extOf(f.name)] === 'image').map((f) => [baseOf(f.name), f.u.href]));
  const videoBases = new Set(byName.filter((f) => KIND[extOf(f.name)] === 'video').map((f) => baseOf(f.name)));
  const subs = byName.filter((f) => SUBTITLE_EXTS.includes(extOf(f.name)));
  for (const f of byName) {
    const ext = extOf(f.name);
    const kind = KIND[ext];
    if (!kind || !kinds.has(kind) || out.length >= max) continue;
    const b = baseOf(f.name);
    if (kind === 'image' && (ART_RE.test(f.name) || videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb)$/, '')))) continue;
    let art = {};
    let subtitles = [];
    if (kind === 'video') {
      art = { poster: images.get(b) || images.get(`${b}-poster`) || folderCover, background: images.get(`${b}-fanart`) || folderFanart };
      subtitles = subs.filter((x) => baseOf(x.name).startsWith(b)).map((x) => x.u.href);
    }
    if (kind === 'audio') art = { poster: folderCover, background: folderFanart };
    out.push({
      key: remoteFileKey(f.u.href),
      name: ext ? f.name.slice(0, -ext.length) : f.name,
      open: { kind: 'file', path: f.u.href },
      tags: ['remote'],
      infos: compact({ folder: dirName, server: f.u.host, subtitles }),
      images: compact(art),
    });
  }
}
