/** Fournisseur « m3u » : liste de lecture M3U en ligne. */
import path from 'node:path';
import { KIND, NATIVE, safeDecode } from '@mire/shared';
import * as http from '../../net/http.ts';
import { parseM3U } from '../../lib/m3u.js';
import type { SourceProvider } from '../types.ts';

/** Vrai si l'adresse désigne une liste de lecture (.m3u, .m3u8). Une adresse invalide n'en est pas une. */
export function isM3uUrl(url: string): boolean {
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export const m3uProvider: SourceProvider = {
  id: 'm3u',
  canHandle: (target) => target.resolved.type === 'url' && isM3uUrl(target.resolved.url),
  async scan(target, kinds, ctx) {
    if (target.resolved.type !== 'url') return;
    const url = target.resolved.url;
    let text: string;
    try {
      text = await http.getText(url, { timeout: 15000 });
    } catch {
      throw new Error('Liste de lecture inaccessible.');
    }
    const listName = safeDecode(new URL(url).pathname.split('/').pop() as string).replace(/\.m3u8?$/i, '');
    const fallbackKind = kinds.has('video') ? 'video' : kinds.has('audio') ? 'audio' : 'image';
    for (const e of parseM3U(text)) {
      let u: string;
      try {
        u = new URL(e.url, url).href;
      } catch {
        continue;
      }
      const ext = path.extname(new URL(u).pathname).toLowerCase();
      const kind = KIND[ext] || fallbackKind;
      if (!kinds.has(kind)) continue;
      const name = e.title || safeDecode(path.basename(new URL(u).pathname, ext)) || u;
      ctx.out.push({
        path: u,
        name,
        ext,
        kind,
        folder: listName,
        dir: url,
        native: !ext || NATIVE.has(ext) || ext === '.m3u8',
        cover: e.logo || null,
        fanart: null,
        remote: true,
      });
    }
  },
};
