/**
 * Ce que les handlers IPC reçoivent du processus principal, assemblé par `mainContext` (main-context.ts) à partir
 * des services de la racine de composition. La fenêtre, les fichiers en attente et les infos manuelles sont lus
 * par des accesseurs, pour que les handlers voient toujours la valeur courante. La configuration passe par son
 * service (`ctx.config.get()`, `update`, `replace`).
 */
import type { Catalog } from '../catalog/index.ts';
import type { TagEngine } from '../catalog/tags/engine.ts';
import type { Pages } from '../catalog/pages/index.ts';
import type { Lists } from '../catalog/lists/index.ts';
import type { Folders } from '../catalog/folders.ts';
import type { Search } from '../catalog/search/index.ts';
import type { FilesService } from '../files/service.ts';
import type { ConfigService } from '../config/service.ts';
import type { Games } from '../games/index.ts';
import type { RescueRequest } from '@mire/shared';
import type { LanguageService } from '../i18n/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import type { UsageService } from '../usage/index.ts';
import type { WebManager } from '../web/index.ts';
import type { PluginService } from '../plugins/service.ts';
import type { RepoClient } from '../repos/client.ts';
import type { Continuity } from '../plugins/continuity.ts';

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
  /** Catalogue d'éléments (userData/catalog/). */
  readonly catalog: Catalog;
  /** Tags et infos effectifs des éléments, index, modifications à la main. */
  readonly tags: TagEngine;
  /** Pages et regroupements (pages.json, calcul à la demande). */
  readonly pages: Pages;
  /** Listes faites à la main (lists.json). */
  readonly lists: Lists;
  /** Parcours par source et par dossier (explorateur). */
  readonly folders: Folders;
  /** Recherche dans le catalogue (textes préparés à la première recherche). */
  readonly search: Search;
  /** Renommer, déplacer, supprimer sous les dossiers locaux de la configuration (P2-10). */
  readonly fileManager: FilesService;
  /** Hôte de plugins (P3-03). */
  readonly plugins: Pick<PluginService, 'list' | 'setEnabled' | 'settingsList' | 'setSetting' | 'metadataProviders' | 'uninstall'>;
  /** Client des dépôts (P3-07) : index vérifiés, installation, mise à jour. */
  readonly repos: Pick<RepoClient, 'repositories' | 'refresh' | 'available' | 'knows' | 'install' | 'update'>;
  /** Continuité pour les installations existantes (P5-01) : récapitulatif, reprise après la mise à jour des index. */
  readonly continuity: Pick<Continuity, 'summary' | 'seen' | 'afterRefresh'>;

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
  resetMeta: Fn;
  setMeta: Fn;
  pickMetaImage: Fn;

  // Lecteur externe et télévision.
  playExternal: Fn;
  detectTvService: Fn;
  fetchChannels: Fn;
  /** Flux d'une chaîne du service choisi, par sa clé (variante de la qualité préférée). */
  channelStream: Fn;

  // Vues web (src/main/web) : leur état est interne au gestionnaire.
  readonly web: WebManager;
  drmStatus: Fn;
  searchStreaming: Fn;

  // Jeux (src/main/games) ; les sites de jeux d'une console sont donnés par le gestionnaire des vues web.
  readonly games: Games;
  /** Mode secours (P4-10) : premier écran demandé, thème affiché sans souci. */
  readonly rescue: { takeStart(): RescueRequest | null; themeOk(): void };
}
