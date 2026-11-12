/** Boîtes de dialogue système ouvertes au-dessus de la fenêtre principale : dossier, fichier, médias, image. */
import { EXT } from '@mire/shared';
import type { LibraryItem } from '../library/types.ts';
import type { ElectronApis } from '../ipc/context.ts';
import type { ImageField } from '../meta/user-meta.ts';
import { t } from '../i18n/current.ts';

type Filter = { name: string; extensions: string[] };

/** Types de fichiers proposés selon ce qu'on cherche (programme, jeu, image) et le système. */
export function fileFilters(kind: unknown, platform: NodeJS.Platform): Filter[] {
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  const filters: Record<string, Filter[]> = {
    program: win
      ? [{ name: t('dialogs.filters.programs'), extensions: ['exe'] }]
      : mac
        ? [{ name: t('dialogs.filters.applications'), extensions: ['app'] }]
        : [],
    game: win
      ? [{ name: t('dialogs.filters.gamesAndShortcuts'), extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }]
      : mac
        ? [{ name: t('dialogs.filters.applications'), extensions: ['app'] }]
        : [],
    image: [{ name: t('dialogs.filters.images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  };
  return [...(filters[String(kind)] || []), { name: t('dialogs.filters.allFiles'), extensions: ['*'] }];
}

/** Extensions des vidéos, musiques et images que Mire sait lire (sans le point). */
export const mediaExtensions = (): string[] =>
  Object.values(EXT)
    .flat()
    .map((e) => e.slice(1));

export interface DialogsDeps {
  dialog: Pick<ElectronApis['dialog'], 'showOpenDialog'>;
  /** Fenêtre principale (null avant sa création ou après sa fermeture). */
  window: () => unknown;
  platform?: NodeJS.Platform;
  itemFromPath: (p: string) => Promise<LibraryItem | null>;
}

export function createDialogs({ dialog, window, platform = process.platform, itemFromPath }: DialogsDeps) {
  return {
    async pickFolder(): Promise<string | null> {
      const r = await dialog.showOpenDialog(window(), { title: t('dialogs.chooseFolder'), properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    async pickFile(kind: unknown): Promise<string | null> {
      const r = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters: fileFilters(kind, platform) });
      return r.canceled ? null : r.filePaths[0];
    },
    async openMedia(): Promise<LibraryItem[]> {
      const r = await dialog.showOpenDialog(window(), {
        title: t('dialogs.openFiles'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: t('dialogs.filters.media'), extensions: mediaExtensions() },
          { name: t('dialogs.filters.allFiles'), extensions: ['*'] },
        ],
      });
      if (r.canceled) return [];
      return (await Promise.all(r.filePaths.map(itemFromPath))).filter((x): x is LibraryItem => !!x);
    },
    /** Image ou fond d'écran d'un élément (infos modifiées à la main) : chemin choisi, ou `null`. */
    async chooseMetaImage(field: ImageField): Promise<string | null> {
      const r = await dialog.showOpenDialog(window(), {
        title: field === 'image' ? t('dialogs.chooseImage') : t('dialogs.chooseBackground'),
        properties: ['openFile'],
        filters: [{ name: t('dialogs.filters.images'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return r.filePaths[0];
    },
  };
}

export type Dialogs = ReturnType<typeof createDialogs>;
