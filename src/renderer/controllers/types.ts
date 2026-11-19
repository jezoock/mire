/**
 * Contexte des contrôleurs : état, client API, messages et traduction, plus les opérations de l'interface historique
 * (`app.js`) qu'ils appellent tant que les vues ne sont pas remplacées. Tout est injecté : les contrôleurs ne
 * touchent ni au DOM ni à `window`, et se testent sans Electron.
 */
import type { MireApi } from '../api/index.ts';
import type { State } from '../state/index.ts';
import type { InfoScalar, PagePath } from '@mire/shared';
import type { CandidateSpec, FormResult } from '@mire/ui/utils';
import type { FormOptions } from '../ui/dialogs.ts';
import type { Search } from '../search/index.ts';
import type { Explorer } from '../explorer/index.ts';
import type { Settings } from '../settings/index.ts';

/** Lecteur vidéo (`src/renderer/players/video.ts`, P4-14) : ce que ses commandes font. */
export interface VideoUi {
  close(): void;
  togglePlay(): void;
  /** Vidéo suivante (1) ou précédente (-1) de la liste. */
  step(d: number): void;
  cycleSubtitles(): void;
  /** Ferme le lecteur et reprend la vidéo dans le lecteur externe. */
  openExternally(): void;
}

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
  /** Vue de page (P4-11) : ouvre un regroupement du niveau affiché, une étape du chemin ; tranche suivante. */
  openPageGroup(value: InfoScalar | null): boolean;
  openPagePath(path: PagePath): boolean;
  loadMorePage(): Promise<void>;
  /** Section historique de la page affichée (« Ancienne vue »), ou `null`. */
  pageLegacySection(): string | null;
  /** Écran ou page suivant (1) ou précédent (-1) du menu. */
  cycle(step: number): void;
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
  /** Clé de l'élément du catalogue dont la carte a le focus (vue de page, accueil, Recherche), ou `null`. */
  selectedKey?(): string | null;
  /** Regroupement dont la carte a le focus (vue de page, accueil), désigné par sa page et son chemin, ou `null`. */
  selectedGroup?(): { page: string; path: PagePath } | null;
  /** Après une modification faite dans un éditeur (P4-22) : la Recherche se met à jour (les pages le font seules). */
  afterEdit?(): void;
  /** Relit les pages (P4-21) : le menu suit une page créée, modifiée ou supprimée. */
  reloadPages?(): Promise<void>;
  editConsole(consoleId: unknown): void;
  /** Consoles changées par `mire-games` (P4-17) : nouvelle configuration, Centre et vues redessinés. */
  afterConsolesChange?(config: Data): void;
  deletableGame(ref: ItemRef | null): boolean;
  deleteGameRef(ref: ItemRef): void;
  consoleName(consoleId: unknown): string | undefined;
  // Bibliothèque et sources
  openFileDialog(): void;
  scan(): void;
  addSourceFolder(kind: string): Promise<void>;
  askSourceAddress(kind: string): Promise<void>;
  removeSource(kind: string, id: string): Promise<void>;
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
  /** Commandes du lecteur vidéo (P4-14). */
  video: VideoUi;
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
  addGame(): Promise<void>;
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
  /** Barre du site redessinée d'après le dernier état publié (P4-16). */
  refreshWebBar(): void;
  // Recherche (P4-13)
  getQueries(): string[];
  rememberQuery(query: string): void;
  /** Écran de la Recherche (`src/renderer/search/`). */
  search: Pick<Search, 'query' | 'setQuery' | 'refresh' | 'pageOf' | 'watchResult' | 'resetWatch'>;
  // Explorateur (P4-08)
  /** Écran de l'explorateur (`src/renderer/explorer/`). */
  explorer: Pick<Explorer, 'open' | 'show' | 'more' | 'pick' | 'focusedRowKey' | 'picked' | 'clearPicks' | 'fileOf'>;
  /** Écran des Réglages (`src/renderer/settings/`, P4-20). */
  settings: Pick<Settings, 'refresh' | 'draft' | 'clearDraft' | 'focus'>;
  // Téléchargements, boutique, réglages
  loadDownloads(): Promise<void>;
  updateDlBadge(): void;
  loadCatalog(): Promise<void>;
  /** Centre (P4-18) : affiche l'onglet `downloads`, `apps` ou `consoles`. */
  showCentreTab(tab: string): void;
  afterStoreChange(result: unknown, message: string): Promise<void>;
  afterAdblockChange(state: unknown): Promise<void>;
  setCfg(path: string, value: unknown): Promise<void>;
  saveUi(mutate: (ui: Data) => void): Promise<void>;
  applyMenu(): void;
  /** Mode secours (P4-10) : thèmes proposés, bandeau redessiné. */
  rescue: { themes(): { id: string; name: string }[]; refresh(): void };
}

export interface ControllerContext {
  S: State;
  api: MireApi;
  toast(message: string, opts?: ToastOptions): void;
  /** Traduction des nouveaux textes (les vues historiques restent en français jusqu'à leur remplacement). */
  t(key: string, vars?: Record<string, string | number>): string;
  /** Texte au pluriel d'après un nombre (formes `one`, `other`… des catalogues) ; à défaut, la forme `other`. */
  plural?(key: string, count: number): string;
  ui: LegacyUi;
  /** Nombre d'éléments ajoutés à chaque « Afficher plus ». */
  page: number;
  /** Service des boîtes de dialogue sur les composants (P4-06) : action des boutons des boîtes. */
  dialogs: {
    act(args: Record<string, unknown>): Promise<void>;
    /** Formulaire sur `ds-modal` (`openForm` de `ui/dialogs.ts`). */
    form(opts: FormOptions): Promise<FormResult>;
    /** Choisir la bonne fiche (`pickCandidate` de `ui/dialogs.ts`) : la fiche choisie, ou `null`. */
    pick?<T extends CandidateSpec>(items: readonly T[], opts: { title: string; help?: string }): Promise<T | null>;
  };
}
