/** Jeux : sources, lancement, consoles, sites de jeux, suppression, nettoyage et copie locale d'un jeu en ligne. */
import { SYSTEMS } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import { defaultRomSites } from '../../games/rom-sites.ts';
import { guessSystem } from '../../scrape/index.ts';
import { emulatorChoices, removeConsole, saveConsole, setConsoleEmulator, setGameEmulator, type ConsoleResult } from '../../games/consoles.ts';
import { t } from '../../i18n/current.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function gamesHandlers(ctx: MainContext) {
  const { games } = ctx;
  /** Enregistre la liste des consoles d'un résultat accepté ; un refus devient son message. */
  const commit = (r: ConsoleResult) => {
    if (!r.ok) return { ok: false as const, error: t(`games.consoles.errors.${r.code}`) };
    const config = ctx.config.update((c) => {
      c.emulators = r.emulators;
    });
    return { ok: true as const, id: r.id, config };
  };
  /** Jeu de console désigné par sa clé : sa console et son chemin (rien pour un autre élément). */
  const romOf = (key: unknown) => {
    const open = typeof key === 'string' && key ? ctx.tags.element(key)?.open : null;
    return open?.kind === 'game' ? { key: key as string, console: open.console, path: open.path } : null;
  };
  const gameGone = () => ({ ok: false as const, error: t('games.errors.gameGone') });
  return {
    scanGameSources: () => games.scanGameSources(),
    launchGamePath: (target) => games.launchGamePath(target),
    launchGame: (index) => games.launchGame(index),
    addGame: () => games.addGame(),
    listRoms: (consoleId, opts) => games.listRoms(consoleId, opts),
    launchRom: (consoleId, romPath, emulator) => games.launchRom(consoleId, romPath, emulator),
    // Consoles et émulateurs (P4-17) : la page ne modifie plus la liste des consoles elle-même.
    consoleSave: (input, id) => commit(saveConsole(ctx.config.get().emulators, input, id)),
    consoleRemove: (id) => commit(removeConsole(ctx.config.get().emulators, id)),
    consoleEmulators: (id) => emulatorChoices(ctx.config.get().emulators, id),
    consoleSetEmulator: (id, emulator) => commit(setConsoleEmulator(ctx.config.get().emulators, id, emulator)),
    gameEmulators: (key) => {
      const rom = romOf(key);
      const emulators = ctx.config.get().emulators;
      const emu = rom && findConsole(ctx.config.get(), rom.console);
      if (!rom || !emu) return gameGone();
      return {
        ok: true as const,
        console: emu.id,
        choices: emulatorChoices(emulators, emu.id),
        consoleDefault: emu.emulator ?? null,
        game: emu.gameEmulators?.[rom.key] ?? null,
      };
    },
    gameSetEmulator: (key, emulator) => {
      const rom = romOf(key);
      return rom ? commit(setGameEmulator(ctx.config.get().emulators, rom.console, rom.key, emulator)) : gameGone();
    },
    gameLaunch: (key, emulator) => {
      const rom = romOf(key);
      return rom ? games.launchRom(rom.console, rom.path, emulator) : gameGone();
    },
    gameDeleteElement: async (key) => {
      const rom = romOf(key);
      const r = await games.deleteGameElement((k) => ctx.tags.element(k), key);
      // La liste relue met le catalogue à jour : la carte du jeu supprimé disparaît des pages.
      if (r.ok && rom) await games.listRoms(rom.console).catch(() => null);
      return r;
    },
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
