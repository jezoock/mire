/**
 * Types de la configuration de Mire (`config.json`), telle que la rend la normalisation du processus principal
 * (`src/main/config/normalize/`). Partagés : l'interface les reçoit par le contrat IPC.
 *
 * Les éléments de liste (sites, consoles, jeux, services TV) acceptent des champs en plus : la normalisation garde
 * ce qu'elle ne connaît pas (champs ajoutés par l'interface ou par une version plus récente).
 */

/** Types de média d'une source de la bibliothèque. */
export type MediaKind = 'video' | 'audio' | 'image';

/** Barres de la mire proposées sur l'accueil. */
export type HomeBar = 'search' | 'videos' | 'music' | 'images' | 'streaming' | 'tv' | 'games';

export type Theme = 'auto' | 'ecran' | 'jour' | 'minuit' | 'velours' | 'contraste';

export type MenuPosition = 'left' | 'right' | 'top' | 'bottom';

/** Console visée : position dans `config.emulators`, ou « pc ». */
export type ConsoleRef = number | 'pc';

/** Source de la bibliothèque : dossier, partage réseau (\\NAS\Films ou smb://nas/films) ou adresse web. */
export interface LibrarySource {
  id: string;
  kind: MediaKind;
  location: string;
}

/** Dossier contenant des jeux PC (exécutables ou raccourcis). */
export interface GameSource {
  id: string;
  location: string;
}

/** Programme externe (lecteur, navigateur) et ses arguments. */
export interface ExternalProgram {
  path: string;
  args: string[];
}

/**
 * Site de streaming. mode « integrated » : vue web dans Mire ; « browser » : navigateur externe (secours).
 * search : adresse de recherche ({q} = mots cherchés), vide tant qu'elle n'est pas apprise.
 * providers : noms utilisés par TMDB/JustWatch pour ce service (« =nom » : correspondance exacte).
 * background : la lecture continue quand on quitte le site (musique). group : rangement dans Streaming.
 */
export interface WebSite {
  id: string;
  name?: string;
  url: string;
  mode: 'integrated' | 'browser';
  search: string;
  group?: string;
  color?: string;
  providers?: string[];
  background?: boolean;
  [key: string]: unknown;
}

/**
 * Service pour regarder la télévision. kind « playlist » : liste M3U lue dans Mire ; « web » : portail du
 * fournisseur dans la vue intégrée. detect : adresse jointe sur le réseau local pour reconnaître le service en place.
 */
export interface TvService {
  id: string;
  name?: string;
  kind: 'playlist' | 'web';
  url: string;
  detect?: string;
  quality?: string;
  [key: string]: unknown;
}

export interface TvSettings {
  services: TvService[];
  /** Service choisi (détecté au premier lancement), vide si aucun. */
  active: string;
  detected: boolean;
}

export interface HomeSettings {
  clock: boolean;
  recent: boolean;
  bars: HomeBar[];
  /** Sites (identifiants de `web`) affichés sur l'accueil. */
  services: string[];
}

export interface UiSettings {
  fullscreen: boolean;
  theme: Theme;
  backdrop: boolean;
  /** Menu principal : à gauche ou à droite (barre latérale), en haut ou en bas (carrousel) ; rétractable ou non. */
  menu: { position: MenuPosition; autohide: boolean };
  /** Vue ouverte au lancement. */
  start: string;
  home: HomeSettings;
}

export interface SearchSettings {
  tmdbToken: string;
  region: string;
  language: string;
}

/** Site où chercher des jeux à télécharger (search avec {q}). */
export interface LinkSite {
  name: string;
  url: string;
  search: string;
}

/** Jeu PC ajouté à la main. */
export interface Game {
  name?: string;
  path: string;
  args?: string[];
  image?: string;
  [key: string]: unknown;
}

/** Console (émulateur), ajoutée à la main ou installée par la boutique (`store`). */
export interface Emulator {
  name?: string;
  path: string;
  args?: string[];
  /** Dossiers de jeux de la console. */
  sources: string[];
  /** Dossier principal des jeux (consoles de la boutique). */
  romsDir?: string;
  /** Extensions des fichiers de jeux (sans le point, ou avec). */
  extensions?: string[];
  /** Système (cœur libretro) des consoles de la boutique. */
  system?: string;
  /** Sites de téléchargement propres à la console (sinon ceux proposés d'office). */
  romSites?: LinkSite[];
  /** Console installée par la boutique : « émulateur:système ». */
  store?: string;
  banner?: string;
  [key: string]: unknown;
}

export interface AdblockSettings {
  enabled: boolean;
  /** Sites où le bloqueur est désactivé. */
  allowlist: string[];
  /** Listes de filtres en plus. */
  customLists: string[];
}

export interface DownloadSettings {
  /** Dossier des téléchargements (vide = Téléchargements/Mire). */
  dir: string;
  /** Client torrent : intégré (mire) ou logiciel installé (system). */
  torrentClient: 'mire' | 'system';
  /** Partage après téléchargement. */
  seed: boolean;
}

/** Page de streaming mise en marque-page : elle apparaît dans les Vidéos et rouvre le site. */
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

/** Jeu mis en marque-page depuis un site de téléchargement, en attente de téléchargement. */
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

export interface Config {
  version: number;
  library: { sources: LibrarySource[] };
  gameSources: GameSource[];
  externalPlayer: ExternalProgram;
  browser: ExternalProgram;
  tv: TvSettings;
  ui: UiSettings;
  search: SearchSettings;
  scrape: { auto: boolean };
  games: Game[];
  /** autoOnline : affiche d'emblée les jeux en ligne en ouvrant une console. */
  gamesOpts: { autoOnline: boolean };
  pcSites: LinkSite[];
  adblock: AdblockSettings;
  downloads: DownloadSettings;
  store: { romsRoot: string };
  bookmarks: Bookmark[];
  gameBookmarks: GameBookmark[];
  web: WebSite[];
  emulators: Emulator[];
}
