/** Marque-pages : pages de streaming et jeux en attente de téléchargement. */
import { isHttpUrl, newId } from '@mire/shared';
import type { Bookmark, GameBookmark } from '@mire/shared';
import { isObjectLike, listOf } from './common.ts';

export function normalizeBookmarks(list: unknown): Bookmark[] {
  return listOf(list)
    .filter((b) => b && typeof b.url === 'string' && isHttpUrl(b.url))
    .map((b) => ({
      id: String(b.id || newId()),
      url: b.url,
      title: String(b.title || ''),
      type: b.type === 'tv' ? 'tv' : 'movie',
      season: b.season || null,
      episode: b.episode || null,
      site: String(b.site || ''),
      added: b.added || Date.now(),
    }));
}

export function normalizeGameBookmarks(list: unknown): GameBookmark[] {
  return listOf(list)
    .filter((b) => isObjectLike(b) && b.source)
    .map((b) => ({
      id: String(b.id || newId()),
      source: String(b.source),
      kind: b.kind === 'torrent' ? 'torrent' : 'http',
      title: String(b.title || ''),
      console: b.console == null || b.console === '' ? null : String(b.console),
      system: String(b.system || ''),
      downloadId: b.downloadId || null,
      done: b.done === true,
      added: b.added || Date.now(),
    }));
}
