/**
 * Fichier de l'interface historique (`LibraryItem`) tiré d'un élément du catalogue : pour un emplacement lu par un
 * plugin (P5-11c), les vues Vidéos, Musique et Images, qui lisent encore les fichiers de l'analyse, retrouvent ceux
 * que le plugin a donnés. Le type vient de l'extension ; épisodes et saisons sont calculés ici, comme à l'analyse du
 * cœur.
 */
import path from 'node:path';
import { isHttpUrl, KIND, NATIVE, type Element, type MediaKind } from '@mire/shared';
import { addSeriesInfo } from './item.ts';
import type { LibraryItem } from './types.ts';

const image = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function itemFromElement(e: Readonly<Pick<Element, 'open' | 'infos' | 'images'>>, kinds: ReadonlySet<MediaKind>): LibraryItem | null {
  if (e.open.kind !== 'file' || isHttpUrl(e.open.path)) return null;
  const p = e.open.path;
  const ext = path.extname(p).toLowerCase();
  const kind = KIND[ext];
  if (!kind || !kinds.has(kind)) return null;
  const dir = path.dirname(p);
  const folder = e.infos?.folder;
  const item: LibraryItem = {
    path: p,
    name: path.basename(p, path.extname(p)),
    ext,
    kind,
    folder: typeof folder === 'string' ? folder : path.basename(dir),
    dir,
    native: NATIVE.has(ext),
    cover: kind === 'image' ? null : image(e.images?.poster),
    fanart: kind === 'image' ? null : image(e.images?.background),
  };
  if (kind === 'video') addSeriesInfo(item, dir);
  return item;
}
