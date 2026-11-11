/** Marque-pages : pages de streaming et jeux à télécharger. */
import { hostOf, isHttpUrl, newId } from '@mire/shared';
import type { Bookmark, BookmarkInput } from '@mire/shared/ipc';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

// Marque-page d'une page de streaming : crée une entrée vidéo et la scrape aussitôt.
export async function addBookmark(ctx: MainContext, data: BookmarkInput) {
  const url = String(data?.url || '').trim();
  if (!isHttpUrl(url)) return { ok: false as const, error: 'Adresse de page invalide.' };
  const title = String(data?.title || '').trim();
  if (!title) return { ok: false as const, error: 'Donnez un titre à chercher (nom du film ou de la série).' };
  const type = data?.type === 'tv' ? 'tv' : 'movie';
  const site = hostOf(url).replace(/^www\./, '');
  const bm: Bookmark = {
    id: newId(),
    url,
    title,
    type,
    season: type === 'tv' && data.season ? Number(data.season) : null,
    episode: type === 'tv' && data.episode ? Number(data.episode) : null,
    site,
    added: Date.now(),
  };
  ctx.config.update((c) => ({ ...c, bookmarks: [...c.bookmarks, bm] }));
  // Scraping immédiat : on récupère la fiche TMDB à partir du titre (et du type choisi).
  let scraped = false;
  try {
    const item = { path: url, name: title, dir: site, kind: 'video' };
    const r = await ctx.scraper.one({ kind: 'video', item, override: { type, title, year: data.year || '' } });
    scraped = !!r?.ok;
  } catch (err) {
    console.error('Marque-page, scraping :', (err as Error).message);
  }
  return { ok: true as const, bookmark: bm, scraped, config: ctx.config.get() };
}

export function removeBookmark(ctx: MainContext, id: string) {
  const config = ctx.config.update((c) => ({ ...c, bookmarks: c.bookmarks.filter((b) => b.id !== id) }));
  return { ok: true as const, config };
}

export function bookmarksHandlers(ctx: MainContext) {
  return {
    bookmarkAdd: (data) => addBookmark(ctx, data),
    bookmarkRemove: (id) => removeBookmark(ctx, id),
    // Rouvre la page d'un marque-page dans la vue intégrée.
    bookmarkOpen: (id) => ctx.web.open(`bm:${id}`, null),
    // Marque-pages de jeux : service des jeux (src/main/games/bookmarks.ts).
    gameBookmarkAdd: (data) => ctx.games.addBookmark(data),
    gameBookmarkSetConsole: (id, consoleId) => ctx.games.setBookmarkConsole(id, consoleId),
    gameBookmarkRemove: (id) => ctx.games.removeBookmark(id),
    gameBookmarkDownload: (id) => ctx.games.downloadBookmark(id),
  } satisfies Partial<IpcImplementations>;
}
