/** Configuration : lecture, enregistrement, export et import. */
import fsp from 'node:fs/promises';
import { mergeConfig, migrate } from '../../config/index.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

// Export : copie du fichier de configuration là où l'utilisateur veut.
export async function exportConfig(ctx: MainContext) {
  const config = ctx.config.get();
  const { mainWindow } = ctx;
  const r = await ctx.electron.dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la configuration',
    defaultPath: `mire-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Configuration Mire', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false as const, canceled: true };
  await fsp.writeFile(r.filePath, JSON.stringify(config, null, 2), 'utf8');
  return { ok: true as const, path: r.filePath };
}

// Import : remplace entièrement, ou complète (fusionne sites, consoles, jeux, sources sans doublon).
export async function importConfig(ctx: MainContext, mode?: string) {
  const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
    title: 'Importer une configuration',
    properties: ['openFile'],
    filters: [{ name: 'Configuration Mire', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false as const, canceled: true };
  let data;
  try {
    data = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
  } catch {
    return { ok: false as const, error: 'Ce fichier n’est pas une configuration Mire valide (JSON illisible).' };
  }
  const { config: migrated } = migrate(data);
  const config = ctx.config.replace(mode === 'merge' ? mergeConfig(ctx.config.get(), migrated) : migrated);
  return { ok: true as const, config };
}

export function configHandlers(ctx: MainContext) {
  return {
    getConfig: () => ({ config: ctx.config.get(), configPath: ctx.configPath(), platform: process.platform }),
    saveConfig: (next) => {
      if (!next || typeof next !== 'object') throw new Error('Configuration invalide.');
      const wasFullscreen = ctx.config.get().ui.fullscreen;
      const saved = ctx.config.replace(next);
      const { mainWindow } = ctx;
      if (mainWindow && saved.ui.fullscreen !== wasFullscreen) mainWindow.setFullScreen(!!saved.ui.fullscreen);
      ctx.web.refreshEntries(saved);
      if (mainWindow) mainWindow.setBackgroundColor(ctx.themeBackground());
      return saved;
    },
    revealConfig: () => {
      ctx.electron.shell.showItemInFolder(ctx.configPath());
      return true;
    },
    configExport: () => exportConfig(ctx),
    configImport: (mode) => importConfig(ctx, mode),
  } satisfies Partial<IpcImplementations>;
}
