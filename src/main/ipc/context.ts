/**
 * Ce que les handlers IPC reçoivent du processus principal. Tant que src/main/index.js n'est pas découpé, l'état
 * (fenêtre, services) y vit encore : le contexte y donne accès par des accesseurs, pour que les handlers lisent
 * toujours la valeur courante. La configuration passe par son service (`ctx.config.get()`, `update`, `replace`).
 * Les autres types restent larges : ils se préciseront avec les modules qui posséderont ces données.
 */
import type { ConfigService } from '../config/service.ts';
import type { Games } from '../games/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';

// Fonction du processus principal encore définie dans index.js.
type Fn = (...args: any[]) => any;

/** Sous-ensemble d'Electron utilisé par les handlers (injecté : les tests n'ont pas besoin d'Electron). */
export interface ElectronApis {
  app: { quit(): void };
  dialog: {
    showOpenDialog(window: any, options: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog(window: any, options: Record<string, unknown>): Promise<{ canceled: boolean; filePath?: string }>;
  };
  shell: { showItemInFolder(path: string): void; openPath(path: string): Promise<string> };
}

export interface MainContext {
  electron: ElectronApis;

  readonly config: ConfigService;
  /** Politique d'accès aux fichiers locaux. */
  readonly access: AccessPolicy;

  // État de index.js (lu et écrit au moment de l'appel).
  readonly mainWindow: any;
  pendingFiles: string[];
  readonly userMeta: Record<string, any>;
  readonly webViews: Map<string, any>;
  readonly web: { activeId: string | null; [key: string]: unknown };

  // Services créés au démarrage.
  readonly scraper: any;
  readonly store: any;
  readonly downloads: any;
  readonly adblock: any;

  // Configuration.
  configPath: () => string;
  themeBackground: () => string;

  // Bibliothèque, fichiers et métadonnées.
  scanLibrary: Fn;
  findSubtitles: Fn;
  openMediaDialog: Fn;
  itemFromPath: Fn;
  locationError: Fn;
  pickFolder: Fn;
  pickFile: Fn;
  metaDir: () => string;
  saveMeta: Fn;
  setMeta: Fn;
  pickMetaImage: Fn;

  // Lecteur externe et télévision.
  playExternal: Fn;
  detectTvService: Fn;
  fetchChannels: Fn;

  // Vues web.
  webOpen: Fn;
  webShow: Fn;
  webHide: Fn;
  webBounds: Fn;
  webNav: Fn;
  webClose: Fn;
  webFocus: Fn;
  webKey: Fn;
  webLearnSearch: Fn;
  webSessions: Fn;
  drmStatus: Fn;
  searchStreaming: Fn;

  // Jeux (src/main/games) ; les sites de jeux restent avec les vues web.
  readonly games: Games;
  consoleSites: Fn;
}
