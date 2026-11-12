/**
 * Ce que les handlers IPC reçoivent du processus principal, assemblé par `mainContext` (main-context.ts) à partir
 * des services de la racine de composition. La fenêtre, les fichiers en attente et les infos manuelles sont lus
 * par des accesseurs, pour que les handlers voient toujours la valeur courante. La configuration passe par son
 * service (`ctx.config.get()`, `update`, `replace`).
 */
import type { ConfigService } from '../config/service.ts';
import type { Games } from '../games/index.ts';
import type { LanguageService } from '../i18n/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import type { UsageService } from '../usage/index.ts';
import type { WebManager } from '../web/index.ts';

// Fonction d'un service, passée telle quelle (types encore larges).
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
  /** Langue de l'interface et traduction des textes. */
  readonly i18n: LanguageService;

  // Lus (et écrits) au moment de l'appel.
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
