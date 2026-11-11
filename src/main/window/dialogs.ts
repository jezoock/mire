/** Boîtes de dialogue système ouvertes au-dessus de la fenêtre principale : dossier, fichier, médias, image. */
import { EXT } from '@mire/shared';
import type { LibraryItem } from '../library/types.ts';
import type { ElectronApis } from '../ipc/context.ts';
import type { ImageField } from '../meta/user-meta.ts';

type Filter = { name: string; extensions: string[] };

/** Types de fichiers proposés selon ce qu'on cherche (programme, jeu, image) et le système. */
export function fileFilters(kind: unknown, platform: NodeJS.Platform): Filter[] {
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  const filters: Record<string, Filter[]> = {
    program: win ? [{ name: 'Programmes', extensions: ['exe'] }] : mac ? [{ name: 'Applications', extensions: ['app'] }] : [],
    game: win ? [{ name: 'Jeux et raccourcis', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }] : mac ? [{ name: 'Applications', extensions: ['app'] }] : [],
    image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  };
  return [...(filters[String(kind)] || []), { name: 'Tous les fichiers', extensions: ['*'] }];
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
      const r = await dialog.showOpenDialog(window(), { title: 'Choisir un dossier', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    async pickFile(kind: unknown): Promise<string | null> {
      const r = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters: fileFilters(kind, platform) });
      return r.canceled ? null : r.filePaths[0];
    },
    async openMedia(): Promise<LibraryItem[]> {
      const r = await dialog.showOpenDialog(window(), {
        title: 'Ouvrir des fichiers',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Vidéos, musiques et images', extensions: mediaExtensions() },
          { name: 'Tous les fichiers', extensions: ['*'] },
        ],
      });
      if (r.canceled) return [];
      return (await Promise.all(r.filePaths.map(itemFromPath))).filter((x): x is LibraryItem => !!x);
    },
    /** Image ou fond d'écran d'un élément (infos modifiées à la main) : chemin choisi, ou `null`. */
    async chooseMetaImage(field: ImageField): Promise<string | null> {
      const r = await dialog.showOpenDialog(window(), {
        title: field === 'image' ? 'Choisir l’image' : 'Choisir le fond d’écran',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      return r.filePaths[0];
    },
  };
}

export type Dialogs = ReturnType<typeof createDialogs>;
