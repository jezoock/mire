/**
 * Parcours d'un dossier de la bibliothèque (ex-`walkLibrary`). Les dossiers de cet ordinateur sont lus par le plugin
 * inclus `mire.source.local` (P5-11c) ; le cœur ne lit plus ainsi que les partages réseau (`networkProvider`), jusqu'à
 * leur propre plugin (P5-11d).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { KIND, NATIVE, COVER_RE, ART_RE, FANART_RE } from '@mire/shared';
import type { MediaKind } from '@mire/shared';
import { walkDirs, pathKey } from '../../fs/walk.ts';
import { locationError } from '../location.ts';
import { addSeriesInfo } from '../item.ts';
import type { LibraryItem, ScanContext, SourceProvider } from '../types.ts';

/** Profondeur maximale des dossiers parcourus sous la racine d'une source. */
export const MAX_DEPTH = 16;

const extOf = (name: string) => path.extname(name).toLowerCase();
const baseOf = (name: string) => path.basename(name, path.extname(name)).toLowerCase();
const SUBTITLE_EXTS = new Set(['.srt', '.vtt']);

// Éléments d'un dossier : affiches et fanart rattachés, images d'illustration écartées.
function itemsOfDir(dir: string, entries: Dirent[], kinds: ReadonlySet<MediaKind>, ctx: ScanContext): void {
  const { out, maxItems } = ctx;
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));

  const coverEntry = files.find((e) => COVER_RE.test(e.name));
  const folderCover = coverEntry ? path.join(dir, coverEntry.name) : null;
  const fanartEntry = files.find((e) => FANART_RE.test(e.name));
  const folderFanart = fanartEntry ? path.join(dir, fanartEntry.name) : null;

  // Images portant le nom d'une vidéo (film.jpg, film-poster.jpg) : ce sont des affiches.
  const imagesByBase = new Map<string, string>();
  const videoBases = new Set<string>();
  for (const e of files) {
    const kind = KIND[extOf(e.name)];
    if (kind === 'image') imagesByBase.set(baseOf(e.name), path.join(dir, e.name));
    if (kind === 'video') videoBases.add(baseOf(e.name));
  }
  const isPosterOfVideo = (b: string) => videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb|landscape)$/, ''));
  // Même règle que la recherche de sous-titres à l'ouverture (subtitles.ts) : nom qui commence par celui de la vidéo.
  const subs = ctx.localSubtitles ? entries.filter((e) => e.isFile() && SUBTITLE_EXTS.has(extOf(e.name))) : [];

  for (const e of files) {
    const ext = extOf(e.name);
    const kind = KIND[ext];
    if (!kind || !kinds.has(kind)) continue;
    const name = path.basename(e.name, path.extname(e.name));
    const b = name.toLowerCase();
    if (kind === 'image' && (ART_RE.test(e.name) || isPosterOfVideo(b))) continue;

    const item: LibraryItem = {
      path: path.join(dir, e.name),
      name,
      ext,
      kind,
      folder: path.basename(dir),
      dir,
      native: NATIVE.has(ext),
      cover: null,
      fanart: null,
    };
    if (kind === 'video') {
      addSeriesInfo(item, dir);
      item.cover = imagesByBase.get(b) || imagesByBase.get(`${b}-poster`) || folderCover;
      item.fanart = imagesByBase.get(`${b}-fanart`) || folderFanart;
      const mine = subs.filter((x) => baseOf(x.name).startsWith(b));
      if (mine.length)
        ctx.localSubtitles?.set(
          item.path,
          mine.map((x) => path.join(dir, x.name)),
        );
    }
    if (kind === 'audio') {
      item.cover = folderCover;
      item.fanart = folderFanart;
    }
    out.push(item);
    if (out.length >= maxItems) return;
  }
}

/** Parcourt `root` et ajoute ses éléments à `ctx.out` (dossiers cachés, `$…` et au-delà de MAX_DEPTH ignorés). */
export function walkLibrary(root: string, kinds: ReadonlySet<MediaKind>, ctx: ScanContext): Promise<void> {
  return walkDirs(root, (dir, entries) => itemsOfDir(dir, entries, kinds, ctx), {
    maxDepth: MAX_DEPTH,
    skipDir: (name) => name.startsWith('.') || name.startsWith('$'),
    shouldStop: () => ctx.out.length >= ctx.maxItems,
    dirKey: (dir) => pathKey(dir, ctx.platform),
  });
}

/** Parcours de n'importe quel dossier (tests, et base de `networkProvider`). */
export const folderProvider: SourceProvider = {
  id: 'folder',
  canHandle: (target) => target.resolved.type === 'path',
  async scan(target, kinds, ctx) {
    if (target.resolved.type !== 'path') return;
    const root = target.resolved.path;
    try {
      await fsp.access(root);
    } catch {
      throw new Error(locationError(target.location, target.resolved));
    }
    await walkLibrary(root, kinds, ctx);
  },
};

/** Partages réseau (`\\\\NAS\\Films`, `smb://…`) : le seul emplacement de fichiers que le cœur lit encore. */
export const networkProvider: SourceProvider = {
  ...folderProvider,
  id: 'network',
  canHandle: (target) => target.resolved.type === 'path' && target.resolved.network,
};
