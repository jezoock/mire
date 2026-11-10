/** Assemble les handlers de tous les domaines en une implémentation complète du contrat IPC. */
import { IPC_METHODS } from '@mire/shared/ipc';
import type { MainContext } from '../context.ts';
import { registerHandlers, type IpcImplementations, type IpcMainLike } from '../register.ts';
import { appHandlers } from './app.ts';
import { bookmarksHandlers } from './bookmarks.ts';
import { configHandlers } from './config.ts';
import { downloadsHandlers } from './downloads.ts';
import { gamesHandlers } from './games.ts';
import { libraryHandlers } from './library.ts';
import { metaHandlers } from './meta.ts';
import { scrapeHandlers } from './scrape.ts';
import { storeHandlers } from './store.ts';
import { tvHandlers } from './tv.ts';
import { webHandlers } from './web.ts';

/** Fabriques des handlers, une par domaine ; chaque méthode du contrat appartient à un seul domaine. */
export const DOMAINS = {
  app: appHandlers,
  bookmarks: bookmarksHandlers,
  config: configHandlers,
  downloads: downloadsHandlers,
  games: gamesHandlers,
  library: libraryHandlers,
  meta: metaHandlers,
  scrape: scrapeHandlers,
  store: storeHandlers,
  tv: tvHandlers,
  web: webHandlers,
};

export function createHandlers(ctx: MainContext): IpcImplementations {
  return Object.assign({}, ...Object.values(DOMAINS).map((domain) => domain(ctx)));
}

/** Enregistre auprès d'`ipcMain` un handler pour chaque méthode du contrat. */
export function registerIpc(ipcMain: IpcMainLike, ctx: MainContext): void {
  registerHandlers(ipcMain, IPC_METHODS, createHandlers(ctx));
}
