/**
 * Types des vues web intégrées : entrées (ce qu'on ouvre), vues, dépendances du gestionnaire. Les objets Electron
 * (WebContentsView, webContents, fenêtre) sont décrits par le sous-ensemble utilisé : les tests passent de fausses
 * vues.
 */
import type { Config, LinkSite } from '@mire/shared';
import type { ConfigService } from '../config/service.ts';
import type { DownloadContext } from '../downloads/types.ts';

/** Ce qu'affiche une vue web : site enregistré, sites de jeux d'une console, marque-page, portail TV… */
export interface WebEntry {
  id: string;
  name?: string;
  url: string;
  mode?: 'integrated' | 'browser';
  search?: string;
  color?: string;
  /** La musique d'un site « de fond » continue quand on le quitte. */
  background?: boolean;
  /** Sites de jeux : console (identifiant ou « pc ») et site choisi. */
  romConsole?: string;
  romSite?: number;
  [key: string]: unknown;
}

/** Résultat de la résolution d'un identifiant de vue : l'entrée, ou un message pour l'utilisateur. */
export type EntryResult = { entry: WebEntry; error?: undefined } | { entry?: undefined; error: string };

export interface ResolveOptions {
  /** Sites d'une console (« Ajouter des jeux »). */
  romSites?: (consoleId: string) => LinkSite[];
  /** Site choisi parmi ceux de la console. */
  site?: number;
}

/**
 * Résolveur d'entrées pour un préfixe d'identifiant (`rom:`, `bm:`, `tv:`). Un addon pourra en enregistrer un
 * pour ses propres pages.
 */
export interface EntryResolver {
  prefix: string;
  resolve(id: string, config: Config, opts: ResolveOptions): EntryResult;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Entrée clavier reçue par une vue (événement `before-input-event` d'Electron). */
export interface KeyInput {
  type?: string;
  key: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** Sous-ensemble de `webContents` utilisé par le gestionnaire. */
export interface WebContentsLike {
  id: number;
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void };
  mainFrame?: { framesInSubtree: { executeJavaScript(code: string): Promise<unknown> }[] };
  getTitle(): string;
  getURL(): string;
  isLoading(): boolean;
  isDestroyed(): boolean;
  loadURL(url: string): unknown;
  downloadURL(url: string): void;
  reload(): void;
  stop(): void;
  focus(): void;
  close(): void;
  sendInputEvent(event: Record<string, unknown>): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** Sous-ensemble de `WebContentsView`. */
export interface ViewLike {
  webContents: WebContentsLike;
  setBackgroundColor(color: string): void;
  setVisible(visible: boolean): void;
  setBounds(bounds: Rect): void;
}

/** Sous-ensemble de la fenêtre principale. */
export interface WindowLike {
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setFullScreen(on: boolean): void;
  getContentSize(): number[];
  contentView: { addChildView(view: ViewLike): void; removeChildView(view: ViewLike): void };
  webContents: { focus(): void };
}

/** Ce que le gestionnaire utilise du gestionnaire de téléchargements. */
export interface WebDownloads {
  handleWebDownload(item: unknown, ctx?: DownloadContext): unknown;
  addTorrent(url: string, ctx?: DownloadContext): Promise<{ ok: boolean; external?: boolean; error?: string } | null | undefined>;
}

/** Ce que le gestionnaire utilise des extensions des vues web (src/main/web/extensions.ts). */
export interface WebManagerExtensions {
  /** Éléments bloqués dans une page (bouclier de la barre du site). */
  blockedCount(webContentsId: number): number;
  /** Nouvelle page dans la vue : compteurs remis à zéro. */
  resetPage(webContentsId: number): unknown;
  /** Navigation à annuler (redirection publicitaire). */
  guardNavigation(url: string, from: string): boolean;
  /** Une extension agit-elle sur cette page (bouclier actif) ? */
  activeOn(url: string): boolean;
}

export interface WebManagerDeps {
  /** Fenêtre principale (créée après le gestionnaire, d'où l'accesseur). */
  window: () => WindowLike | null;
  /** Crée une vue ; les préférences (isolation, bac à sable) sont fixées par le gestionnaire. */
  createView: (webPreferences: Readonly<Record<string, unknown>>) => ViewLike;
  config: Pick<ConfigService, 'get' | 'update'>;
  /** Sites proposés pour un système quand la console n'a pas sa propre liste. */
  defaultRomSites: (system: string) => LinkSite[];
  /** Système d'une console (pour ses sites par défaut). */
  guessSystem: (console: unknown) => string;
  downloads: () => WebDownloads | null;
  extensions: () => WebManagerExtensions | null;
  /** Ce qu'il faut attendre avant d'ouvrir le premier site (Widevine, bloqueur). */
  whenReady: () => Promise<unknown>;
  openInBrowser: (url: string) => Promise<{ ok: boolean; error?: string }>;
  toUi: (channel: string, payload?: unknown) => void;
  /** Résolveurs supplémentaires (après ceux de Mire). */
  resolvers?: EntryResolver[];
}
