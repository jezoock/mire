/** Marque-pages : pages de streaming et jeux à télécharger. */
import path from 'node:path';
import { hostOf, isHttpUrl, newId } from '@mire/shared';
import type { Bookmark, BookmarkInput, GameBookmark, GameBookmarkInput } from '@mire/shared/ipc';
import { guessSystem } from '../../scraper.js';
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
  ctx.config = ctx.saveConfig({ ...ctx.config, bookmarks: [...(ctx.config.bookmarks || []), bm] });
  // Scraping immédiat : on récupère la fiche TMDB à partir du titre (et du type choisi).
  let scraped = false;
  try {
    const item = { path: url, name: title, dir: site, kind: 'video' };
    const r = await ctx.scraper.one({ kind: 'video', item, override: { type, title, year: data.year || '' } });
    scraped = !!r?.ok;
  } catch (err) {
    console.error('Marque-page, scraping :', (err as Error).message);
  }
  return { ok: true as const, bookmark: bm, scraped, config: ctx.config };
}

export function removeBookmark(ctx: MainContext, id: string) {
  ctx.config = ctx.saveConfig({ ...ctx.config, bookmarks: (ctx.config.bookmarks || []).filter((b: { id: string }) => b.id !== id) });
  return { ok: true as const, config: ctx.config };
}

// Marque-page d'un jeu depuis un site de téléchargement : page du jeu, lien direct, ou .torrent.
// data : { source, title?, console? (console ouverte), kind? }
export function addGameBookmark(ctx: MainContext, data: GameBookmarkInput) {
  const { config } = ctx;
  const source = String(data?.source || '').trim();
  const isMagnet = /^magnet:\?/i.test(source);
  if (!isMagnet && !isHttpUrl(source) && !source.toLowerCase().endsWith('.torrent')) return { ok: false as const, error: 'Lien ou fichier invalide.' };
  const kind = isMagnet || source.toLowerCase().endsWith('.torrent') ? 'torrent' : 'http';
  const curConsole = data?.console === 'pc' ? 'pc' : data?.console != null ? Number(data.console) : null;
  const curEmu = typeof curConsole === 'number' ? config.emulators[curConsole] : null;

  // Titre : fourni, sinon déduit du lien.
  let title = String(data?.title || '').trim();
  if (!title) {
    try {
      title = decodeURIComponent(path.basename(new URL(source).pathname)).replace(/\.[a-z0-9]+$/i, '') || source;
    } catch {
      title = path.basename(source) || source;
    }
  }

  const system = curEmu ? guessSystem(curEmu) : '';

  // Système non déterminé : on le signale, l'interface demandera (console ouverte par défaut).
  const needSystem = typeof curConsole !== 'number' && !system;

  const bm: GameBookmark = { id: newId(), source, kind, title, console: curConsole, system, downloadId: null, done: false, added: Date.now() };
  // Entrée « en attente de téléchargement » dans le gestionnaire.
  const dlCtx = { name: title, gameBookmark: bm.id, console: typeof curConsole === 'number' ? curConsole : undefined };
  const pending = ctx.downloads.addPending(source, dlCtx);
  bm.downloadId = pending.id;
  ctx.config = ctx.saveConfig({ ...ctx.config, gameBookmarks: [...(ctx.config.gameBookmarks || []), bm] });
  return { ok: true as const, bookmark: bm, needSystem, config: ctx.config };
}

export function setGameBookmarkConsole(ctx: MainContext, id: string, consoleIdx: unknown) {
  const idx = consoleIdx === 'pc' ? 'pc' : Number(consoleIdx);
  ctx.config = ctx.saveConfig({
    ...ctx.config,
    gameBookmarks: (ctx.config.gameBookmarks || []).map((b: GameBookmark) => (b.id === id ? { ...b, console: idx } : b)),
  });
  return { ok: true as const, config: ctx.config };
}

export function removeGameBookmark(ctx: MainContext, id: string) {
  const bm = (ctx.config.gameBookmarks || []).find((b: GameBookmark) => b.id === id);
  if (bm?.downloadId) ctx.downloads.remove(bm.downloadId);
  ctx.config = ctx.saveConfig({ ...ctx.config, gameBookmarks: (ctx.config.gameBookmarks || []).filter((b: GameBookmark) => b.id !== id) });
  return { ok: true as const, config: ctx.config };
}

export function downloadGameBookmark(ctx: MainContext, id: string) {
  const bm = (ctx.config.gameBookmarks || []).find((b: GameBookmark) => b.id === id);
  if (!bm) return { ok: false as const, error: 'Marque-page introuvable.' };
  ctx.downloads.startPending(bm.downloadId);
  return { ok: true as const };
}

export function bookmarksHandlers(ctx: MainContext) {
  return {
    bookmarkAdd: (data) => addBookmark(ctx, data),
    bookmarkRemove: (id) => removeBookmark(ctx, id),
    // Rouvre la page d'un marque-page dans la vue intégrée.
    bookmarkOpen: (id) => ctx.webOpen(`bm:${id}`, null),
    gameBookmarkAdd: (data) => addGameBookmark(ctx, data),
    gameBookmarkSetConsole: (id, consoleIdx) => setGameBookmarkConsole(ctx, id, consoleIdx),
    gameBookmarkRemove: (id) => removeGameBookmark(ctx, id),
    gameBookmarkDownload: (id) => downloadGameBookmark(ctx, id),
  } satisfies Partial<IpcImplementations>;
}
