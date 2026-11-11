/** Jeux : sources, lancement, consoles, sites de jeux, suppression, nettoyage et copie locale d'un jeu en ligne. */
import { SYSTEMS } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import { defaultRomSites } from '../../romsites.js';
import { guessSystem } from '../../scrape/index.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function gamesHandlers(ctx: MainContext) {
  const { games } = ctx;
  return {
    scanGameSources: () => games.scanGameSources(),
    launchGamePath: (target) => games.launchGamePath(target),
    launchGame: (index) => games.launchGame(index),
    addGame: () => games.addGame(),
    listRoms: (consoleId, opts) => games.listRoms(consoleId, opts),
    launchRom: (consoleId, romPath) => games.launchRom(consoleId, romPath),
    romListSource: (consoleId, only) => games.listRoms(consoleId, { online: true, only }),
    gameDelete: (ref) => games.deleteGame(ref),
    gamesCleanup: (online) => games.cleanup(online),
    romSites: (consoleId) => {
      const emu = consoleId === 'pc' ? null : findConsole(ctx.config.get(), consoleId);
      return {
        sites: ctx.web.consoleSites(consoleId),
        custom: consoleId === 'pc' ? true : Array.isArray(emu?.romSites),
        defaults: emu ? defaultRomSites(guessSystem(emu)) : [],
      };
    },
    romDownload: (consoleId, url) => games.downloadGame(consoleId, url),
    gameSystems: () => SYSTEMS.map(({ id, name }) => ({ id, name })),
  } satisfies Partial<IpcImplementations>;
}
