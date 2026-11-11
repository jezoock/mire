/**
 * Marque-pages de jeux : un jeu repéré sur un site de téléchargement (page, lien direct ou .torrent), en attente de
 * téléchargement. La première fiche trouvée (jaquette, titre…) est enregistrée sous la clé du marque-page et affichée
 * sur sa carte ; une fois le jeu téléchargé, elle est reportée sur le jeu si son fichier est identifiable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DISC_INDEX_EXT, cleanRomName, isHttpUrl, newId } from '@mire/shared';
import type { Emulator, GameBookmark } from '@mire/shared';
import type { GameBookmarkInput } from '@mire/shared/ipc';
import { findConsole } from '../config/index.ts';
import { walkDirs } from '../fs/walk.ts';
import { guessSystem } from '../scraper.js';
import type { GamesDeps } from './types.ts';

/** Clé des infos d'un marque-page de jeu (même espace que `r:` et `g:` du scraper). */
export const bookmarkKey = (id: string) => `b:${id}`;

type Deps = Pick<GamesDeps, 'config' | 'downloads'>;

function titleFromSource(source: string): string {
  try {
    return decodeURIComponent(path.basename(new URL(source).pathname)).replace(/\.[a-z0-9]+$/i, '') || source;
  } catch {
    return path.basename(source) || source;
  }
}

// data : { source, title?, console? (console ouverte) }
export function addGameBookmark(deps: Deps, data: GameBookmarkInput) {
  const config = deps.config.get();
  const source = String(data?.source || '').trim();
  const isMagnet = /^magnet:\?/i.test(source);
  const isTorrentFile = source.toLowerCase().endsWith('.torrent');
  if (!isMagnet && !isHttpUrl(source) && !isTorrentFile) return { ok: false as const, error: 'Lien ou fichier invalide.' };
  const kind = isMagnet || isTorrentFile ? 'torrent' : 'http';
  const curConsole = data?.console == null ? null : String(data.console);
  // Console de jeux (pas « pc ») : son identifiant, même si elle n'existe plus.
  const isConsole = curConsole != null && curConsole !== 'pc';
  const curEmu = isConsole ? findConsole(config, curConsole) : null;
  const title = String(data?.title || '').trim() || titleFromSource(source);
  const system = curEmu ? guessSystem(curEmu) : '';
  // Système non déterminé : on le signale, l'interface demandera (console ouverte par défaut).
  const needSystem = !isConsole && !system;

  const bm: GameBookmark = { id: newId(), source, kind, title, console: curConsole, system, downloadId: null, done: false, added: Date.now() };
  // Entrée « en attente de téléchargement » dans le gestionnaire.
  const pending = deps.downloads().addPending(source, { name: title, gameBookmark: bm.id, console: isConsole ? curConsole : undefined });
  bm.downloadId = pending.id ?? null;
  const next = deps.config.update((c) => ({ ...c, gameBookmarks: [...c.gameBookmarks, bm] }));
  return { ok: true as const, bookmark: bm, needSystem, config: next };
}

/**
 * Cherche la fiche d'un marque-page (Steam pour un jeu PC, jaquettes libretro pour une console) et l'enregistre sous
 * sa clé. Rend vrai si une fiche a été trouvée ; une erreur de recherche n'empêche jamais l'ajout du marque-page.
 */
export async function findBookmarkInfo(deps: Pick<GamesDeps, 'config' | 'scraper'>, id: string): Promise<boolean> {
  const config = deps.config.get();
  const bm = config.gameBookmarks.find((b) => b.id === id);
  const scraper = deps.scraper();
  if (!bm || !scraper || bm.console == null) return false;
  const key = bookmarkKey(bm.id);
  try {
    if (bm.console === 'pc') return (await scraper.one({ kind: 'pc', item: { name: bm.title, path: bm.source }, key })).ok;
    if (!findConsole(config, bm.console)) return false;
    const item = { name: bm.title, displayName: cleanRomName(bm.title), path: `gbm:${bm.id}`, emu: bm.console };
    return (await scraper.one({ kind: 'rom', item, key })).ok;
  } catch (err) {
    console.error('Marque-page de jeu, recherche des infos :', (err as Error).message);
    return false;
  }
}

export function setGameBookmarkConsole(deps: Pick<GamesDeps, 'config'>, id: string, consoleId: unknown) {
  const ref = String(consoleId);
  const config = deps.config.update((c) => ({ ...c, gameBookmarks: c.gameBookmarks.map((b) => (b.id === id ? { ...b, console: ref } : b)) }));
  return { ok: true as const, config };
}

export function removeGameBookmark(deps: Pick<GamesDeps, 'config' | 'downloads' | 'scraper'>, id: string) {
  const bm = deps.config.get().gameBookmarks.find((b) => b.id === id);
  if (bm?.downloadId) deps.downloads().remove(bm.downloadId);
  deps.scraper()?.forget(bookmarkKey(id));
  const config = deps.config.update((c) => ({ ...c, gameBookmarks: c.gameBookmarks.filter((b) => b.id !== id) }));
  return { ok: true as const, config };
}

export function downloadGameBookmark(deps: Deps, id: string) {
  const bm = deps.config.get().gameBookmarks.find((b) => b.id === id);
  if (!bm) return { ok: false as const, error: 'Marque-page introuvable.' };
  deps.downloads().startPending(bm.downloadId as string);
  return { ok: true as const };
}

/** Ce que le marque-page lit d'une fiche de téléchargement terminée. */
export interface FinishedDownload {
  gameBookmark?: unknown;
  file?: unknown;
  dir?: string;
  name?: string;
}

const extOf = (f: string) => path.extname(f).toLowerCase();

/**
 * Fichier de jeu d'un téléchargement terminé, s'il est identifiable sans ambiguïté : le fichier lui-même, ou le seul
 * jeu de la console dans le dossier obtenu (archive décompressée, torrent). Une liste .m3u l'emporte sur les disques
 * qu'elle cite, un index de disque sur ses pistes.
 */
export async function identifyGameFile(item: FinishedDownload, emu: Emulator): Promise<string | null> {
  const file = typeof item.file === 'string' ? item.file : '';
  const roots = [file, file && file.slice(0, -extOf(file).length), item.dir && item.name ? path.join(item.dir, item.name) : ''].filter(Boolean);
  const root = roots.find((p) => fs.existsSync(p));
  if (!root) return null;
  if (fs.statSync(root).isFile()) return root;
  const exts = new Set((emu.extensions || []).map((e) => (String(e).startsWith('.') ? e : `.${e}`).toLowerCase()));
  const found: string[] = [];
  await walkDirs(
    root,
    (dir, entries) => {
      for (const e of entries) if (e.isFile() && (!exts.size || exts.has(extOf(e.name)))) found.push(path.join(dir, e.name));
    },
    { maxDepth: 3, shouldStop: () => found.length > 50 },
  );
  const tiers = [found.filter((f) => extOf(f) === '.m3u'), found.filter((f) => DISC_INDEX_EXT.has(extOf(f))), found];
  const best = tiers.find((t) => t.length);
  return best?.length === 1 ? best[0] : null;
}

/**
 * Fin du téléchargement d'un marque-page : il est marqué terminé (sa carte « à télécharger » disparaît) et sa fiche
 * est reportée sur le jeu de la console quand le fichier est identifiable.
 */
export async function onBookmarkDownloaded(deps: Pick<GamesDeps, 'config' | 'scraper'>, item: FinishedDownload): Promise<void> {
  const config = deps.config.get();
  const bm = config.gameBookmarks.find((b) => b.id === item.gameBookmark);
  if (!bm) return;
  deps.config.update((c) => ({ ...c, gameBookmarks: c.gameBookmarks.map((b) => (b.id === bm.id ? { ...b, done: true } : b)) }));
  const emu = bm.console != null && bm.console !== 'pc' ? findConsole(config, bm.console) : null;
  const scraper = deps.scraper();
  if (!emu || !scraper) return;
  const rom = await identifyGameFile(item, emu);
  if (rom) scraper.copy(bookmarkKey(bm.id), `r:${rom}`);
}
