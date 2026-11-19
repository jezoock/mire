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

/** Console visée : identifiant d'une console (`Emulator.id`), ou « pc » pour les jeux PC. */
export type ConsoleRef = string;

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
  /**
   * Rangées de l'accueil de la phase 4 (P4-12), dans l'ordre (v9, P2-11). `clock`, `recent`, `bars` et `services`
   * restent ceux de l'interface historique ; la migration v9 en tire ces rangées, une fois.
   */
  rows: HomeRow[];
}

/**
 * Rangée de l'accueil (v9) :
 * - `bars` : barres de la mire ; chacune est une cible (`targets.ts`) : une page (son identifiant), une liste
 *   (`list:<id>`) ou un écran du cœur (`screen:<nom>`, `CORE_SCREENS`) ;
 * - `sites` : sites épinglés (anciennement « Vos services »), par clé d'élément (`web:<id>`) ;
 * - `recent` : « Reprendre » ;
 * - `page`, `list` : les premiers éléments d'une page ou d'une liste.
 */
export type HomeRow =
  { kind: 'bars'; targets: string[] } | { kind: 'sites'; keys: string[] } | { kind: 'recent' } | { kind: 'page'; id: string } | { kind: 'list'; id: string };

export interface UiSettings {
  fullscreen: boolean;
  theme: Theme;
  /** Thème des pages et de l'accueil (P4-11, `theme.json`) ; le réglage `theme` est la palette. */
  pageTheme: string;
  backdrop: boolean;
  /** Menu principal : à gauche ou à droite (barre latérale), en haut ou en bas (carrousel) ; rétractable ou non. */
  menu: { position: MenuPosition; autohide: boolean };
  /** Vue ouverte au lancement. */
  start: string;
  home: HomeSettings;
  /** Langue de l'interface : `auto` (langue du système) ou un code BCP 47 (`fr`, `en`, `pt-BR`). */
  language: string;
}

export interface SearchSettings {
  tmdbToken: string;
  /** Pays des disponibilités (« où regarder »). */
  region: string;
  /** Langue des fiches TMDB et Steam (`fr-FR`, `en-US`) ; vide = celle de l'interface. */
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
  /**
   * Identifiant stable (migration v6) : la valeur de `store` pour une console de la boutique, sinon le nom
   * simplifié suivi d'un suffixe aléatoire. Attribué une fois pour toutes ; jamais « pc ».
   */
  id: string;
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
  /** Émulateur par défaut (D-21) : identifiant d'une autre console du même système dont l'émulateur lance les jeux. */
  emulator?: string;
  /** Émulateur choisi pour un jeu (D-21) : clé de l'élément → identifiant d'une console du même système. */
  gameEmulators?: Record<string, string>;
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
  /** Catalogue d'éléments : absent tant que rien n'y a été changé (la version de la configuration ne change pas). */
  catalog?: CatalogSettings;
  /**
   * Réglages des plugins, par identifiant (P3-04) : absent tant qu'aucun n'a été changé. Les réglages secrets n'en
   * sortent jamais vers l'interface ni dans un export.
   */
  plugins?: PluginSettingsSection;
}

/** Réglage secret d'un plugin : chiffré par le système quand il le permet (`encrypted`). */
export interface StoredSecret {
  $secret: string;
  encrypted: boolean;
}

/** Valeur rangée d'un réglage de plugin. */
export type StoredPluginSetting = string | number | boolean | string[] | StoredSecret;

/** Section `plugins` de la configuration : identifiant du plugin → clé du réglage → valeur. */
export type PluginSettingsSection = Record<string, Record<string, StoredPluginSetting>>;

/** Réglages du catalogue d'éléments (P2-04). */
export interface CatalogSettings {
  /**
   * Règles par extension modifiées : extension (`.ts`) → tags posés ; une liste vide n'en pose aucun. Les autres
   * extensions suivent les formats reconnus (`KIND`). Absent : toutes les règles par défaut.
   */
  fileTags?: Record<string, string[]>;
  /**
   * Ordre de priorité des fournisseurs d'infos en ligne (`tmdb`, `musicbrainz`, `libretro`, `steam`) : pour une même
   * info, le premier l'emporte. Ceux qui manquent suivent, dans l'ordre par défaut. Absent : l'ordre par défaut.
   */
  metadataProviders?: string[];
}
