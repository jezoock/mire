/**
 * Fichier de l'interface historique (`LibraryItem`) tiré d'un élément du catalogue : pour un emplacement lu par un
 * plugin (P5-11c, P5-12), les vues Vidéos, Musique et Images, qui lisent encore les fichiers de l'analyse, retrouvent
 * ceux que le plugin a donnés : fichier de cet ordinateur, fichier d'un serveur web, ou flux d'une liste M3U. Le type
 * vient de l'extension (ou, pour un flux sans extension reconnue, de l'info `mediaType`) ; épisodes et saisons sont
 * calculés ici, comme à l'analyse du cœur.
 */
import path from 'node:path';
import { isHttpUrl, KIND, NATIVE, safeDecode, type Element, type MediaKind } from '@mire/shared';
import { addSeriesInfo } from './item.ts';
import type { LibraryItem } from './types.ts';

type Source = Readonly<Pick<Element, 'name' | 'open' | 'infos' | 'images'>>;

const image = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const textInfo = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function urlParts(u: string): { pathname: string; dir: string } | null {
  try {
    const url = new URL(u);
    return { pathname: url.pathname, dir: new URL('./', url).href };
  } catch {
    return null;
  }
}

function localItem(e: Source, p: string, kinds: ReadonlySet<MediaKind>): LibraryItem | null {
  const ext = path.extname(p).toLowerCase();
  const kind = KIND[ext];
  if (!kind || !kinds.has(kind)) return null;
  const dir = path.dirname(p);
  const item: LibraryItem = {
    path: p,
    name: path.basename(p, path.extname(p)),
    ext,
    kind,
    folder: textInfo(e.infos?.folder) ?? path.basename(dir),
    dir,
    native: NATIVE.has(ext),
    cover: kind === 'image' ? null : image(e.images?.poster),
    fanart: kind === 'image' ? null : image(e.images?.background),
  };
  if (kind === 'video') addSeriesInfo(item, dir);
  return item;
}

/** Fichier d'un serveur web (page d'index), comme l'analyse du cœur le rendait avant P5-12. */
function remoteItem(e: Source, u: string, kinds: ReadonlySet<MediaKind>): LibraryItem | null {
  const parts = urlParts(u);
  if (!parts) return null;
  const segment = safeDecode(parts.pathname.split('/').pop() ?? '');
  const ext = path.extname(segment).toLowerCase();
  const kind = KIND[ext];
  if (!kind || !kinds.has(kind)) return null;
  const item: LibraryItem = {
    path: u,
    name: e.name || path.basename(segment, path.extname(segment)),
    ext,
    kind,
    folder: textInfo(e.infos?.folder) ?? '',
    dir: parts.dir,
    native: NATIVE.has(ext),
    cover: kind === 'image' ? null : image(e.images?.poster),
    fanart: kind === 'image' ? null : image(e.images?.background),
    remote: true,
  };
  if (kind === 'video') addSeriesInfo(item, parts.dir);
  return item;
}

const MEDIA_KINDS: readonly MediaKind[] = ['video', 'audio', 'image'];

/** Flux d'une liste M3U (`list` : la liste, adresse ou chemin), comme l'analyse du cœur le rendait avant P5-12. */
function streamItem(e: Source, u: string, kinds: ReadonlySet<MediaKind>, list: string): LibraryItem | null {
  const parts = urlParts(u);
  if (!parts) return null;
  const ext = path.extname(parts.pathname).toLowerCase();
  const given = e.infos?.mediaType;
  const kind = KIND[ext] ?? (MEDIA_KINDS.includes(given as MediaKind) ? (given as MediaKind) : null);
  if (!kind || !kinds.has(kind)) return null;
  return {
    path: u,
    name: e.name || u,
    ext,
    kind,
    folder: textInfo(e.infos?.playlist) ?? '',
    dir: list,
    native: !ext || NATIVE.has(ext) || ext === '.m3u8',
    cover: image(e.images?.logo),
    fanart: null,
    remote: true,
  };
}

/** `location` : l'emplacement de la bibliothèque (tel que saisi) que le plugin a lu. */
export function itemFromElement(e: Source, kinds: ReadonlySet<MediaKind>, location = ''): LibraryItem | null {
  if (e.open.kind === 'stream') return streamItem(e, e.open.url, kinds, location);
  if (e.open.kind !== 'file') return null;
  return isHttpUrl(e.open.path) ? remoteItem(e, e.open.path, kinds) : localItem(e, e.open.path, kinds);
}
