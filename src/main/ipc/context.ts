/**
 * Ce que les handlers IPC reçoivent du processus principal. Tant que src/main/index.js n'est pas découpé, l'état
 * (fenêtre, services) y vit encore : le contexte y donne accès par des accesseurs, pour que les handlers lisent
 * toujours la valeur courante. La configuration passe par son service (`ctx.config.get()`, `update`, `replace`).
 * Les autres types restent larges : ils se préciseront avec les modules qui posséderont ces données.
 */
import type { ConfigService } from '../config/service.ts';
import type { Games } from '../games/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import type { UsageService } from '../usage/index.ts';
import type { WebManager } from '../web/index.ts';

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
  /** « Reprendre », positions de reprise, volume, recherches récentes (usage.json). */
  readonly usage: UsageService;

  // État de index.js (lu et écrit au moment de l'appel).
  readonly mainWindow: any;
  pendingFiles: string[];
  readonly userMeta: Record<string, any>;

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

  // Vues web (src/main/web) : leur état est interne au gestionnaire.
  readonly web: WebManager;
  drmStatus: Fn;
  searchStreaming: Fn;

  // Jeux (src/main/games) ; les sites de jeux d'une console sont donnés par le gestionnaire des vues web.
  readonly games: Games;
}
