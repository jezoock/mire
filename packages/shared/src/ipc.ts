/**
 * Contrat IPC entre l'interface (renderer) et le processus principal, décrit une seule fois :
 * - `IPC_METHODS` : méthode de `window.api` → canal `ipcRenderer.invoke` / `ipcMain.handle` ;
 * - `IPC_EVENTS` : abonnement `window.api.onX` → canal des messages envoyés par le processus principal ;
 * - `IpcMethods` et `IpcEvents` : arguments et résultats de chaque méthode, contenu de chaque événement.
 * Le preload construit `window.api` à partir de ces tables (`createApi`) ; le processus principal y enregistre
 * ses implémentations. Les noms sont ceux de l'interface d'origine : ne pas les renommer sans migrer le renderer.
 *
 * Les canaux synchrones du preload des sites (`mire:scriptlets`, `mire:signin-ua`) ne passent pas par ce contrat.
 */

/* ------------------------------------------------------------------ */
/* Données échangées                                                   */
/* ------------------------------------------------------------------ */

// Structures décrites par le processus principal ; leurs types détaillés viendront avec les modules qui les
// possèdent (configuration : P1-06, bibliothèque : P1-14…). En attendant, elles restent opaques.
/** Configuration complète (config.json), voir src/main/lib/config.js. */
export type MireConfig = Record<string, unknown>;
/** Fichier de la bibliothèque (vidéo, musique, image…). */
export type MediaItem = Record<string, unknown>;
/** État d'une vue web publié vers l'interface. */
export type WebState = Record<string, unknown>;
/** Téléchargement suivi par le gestionnaire. */
export type DownloadItem = Record<string, unknown>;
/** Fiche de métadonnées saisie par l'utilisateur (meta.json). */
export type UserMeta = Record<string, unknown>;

/** Échec : message à afficher, ou boîte de dialogue annulée. Toute méthode peut le renvoyer (erreur inattendue). */
export interface Failure {
  ok: false;
  error?: string;
  canceled?: boolean;
}
/** Réussite (avec des données) ou échec. */
export type Outcome<T extends object = object> = ({ ok: true } & T) | Failure;

/** Jeu à supprimer (bouton « Supprimer » d'une fiche de jeu). */
export interface GameRef {
  kind: 'game' | 'rom';
  /** Jeu PC ajouté à la main : position dans `config.games`. */
  manualIndex?: number | null;
  /** Jeu de console : fichier à supprimer et console qui le possède. */
  path?: string;
  emuIndex?: number;
}

/** Console visée : position dans `config.emulators`, ou « pc ». */
export type ConsoleRef = number | 'pc';

/** Contexte d'un téléchargement : console de destination, nom affiché… */
export interface DownloadContext {
  console?: number;
  name?: string;
  [key: string]: unknown;
}

export interface BookmarkInput {
  url: string;
  title: string;
  type?: 'movie' | 'tv';
  season?: number | string | null;
  episode?: number | string | null;
  year?: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  type: 'movie' | 'tv';
  season: number | null;
  episode: number | null;
  site: string;
  added: number;
}

export interface GameBookmarkInput {
  source: string;
  title?: string;
  console?: ConsoleRef | string | null;
}

export interface GameBookmark {
  id: string;
  source: string;
  kind: 'torrent' | 'http';
  title: string;
  console: ConsoleRef | null;
  system: string;
  downloadId: string | null;
  done: boolean;
  added: number;
}

export interface CleanupReport {
  missingLocal: string[];
  missingRemote: string[];
  removedManual: number;
  checked: number;
  config?: MireConfig;
}

export interface WebSession {
  id: string;
  name: string;
  color?: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Méthodes                                                            */
/* ------------------------------------------------------------------ */

/** Signature de chaque méthode de `window.api`, côté processus principal (le renderer reçoit une promesse). */
export interface IpcMethods {
  // Configuration
  getConfig(): { config: MireConfig; configPath: string; platform: string };
  saveConfig(next: MireConfig): MireConfig;
  revealConfig(): boolean;
  configExport(): Outcome<{ path: string }>;
  configImport(mode?: 'replace' | 'merge'): Outcome<{ config: MireConfig }>;

  // Bibliothèque et fichiers
  scanLibrary(): { items: MediaItem[]; status: unknown[] };
  subtitles(videoPath: string): unknown[];
  openMediaDialog(): MediaItem[];
  fromPaths(paths: string[]): MediaItem[];
  takePendingFiles(): MediaItem[];
  checkLocation(location: string): { ok: boolean; error?: string | null };
  pickFolder(): string | null;
  pickFile(kind?: string): string | null;

  // Lecteur externe et télévision
  playExternal(target: string, title?: string, start?: number): Outcome;
  tvChannels(): Outcome<Record<string, unknown>>;
  tvDetect(): { id: string; name: string };
  tvSetActive(id: string): MireConfig;

  // Vues web
  webOpen(id: string, url?: string | null, opts?: { site?: number }): Outcome<{ integrated: boolean; state?: WebState | null }>;
  webShow(id: string, bounds?: Bounds, focus?: boolean): Outcome<{ state: WebState | null }>;
  webHide(): unknown;
  webBounds(bounds: Bounds): boolean;
  webNav(action: string): boolean;
  webClose(id: string): boolean;
  webFocus(): boolean;
  webKey(name: string): boolean;
  webLearnSearch(id: string): Outcome<{ template: string; config: MireConfig }>;
  webSessions(): WebSession[];

  // Sites de jeux et marque-pages
  romSites(console: ConsoleRef): { sites: unknown[]; custom: boolean; defaults: unknown[] };
  romDownload(console: number, url: string): Outcome<{ count: number; total?: number }>;
  bookmarkAdd(data: BookmarkInput): Outcome<{ bookmark: Bookmark; scraped: boolean; config: MireConfig }>;
  bookmarkRemove(id: string): Outcome<{ config: MireConfig }>;
  bookmarkOpen(id: string): unknown;
  gameBookmarkAdd(data: GameBookmarkInput): Outcome<{ bookmark: GameBookmark; needSystem: boolean; config: MireConfig }>;
  gameBookmarkSetConsole(id: string, console: ConsoleRef | string): Outcome<{ config: MireConfig }>;
  gameBookmarkRemove(id: string): Outcome<{ config: MireConfig }>;
  gameBookmarkDownload(id: string): Outcome;
  romListSource(console: number, only?: string): Outcome<Record<string, unknown>>;
  gameDelete(ref: GameRef): Outcome<{ config?: MireConfig }>;
  gamesCleanup(online?: boolean): Outcome<CleanupReport>;

  // Téléchargements
  downloadsList(): { items: DownloadItem[]; settings: Record<string, unknown> };
  downloadsAddUrl(url: string, ctx?: DownloadContext): unknown;
  downloadsAddTorrentFile(ctx?: DownloadContext): unknown;
  downloadsPause(id: string): unknown;
  downloadsResume(id: string): unknown;
  downloadsCancel(id: string, removeFiles?: boolean): unknown;
  downloadsRemove(id: string): unknown;
  downloadsClear(): unknown;
  downloadsReveal(id: string): unknown;
  downloadsRunInstaller(id: string, file?: string): unknown;
  downloadsPickDir(): string | null;

  // Boutique : BIOS
  biosAdd(id: string): unknown;
  biosOpen(id: string): Outcome;

  // DRM et bloqueur de publicités
  drmStatus(): { ecs: boolean; platform: string; widevine?: { status: unknown; version: unknown } | null };
  adblockStatus(): Record<string, unknown> | null;
  adblockSetEnabled(on: boolean): unknown;
  adblockToggleSite(): Record<string, unknown> | null;
  adblockSetLists(lists: Record<string, unknown>): unknown;
  adblockUpdate(): Record<string, unknown>;

  // Recherche dans les services de streaming
  searchStreaming(query: string): { ok: boolean; results?: unknown[]; reason?: string; error?: string };

  // Jeux
  scanGameSources(): { games: unknown[]; status: unknown[] };
  launchGamePath(target: string): Outcome;

  // Métadonnées saisies à la main
  metaAll(): Record<string, UserMeta>;
  metaSet(key: string, patch: UserMeta): UserMeta | null;
  metaPickImage(key: string, field: 'image' | 'backdrop'): UserMeta | null;
  metaReset(key: string): boolean;

  // Récupération d'infos (scraping)
  scrapeData(): Record<string, unknown>;
  scrapeRun(opts?: Record<string, unknown>): unknown;
  scrapeOne(job?: Record<string, unknown>): unknown;
  scrapeCandidates(job?: Record<string, unknown>): unknown;
  pickImageFile(title?: string): string | null;
  scrapeCancel(): unknown;
  scrapeForget(key: string): unknown;
  scrapeClear(): unknown;

  // Boutique
  storeCatalog(): unknown;
  storeInstall(id: string, systems?: unknown): unknown;
  storeUninstall(id: string): unknown;
  storeGame(id: string): unknown;
  storeImport(console: number): Outcome<{ count?: number }>;
  storePickRoot(): MireConfig | null;

  // Lancement des jeux
  launchGame(index: number): Outcome;
  addGame(): MireConfig | null;
  listRoms(console: number, opts?: { online?: boolean; only?: string }): Outcome<Record<string, unknown>>;
  launchRom(console: number, romPath: string): Outcome;

  // Fenêtre et application
  toggleFullscreen(): boolean;
  quit(): boolean;
}

export type IpcMethodName = keyof IpcMethods;
export type IpcArgs<K extends IpcMethodName> = Parameters<IpcMethods[K]>;
export type IpcResult<K extends IpcMethodName> = ReturnType<IpcMethods[K]>;

/** Méthode de `window.api` → canal IPC. L'ordre est celui de l'ancien preload. */
export const IPC_METHODS = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  revealConfig: 'config:reveal',

  scanLibrary: 'library:scan',
  subtitles: 'media:subtitles',
  openMediaDialog: 'media:openDialog',
  fromPaths: 'media:fromPaths',
  takePendingFiles: 'app:pendingFiles',

  pickFolder: 'dialog:folder',
  pickFile: 'dialog:file',

  playExternal: 'player:external',
  tvChannels: 'tv:channels',

  webOpen: 'web:open',
  webShow: 'web:show',
  webHide: 'web:hide',
  webBounds: 'web:bounds',
  webNav: 'web:nav',
  webClose: 'web:close',
  webFocus: 'web:focus',
  webKey: 'web:key',
  webLearnSearch: 'web:learnSearch',
  webSessions: 'web:sessions',
  romSites: 'roms:sites',
  romDownload: 'roms:download',
  bookmarkAdd: 'bookmarks:add',
  bookmarkRemove: 'bookmarks:remove',
  bookmarkOpen: 'bookmarks:open',
  gameBookmarkAdd: 'gameBookmarks:add',
  gameBookmarkSetConsole: 'gameBookmarks:setConsole',
  gameBookmarkRemove: 'gameBookmarks:remove',
  gameBookmarkDownload: 'gameBookmarks:download',
  romListSource: 'roms:listSource',
  gameDelete: 'games:delete',
  gamesCleanup: 'games:cleanup',
  downloadsList: 'downloads:list',
  downloadsAddUrl: 'downloads:addUrl',
  downloadsAddTorrentFile: 'downloads:addTorrentFile',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsCancel: 'downloads:cancel',
  downloadsRemove: 'downloads:remove',
  downloadsClear: 'downloads:clear',
  downloadsReveal: 'downloads:reveal',
  downloadsRunInstaller: 'downloads:runInstaller',
  downloadsPickDir: 'downloads:pickDir',
  configExport: 'config:export',
  configImport: 'config:import',
  tvDetect: 'tv:detect',
  tvSetActive: 'tv:setActive',
  biosAdd: 'store:biosAdd',
  biosOpen: 'store:biosOpen',
  drmStatus: 'drm:status',
  adblockStatus: 'adblock:status',
  adblockSetEnabled: 'adblock:setEnabled',
  adblockToggleSite: 'adblock:toggleSite',
  adblockSetLists: 'adblock:setLists',
  adblockUpdate: 'adblock:update',
  searchStreaming: 'search:streaming',

  scanGameSources: 'games:scanSources',
  launchGamePath: 'games:launchPath',
  metaAll: 'meta:all',
  metaSet: 'meta:set',
  metaPickImage: 'meta:pickImage',
  metaReset: 'meta:reset',
  checkLocation: 'location:check',

  scrapeData: 'scrape:data',
  scrapeRun: 'scrape:run',
  scrapeOne: 'scrape:one',
  scrapeCandidates: 'scrape:candidates',
  pickImageFile: 'image:pick',
  scrapeCancel: 'scrape:cancel',
  scrapeForget: 'scrape:forget',
  scrapeClear: 'scrape:clear',

  storeCatalog: 'store:catalog',
  storeInstall: 'store:install',
  storeUninstall: 'store:uninstall',
  storeGame: 'store:game',
  storeImport: 'store:import',
  storePickRoot: 'store:pickRoot',

  launchGame: 'games:launch',
  addGame: 'games:add',
  listRoms: 'emu:roms',
  launchRom: 'emu:launch',

  toggleFullscreen: 'window:fullscreen',
  quit: 'app:quit',
} as const satisfies Record<IpcMethodName, string>;

export type IpcChannel = (typeof IPC_METHODS)[IpcMethodName];

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

/** Contenu de chaque événement envoyé par le processus principal. */
export interface IpcEvents {
  onTvDetected: { id: string; name: string };
  onDownload: DownloadItem;
  onDownloadFinished: DownloadItem;
  onDownloadAdded: Record<string, unknown>;
  onRomDownload: Record<string, unknown>;
  onWebBlocked: { id: string; count: number };
  onWebAdblocked: { host: string };
  onRomProgress: Record<string, unknown>;
  onScrapeProgress: Record<string, unknown>;
  onStoreProgress: Record<string, unknown>;
  onOpenFiles: MediaItem[];
  onWebState: WebState;
  onWebSessions: WebSession[];
  onWebError: { message: string };
  onWebClosed: { id: string };
  onWebFocus: boolean;
  onMireFocus: undefined;
}

export type IpcEventName = keyof IpcEvents;

/** Abonnement de `window.api` → canal de l'événement. L'ordre est celui de l'ancien preload. */
export const IPC_EVENTS = {
  onTvDetected: 'tv-detected',
  onDownload: 'download',
  onDownloadFinished: 'download-finished',
  onDownloadAdded: 'download-added',
  onRomDownload: 'rom-download',
  onWebBlocked: 'web-blocked',
  onWebAdblocked: 'web-adblocked',
  onRomProgress: 'rom-progress',
  onScrapeProgress: 'scrape-progress',
  onStoreProgress: 'store-progress',
  onOpenFiles: 'open-files',
  onWebState: 'web-state',
  onWebSessions: 'web-sessions',
  onWebError: 'web-error',
  onWebClosed: 'web-closed',
  onWebFocus: 'web-focus',
  onMireFocus: 'web-mire-focus',
} as const satisfies Record<IpcEventName, string>;

/* ------------------------------------------------------------------ */
/* Construction de window.api                                          */
/* ------------------------------------------------------------------ */

/** Ce dont `createApi` a besoin d'`ipcRenderer` (injecté : le paquet ne dépend pas d'Electron). */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

/** `window.api` tel que le voit le renderer. Une erreur inattendue du processus principal arrive en `Failure`. */
export type IpcApi = {
  [K in IpcMethodName]: (...args: IpcArgs<K>) => Promise<IpcResult<K> | Failure>;
} & {
  [K in IpcEventName]: (callback: (payload: IpcEvents[K]) => void) => () => void;
};

/**
 * Construit les méthodes et abonnements de `window.api` à partir des tables, et rien d'autre :
 * aucun appel générique sur un canal arbitraire n'est exposé à l'interface.
 * Chaque `onX(callback)` renvoie une fonction de désabonnement.
 */
export function createApi(ipc: IpcRendererLike): IpcApi {
  const api: Record<string, unknown> = {};
  for (const [name, channel] of Object.entries(IPC_METHODS)) {
    api[name] = (...args: unknown[]) => ipc.invoke(channel, ...args);
  }
  for (const [name, channel] of Object.entries(IPC_EVENTS)) {
    api[name] = (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipc.on(channel, listener);
      return () => {
        ipc.removeListener(channel, listener);
      };
    };
  }
  return api as IpcApi;
}
