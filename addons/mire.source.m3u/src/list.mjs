/**
 * Éléments d'une liste M3U (reprise du fournisseur « m3u » du cœur de Mire, avant P5-12) : une entrée par flux, avec
 * son titre et son logo ; le type de média vient de l'extension, ou à défaut de celui demandé à l'emplacement (info
 * `mediaType`, que le moteur de tags de Mire lit).
 *
 * Clés : celle que donnait le cœur, `m3u:<liste normalisée>|<adresse du flux normalisée>` (`src/main/catalog/keys.ts`,
 * `m3uEntryKey`) : listes, reprise de lecture, fiches et tags la retrouvent. Une liste de cet ordinateur peut aussi
 * citer des fichiers (chemin absolu, ou relatif à la liste) : Mire ne les garde que dans le dossier de la liste, qui
 * lui est accordé avec elle.
 */
import { KIND } from './formats.mjs';

const MEDIA_KINDS = ['video', 'audio', 'image'];

/** Décodage d'un segment d'adresse, tel quel s'il est mal encodé. */
function safeDecode(x) {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

export const isWebUrl = (s) => /^https?:\/\//i.test(String(s || ''));

/** Chemin Windows (`C:\…`, `\\serveur\partage\…`) : l'hôte isolé ne connaît pas le système, le chemin le dit. */
export const isWindowsPath = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);

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

/**
 * Chemin résolu (segments `.` et `..`, séparateurs doublés et final retirés), avec le séparateur du système du chemin.
 * Un `..` ne remonte pas au-dessus de la racine.
 */
export function cleanPath(p) {
  const win = isWindowsPath(p);
  const s = win ? p.replace(/\\/g, '/') : p;
  const unc = win && s.startsWith('//');
  const parts = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg !== '..') parts.push(seg);
    else if (parts.length > (win && !unc ? 1 : 0)) parts.pop();
  }
  if (!win) return `/${parts.join('/')}`;
  const joined = (unc ? '\\\\' : '') + parts.join('\\');
  return /^[a-zA-Z]:$/.test(joined) ? `${joined}\\` : joined;
}

/** Chemin sous sa forme de clé (comme `normalizePath` du cœur) : résolu ; sous Windows, en minuscules et avec des `/`. */
export function normalizePath(p) {
  const c = cleanPath(p);
  return isWindowsPath(p) ? c.replace(/\\/g, '/').toLowerCase() : c;
}

const escapePart = (s) => s.replace(/%/g, '%25').replace(/\|/g, '%7C');

/** Clé d'une entrée : `m3u:<liste>|<flux>` (`list` : adresse ou chemin de la liste). */
export function entryKey(list, target) {
  const l = isWebUrl(list) ? normalizeUrl(list) : normalizePath(list);
  return `m3u:${escapePart(l)}|${isWebUrl(target) ? normalizeUrl(target) : normalizePath(target)}`;
}

/** Nom de la liste, sans son extension (« chaines.m3u » → « chaines »). */
export function listName(list) {
  const last = isWebUrl(list) ? safeDecode(new URL(list).pathname.split('/').pop() || '') : list.split(/[\\/]/).pop() || '';
  return last.replace(/\.m3u8?$/i, '');
}

const extOf = (name) => {
  const file = name.split(/[\\/]/).pop() || '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(dot).toLowerCase() : '';
};

/** Fichier cité par une liste de cet ordinateur : chemin absolu, ou relatif au dossier de la liste. */
function localTarget(list, entry) {
  if (entry.startsWith('/') || isWindowsPath(entry)) return cleanPath(entry);
  const sep = isWindowsPath(list) ? Math.max(list.lastIndexOf('/'), list.lastIndexOf('\\')) : list.lastIndexOf('/');
  return cleanPath(`${list.slice(0, sep)}/${entry}`);
}

/** Éléments d'une liste (`list` : adresse ou chemin), pour les types demandés, sans dépasser `max`. */
export function listElements(list, entries, kinds, max) {
  const online = isWebUrl(list);
  const wanted = new Set(kinds.filter((k) => MEDIA_KINDS.includes(k)));
  const fallback = wanted.has('video') ? 'video' : wanted.has('audio') ? 'audio' : 'image';
  const playlist = listName(list);
  const out = [];
  for (const e of entries) {
    if (out.length >= max) break;
    let target;
    if (online || isWebUrl(e.url)) {
      try {
        target = new URL(e.url, online ? list : undefined).href;
      } catch {
        continue;
      }
      if (!isWebUrl(target)) continue;
    } else target = localTarget(list, e.url);
    const stream = isWebUrl(target);
    const pathname = stream ? new URL(target).pathname : target;
    const ext = extOf(pathname);
    // Un fichier de cet ordinateur doit être un média reconnu ; un flux sans extension prend le type demandé.
    const kind = KIND[ext] || (stream ? fallback : null);
    if (!kind || !wanted.has(kind)) continue;
    const base = (stream ? safeDecode(pathname.split('/').pop() || '') : pathname.split(/[\\/]/).pop()) || '';
    const name = e.title || (ext ? base.slice(0, -ext.length) : base) || target;
    out.push({
      key: entryKey(list, target),
      name,
      open: stream ? { kind: 'stream', url: target } : { kind: 'file', path: target },
      tags: [stream ? 'remote' : 'local'],
      infos: { playlist, ...(KIND[ext] ? {} : { mediaType: kind }) },
      images: isWebUrl(e.logo) ? { logo: e.logo } : {},
    });
  }
  return out;
}
