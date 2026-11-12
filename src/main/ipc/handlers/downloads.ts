/** Gestionnaire de téléchargements. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';
import { t } from '../../i18n/current.ts';

export function downloadsHandlers(ctx: MainContext) {
  return {
    downloadsList: () => ({ items: ctx.downloads.list(), settings: ctx.downloads.settings() }),
    downloadsAddUrl: (url, dlCtx) => {
      const u = String(url || '').trim();
      if (/^magnet:\?/i.test(u)) return ctx.downloads.addTorrent(u, dlCtx || {});
      return ctx.downloads.addUrl(u, dlCtx || {});
    },
    downloadsAddTorrentFile: async (dlCtx) => {
      const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
        title: t('dialogs.chooseTorrent'),
        properties: ['openFile'],
        filters: [{ name: 'Torrents', extensions: ['torrent'] }],
      });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      return ctx.downloads.addTorrent(r.filePaths[0], dlCtx || {});
    },
    downloadsPause: (id) => ctx.downloads.pause(id),
    downloadsResume: (id) => ctx.downloads.resume(id),
    downloadsCancel: (id, removeFiles) => ctx.downloads.cancel(id, removeFiles !== false),
    downloadsRemove: (id) => ctx.downloads.remove(id),
    downloadsClear: () => ctx.downloads.clearFinished(),
    downloadsReveal: (id) => ctx.downloads.reveal(id),
    downloadsRunInstaller: (id, file) => ctx.downloads.runInstaller(id, file),
    downloadsPickDir: async () => {
      const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
        title: t('dialogs.downloadFolder'),
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
  } satisfies Partial<IpcImplementations>;
}
