/** Boutique : catalogue, installation des consoles, import de jeux, BIOS, dossier des jeux. */
import fsp from 'node:fs/promises';
import { findConsole } from '../../config/index.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';
import { t } from '../../i18n/current.ts';

export function storeHandlers(ctx: MainContext) {
  return {
    storeCatalog: () => ctx.store.catalog(),
    storeInstall: (id, systems) => ctx.store.install(id, systems),
    storeUninstall: (id) => ctx.store.uninstall(id),
    storeGame: (id) => ctx.store.getGame(id),
    storeImport: async (consoleId) => {
      const emu = findConsole(ctx.config.get(), consoleId);
      if (!emu) return { ok: false, error: t('store.errors.unknownConsole') };
      const exts = (emu.extensions || []).map((e: unknown) => String(e).replace(/^\./, ''));
      const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
        title: t('dialogs.importGames', { console: String(emu.name) }),
        properties: ['openFile', 'multiSelections'],
        filters: [...(exts.length ? [{ name: emu.name, extensions: exts }] : []), { name: t('dialogs.filters.allFiles'), extensions: ['*'] }],
      });
      if (r.canceled) return { ok: true, count: 0 };
      return ctx.store.importFiles(consoleId, r.filePaths);
    },
    storePickRoot: async () => {
      const p = await ctx.pickFolder();
      if (!p) return null;
      return ctx.config.update((c) => ({ ...c, store: { ...c.store, romsRoot: p } }));
    },
    biosAdd: async (id) => {
      const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
        title: t('dialogs.chooseBios'),
        properties: ['openFile', 'multiSelections'],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      return ctx.store.addBios(id, r.filePaths);
    },
    biosOpen: async (id) => {
      const dir = ctx.store.biosDir(id);
      if (!dir) return { ok: false };
      await fsp.mkdir(dir, { recursive: true });
      const err = await ctx.electron.shell.openPath(dir);
      return err ? { ok: false, error: err } : { ok: true };
    },
  } satisfies Partial<IpcImplementations>;
}
