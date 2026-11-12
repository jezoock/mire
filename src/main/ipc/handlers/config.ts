/** Configuration : lecture, enregistrement, export et import. */
import fsp from 'node:fs/promises';
import { mergeConfig, migrate } from '../../config/index.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';
import { t } from '../../i18n/current.ts';

// Export : la configuration, et les données d'usage sous la clé `usage`, là où l'utilisateur veut.
export async function exportConfig(ctx: MainContext) {
  const config = { ...ctx.config.get(), usage: ctx.usage.get() };
  const { mainWindow } = ctx;
  const r = await ctx.electron.dialog.showSaveDialog(mainWindow, {
    title: t('dialogs.exportConfig'),
    defaultPath: `mire-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: t('dialogs.filters.mireConfig'), extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false as const, canceled: true };
  await fsp.writeFile(r.filePath, JSON.stringify(config, null, 2), 'utf8');
  return { ok: true as const, path: r.filePath };
}

// Sépare les données d'usage du reste du fichier importé (la configuration).
function splitUsage(data: unknown): { usage: unknown; config: unknown } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { usage: undefined, config: data };
  const { usage, ...config } = data as Record<string, unknown>;
  return { usage, config };
}

// Import : remplace entièrement, ou complète (fusionne sites, consoles, jeux, sources sans doublon).
// Les données d'usage suivent le même choix ; un fichier qui n'en a pas (export d'avant P1-09) les laisse telles quelles.
export async function importConfig(ctx: MainContext, mode?: string) {
  const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
    title: t('dialogs.importConfig'),
    properties: ['openFile'],
    filters: [{ name: t('dialogs.filters.mireConfig'), extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false as const, canceled: true };
  let data;
  try {
    data = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
  } catch {
    return { ok: false as const, error: t('config.errors.invalidFile') };
  }
  const { usage, config: raw } = splitUsage(data);
  const { config: migrated } = migrate(raw);
  const config = ctx.config.replace(mode === 'merge' ? mergeConfig(ctx.config.get(), migrated) : migrated);
  if (usage !== undefined) {
    if (mode === 'merge') ctx.usage.merge(usage);
    else ctx.usage.replace(usage);
  }
  return { ok: true as const, config, usage: ctx.usage.snapshot() };
}

export function configHandlers(ctx: MainContext) {
  return {
    getConfig: () => ({ config: ctx.config.get(), configPath: ctx.configPath(), platform: process.platform }),
    saveConfig: (next) => {
      if (!next || typeof next !== 'object') throw new Error(t('config.errors.invalid'));
      const wasFullscreen = ctx.config.get().ui.fullscreen;
      const saved = ctx.config.replace(next);
      const { mainWindow } = ctx;
      if (mainWindow && saved.ui.fullscreen !== wasFullscreen) mainWindow.setFullScreen(!!saved.ui.fullscreen);
      // Les sites ouverts reprennent leur entrée à jour par l'abonnement à la configuration (src/main/index.ts).
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
