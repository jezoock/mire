/**
 * Contexte des contrôleurs : état, client API, messages et traduction, plus les opérations de l'interface historique
 * (`app.js`) qu'ils appellent tant que les vues ne sont pas remplacées. Tout est injecté : les contrôleurs ne
 * touchent ni au DOM ni à `window`, et se testent sans Electron.
 */
import type { MireApi } from '../api/index.ts';
import type { State } from '../state/index.ts';
import type { PagePath } from '@mire/shared';

/** Élément de l'interface historique (vidéo, morceau, jeu…), aux champs encore peu décrits (`state/`). */
export type Data = Record<string, any>;

export interface ToastOptions {
  duration?: number;
  action?: string;
  onAction?: () => void;
}

/** Élément désigné dans une vue (fiche à modifier, jeu à supprimer). */
export interface ItemRef {
  kind: string;
  item?: Data;
  consoleId?: unknown;
  [key: string]: unknown;
}

/** Opérations de l'interface historique (`app.js`) utilisées par les contrôleurs. */
export interface LegacyUi {
  // Écrans et vues
  render(opts?: { resetScroll?: boolean }): void;
  go(section: string, opts?: { focus?: string }): void;
  /** Ouvre une cible (routeur de la coquille, P4-07) ; faux si aucune vue ne l'affiche encore. */
  open(target: string, opts?: { path?: PagePath; focus?: string }): boolean;
  /** Ouvre un site déjà ouvert, choisi dans le menu (`tv:…`, `rom:…`, `bm:…` ou un service). */
  openSite(id: string): void;
  back(): void;
  nextSection(section: string, step: number): string;
  webHome(): string;
  revealSettings(blockId: string): void;
  openPageSettings(tab?: string): void;
  refreshPanel(): void;
  isPanelOpen(): boolean;
  confirm(title: string, help: string, yes: string): Promise<boolean>;
  // Fiches et éléments
  selectedRef(): ItemRef | null;
  firstItemRef(): ItemRef | null;
  editRef(ref: ItemRef | null): void;
  editConsole(consoleId: unknown): void;
  deletableGame(ref: ItemRef | null): boolean;
  deleteGameRef(ref: ItemRef): void;
  consoleName(consoleId: unknown): string | undefined;
  // Bibliothèque et sources
  openFileDialog(): void;
  scan(): void;
  addSourceFolder(kind: string): void;
  askSourceAddress(kind: string): void;
  removeSource(kind: string, id: string): void;
  startScrape(kinds: string[], opts?: { force?: boolean; quiet?: boolean }): void;
  updateScrapeButton(): void;
  reloadScrape(): Promise<void>;
  // Lecture
  playInContext(item: Data): void;
  playRecent(item: Data): void;
  openVideo(list: Data[], index: number): void;
  playQueue(list: Data[], index: number): void;
  openImages(list: Data[], index: number): void;
  pauseAudio(): void;
  toggleAudio(): void;
  openExternal(item: { path: string; name: string }, start?: number): void;
  addRecent(item: Data): void;
  // Télévision
  playChannel(channel: Data | undefined): void;
  loadChannels(): void;
  // Jeux
  launchEntry(game: Data | undefined): void;
  launchRom(rom: Data | undefined, consoleId?: unknown): void;
  downloadGameBookmark(id: string | undefined): void;
  cleanupGames(): void;
  addGame(): void;
  openEmu(consoleId: unknown): void;
  closeRoms(): void;
  openRomBrowser(consoleId: unknown, opts?: { site?: number; url?: string }): void;
  loadLocalRoms(): void;
  // Sites
  openWeb(id: string, url?: string): void;
  openTvWeb(web: Data): void;
  openBookmark(id: string): void;
  bookmarkCurrentPage(): void;
  bookmarkCurrentGame(): void;
  learnSearch(): void;
  syncWeb(): void;
  setAdButton(state: Data): void;
  // Recherche
  getQueries(): string[];
  rememberQuery(query: string): void;
  setSearchQuery(query: string): void;
  openTmdbResult(result: Data): void;
  // Téléchargements, boutique, réglages
  loadDownloads(): Promise<void>;
  updateDlBadge(): void;
  loadCatalog(): Promise<void>;
  afterStoreChange(result: unknown, message: string): Promise<void>;
  afterAdblockChange(state: unknown): Promise<void>;
  setCfg(path: string, value: unknown): Promise<void>;
  saveUi(mutate: (ui: Data) => void): Promise<void>;
  applyMenu(): void;
}

export interface ControllerContext {
  S: State;
  api: MireApi;
  toast(message: string, opts?: ToastOptions): void;
  /** Traduction des nouveaux textes (les vues historiques restent en français jusqu'à leur remplacement). */
  t(key: string, vars?: Record<string, string | number>): string;
  ui: LegacyUi;
  /** Nombre d'éléments ajoutés à chaque « Afficher plus ». */
  page: number;
  /** Service des boîtes de dialogue sur les composants (P4-06) : action des boutons des boîtes. */
  dialogs: { act(args: Record<string, unknown>): Promise<void> };
}
