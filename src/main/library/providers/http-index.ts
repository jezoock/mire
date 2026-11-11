/** Fournisseur « http-index » : pages d'index d'un serveur web (Apache, nginx, NAS…). */
import path from 'node:path';
import { KIND, NATIVE, COVER_RE, ART_RE, FANART_RE, safeDecode } from '@mire/shared';
import type { MediaKind } from '@mire/shared';
import * as http from '../../net/http.ts';
import { addSeriesInfo } from '../item.ts';
import { isM3uUrl } from './m3u.ts';
import type { LibraryItem, ScanContext, SourceProvider } from '../types.ts';

// Raison affichée quand la première page d'index ne se charge pas.
function crawlError(err: { kind?: string; status?: number; message: string }): string {
  if (err.kind === 'timeout') return 'délai dépassé';
  if (err.kind === 'unreachable') return 'serveur injoignable';
  if (err.kind === 'status') return `le serveur a répondu avec le code ${err.status}`;
  return err.message;
}

export type CrawlVisitor = (dirUrl: string, dirName: string, files: URL[]) => void | Promise<void>;

/** Parcourt les pages d'index sans sortir du dossier de départ ; `onDir` reçoit les fichiers de chaque page. */
export async function crawlHttp(startUrl: string, onDir: CrawlVisitor, maxDirs = 400): Promise<void> {
  const base = new URL(startUrl.endsWith('/') ? startUrl : `${startUrl}/`);
  const queue = [base.href];
  const seen = new Set<string>();
  let first = true;
  while (queue.length && seen.size < maxDirs) {
    const dirUrl = queue.shift() as string;
    if (seen.has(dirUrl)) continue;
    seen.add(dirUrl);
    let html: string;
    try {
      html = await http.getText(dirUrl, { timeout: 15000 });
    } catch (err) {
      if (first) throw new Error(`Adresse inaccessible (${crawlError(err as Error)}).`);
      continue;
    }
    first = false;
    const files: URL[] = [];
    const dirPath = new URL(dirUrl).pathname;
    for (const m of html.matchAll(/href\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)')/gi)) {
      let u: URL;
      try {
        u = new URL(m[1] || m[2], dirUrl);
      } catch {
        continue;
      }
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
      if (u.pathname.endsWith('/')) {
        if (u.pathname.length > dirPath.length) queue.push(u.href);
        continue;
      }
      files.push(u);
    }
    const parts = dirPath.split('/').filter(Boolean);
    await onDir(dirUrl, safeDecode(parts[parts.length - 1] || base.hostname), files);
  }
}

const extOf = (n: string) => path.extname(n).toLowerCase();
const baseOf = (n: string) => path.basename(n, path.extname(n)).toLowerCase();

// Éléments d'une page d'index : affiches, fanart et sous-titres rattachés, images d'illustration écartées.
function itemsOfPage(dirUrl: string, dirName: string, files: URL[], kinds: ReadonlySet<MediaKind>, ctx: ScanContext): void {
  const { out, maxItems, subtitles } = ctx;
  const byName = files.map((u) => ({ u, name: safeDecode(u.pathname.split('/').pop() as string) }));
  const folderCover = byName.find((f) => COVER_RE.test(f.name))?.u.href || null;
  const folderFanart = byName.find((f) => FANART_RE.test(f.name))?.u.href || null;
  const images = new Map(byName.filter((f) => KIND[extOf(f.name)] === 'image').map((f) => [baseOf(f.name), f.u.href]));
  const videoBases = new Set(byName.filter((f) => KIND[extOf(f.name)] === 'video').map((f) => baseOf(f.name)));
  const subs = byName.filter((f) => ['.srt', '.vtt'].includes(extOf(f.name)));
  for (const f of byName) {
    const ext = extOf(f.name);
    const kind = KIND[ext];
    if (!kind || !kinds.has(kind) || out.length >= maxItems) continue;
    const b = baseOf(f.name);
    if (kind === 'image' && (ART_RE.test(f.name) || videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb)$/, '')))) continue;
    const item: LibraryItem = {
      path: f.u.href,
      name: path.basename(f.name, path.extname(f.name)),
      ext,
      kind,
      folder: dirName,
      dir: dirUrl,
      native: NATIVE.has(ext),
      cover: null,
      fanart: null,
      remote: true,
    };
    if (kind === 'video') {
      addSeriesInfo(item, dirUrl);
      item.cover = images.get(b) || images.get(`${b}-poster`) || folderCover;
      item.fanart = images.get(`${b}-fanart`) || folderFanart;
      const mine = subs.filter((x) => baseOf(x.name).startsWith(b));
      if (mine.length)
        subtitles.set(
          item.path,
          mine.map((x) => ({ url: x.u.href, name: x.name, base: b })),
        );
    }
    if (kind === 'audio') {
      item.cover = folderCover;
      item.fanart = folderFanart;
    }
    out.push(item);
  }
}

export const httpIndexProvider: SourceProvider = {
  id: 'http-index',
  canHandle: (target) => target.resolved.type === 'url' && !isM3uUrl(target.resolved.url),
  async scan(target, kinds, ctx) {
    if (target.resolved.type !== 'url') return;
    await crawlHttp(target.resolved.url, (dirUrl, dirName, files) => itemsOfPage(dirUrl, dirName, files, kinds, ctx));
  },
};
