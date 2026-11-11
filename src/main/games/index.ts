/**
 * Service des jeux : jeux PC (dossiers de jeux, ajout manuel), jeux de console (liste, lancement, copie locale),
 * nettoyage, suppression et marque-pages de jeux. Les dépendances (configuration, lanceur, téléchargements…) sont
 * injectées : le service ne connaît ni Electron ni la fenêtre.
 */
import type { GameRef, GameBookmarkInput } from '@mire/shared/ipc';
import * as bookmarks from './bookmarks.ts';
import { cleanupGames } from './cleanup.ts';
import { deleteGame } from './delete.ts';
import { addGame, launchGame, launchGamePath } from './pc/launch.ts';
import { localPcProvider, scanGameSources } from './pc/scanner.ts';
import { downloadGame } from './roms/download.ts';
import { launchRom } from './roms/launch.ts';
import { consoleLocations, listRoms, type ListOptions } from './roms/list.ts';
import type { GamesDeps } from './types.ts';

export { consoleLocations, listRoms, citedByPlaylists } from './roms/list.ts';
export { bestExecutable, gameFileExtensions, JUNK_EXE, localPcProvider, scanGameSources } from './pc/scanner.ts';
export { bookmarkKey, identifyGameFile } from './bookmarks.ts';
export type * from './types.ts';

export function createGames(deps: GamesDeps) {
  const providers = deps.providers || [localPcProvider(deps.platform)];
  return {
    scanGameSources: () => scanGameSources(deps.config.get().gameSources, providers),
    launchGame: (index: number) => launchGame(deps, index),
    launchGamePath: (target: unknown) => launchGamePath(deps, target),
    addGame: () => addGame(deps),
    consoleLocations,
    listRoms: (consoleId: unknown, opts?: ListOptions) => listRoms(deps, consoleId, opts),
    launchRom: (consoleId: unknown, romPath: string) => launchRom(deps, consoleId, romPath),
    downloadGame: (consoleId: string, url: string) => downloadGame(deps, consoleId, url),
    deleteGame: (ref: GameRef) => deleteGame(deps, ref),
    cleanup: (online?: boolean) => cleanupGames(deps, online),
    // Marque-pages : l'ajout est immédiat ; seule la recherche de la fiche est asynchrone.
    async addBookmark(data: GameBookmarkInput) {
      const r = bookmarks.addGameBookmark(deps, data);
      if (!r.ok) return r;
      const scraped = r.needSystem ? false : await bookmarks.findBookmarkInfo(deps, r.bookmark.id);
      return { ...r, scraped };
    },
    async setBookmarkConsole(id: string, consoleId: unknown) {
      bookmarks.setGameBookmarkConsole(deps, id, consoleId);
      const scraped = await bookmarks.findBookmarkInfo(deps, id);
      return { ok: true as const, scraped, config: deps.config.get() };
    },
    removeBookmark: (id: string) => bookmarks.removeGameBookmark(deps, id),
    downloadBookmark: (id: string) => bookmarks.downloadGameBookmark(deps, id),
    onBookmarkDownloaded: (item: bookmarks.FinishedDownload) => bookmarks.onBookmarkDownloaded(deps, item),
  };
}

export type Games = ReturnType<typeof createGames>;
