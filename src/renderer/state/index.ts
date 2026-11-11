/**
 * État de l'interface, partagé par toutes les vues :
 * - `S` : section affichée, données reçues du processus principal, caches et choix en cours ;
 * - `Q` : file de lecture de la musique ; `V` : lecteur vidéo ; `I` : visionneuse d'images.
 * Chaque champ est déclaré ici avec sa valeur de départ, même ceux que les vues ne remplissent qu'en cours de route.
 * Les types restent larges tant que les données du processus principal ne sont pas décrites (`@mire/shared/ipc`).
 */
import type { DownloadItem, MediaItem, MireConfig, UsageSnapshot, WebSession } from '@mire/shared/ipc';

type Data = Record<string, unknown>;
type Dict<T = unknown> = Record<string, T>;

/** Nombre d'éléments affichés d'une liste, puis ajoutés à chaque « Afficher plus ». */
export const PAGE = 120;

export interface TmdbSearch {
  q: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  results: Data[];
  error?: string;
}

export interface State {
  config: MireConfig | null;
  configPath: string;
  platform: string;
  library: MediaItem[];
  videos: MediaItem[];
  tracks: MediaItem[];
  images: MediaItem[];
  scanned: boolean;
  scanning: boolean;
  /** Section affichée (`home`, `videos`, `web`…). */
  section: string;
  /** Filtre de la section affichée. */
  query: string;
  /** Nombre d'éléments affichés de la liste (`PAGE` de plus à chaque « Afficher plus »). */
  limit: number;
  /** Éléments affichés, dans l'ordre (lecture et navigation). */
  list: Data[];
  recent: Data[];
  /** Données d'usage, détenues par le processus principal (usage.json) : copie lue au démarrage. */
  usage: UsageSnapshot;
  channels: Data[] | null;
  tvWeb: Data[] | null;
  tvLoading: boolean;
  tvError: string | null;
  /** Console ouverte : son identifiant (les caches de jeux et de sites des consoles sont rangés par identifiant). */
  romsOf: string | null;
  roms: Data[] | null;
  /** Problèmes signalés à la lecture des jeux de la console ouverte. */
  romsWarnings: string[];
  romsError: string | null;
  /** Fiche en cours de modification. */
  draft: Data | null;
  pendingFocus: boolean;
  /** Élément dont le panneau d'informations est affiché (cible de « Modifier »). */
  focusRef: Data | null;
  // Vue web intégrée
  webSessions: WebSession[];
  webActive: string | null;
  webStates: Dict<Data>;
  webFocused: boolean;
  webFocusOnShow: boolean;
  // Recherche globale
  gq: string;
  tmdb: TmdbSearch;
  romsCache: Dict;
  gs: Data;
  /** Infos et images récupérées (clé : v:chemin, a:dossier, r:chemin, g:nom). */
  scrape: Dict<Data>;
  scraping: Data | null;
  /** Récupération lancée en silence : le message de fin ne s'affiche que si des infos ont été trouvées. */
  scrapeQuiet: boolean;
  // Sources, modifications manuelles, genres, manette
  meta: Dict<Data>;
  sourceStatus: Dict;
  autoGames: Data[];
  gameSourceStatus: Dict;
  gameList: Data[];
  genre: string;
  pad: { id: string; family: string } | null;
  adblock: Data | null;
  // Boutique
  catalog: Data | null;
  storeProgress: Dict<Data>;
  raPick: Set<string>;
  romSites: Dict;
  localRoms: Dict<Data[]>;
  videoSeries: string | null;
  videoSeason: number | null;
  videoSource: string;
  searchSource: Dict<string>;
  videoSort: string;
  videoCards: Data[];
  gameSystem: string;
  romsOnline: boolean;
  romsOnlineLoading: boolean;
  romsSource: string;
  downloads: DownloadItem[];
  dlSettings: Data;
}

export const S: State = {
  config: null,
  configPath: '',
  platform: '',
  library: [],
  videos: [],
  tracks: [],
  images: [],
  scanned: false,
  scanning: false,
  section: 'home',
  query: '',
  limit: PAGE,
  list: [],
  recent: [],
  usage: { recent: [], volume: 0.9, queries: [] },
  channels: null,
  tvWeb: null,
  tvLoading: false,
  tvError: null,
  romsOf: null,
  roms: null,
  romsWarnings: [],
  romsError: null,
  draft: null,
  pendingFocus: false,
  focusRef: null,
  webSessions: [],
  webActive: null,
  webStates: {},
  webFocused: false,
  webFocusOnShow: false,
  gq: '',
  tmdb: { q: '', status: 'idle', results: [] },
  romsCache: {},
  gs: {},
  scrape: {},
  scraping: null,
  scrapeQuiet: false,
  meta: {},
  sourceStatus: {},
  autoGames: [],
  gameSourceStatus: {},
  gameList: [],
  genre: '',
  pad: null,
  adblock: null,
  catalog: null,
  storeProgress: {},
  raPick: new Set(),
  romSites: {},
  localRoms: {},
  videoSeries: null,
  videoSeason: null,
  videoSource: '',
  searchSource: {},
  videoSort: 'title',
  videoCards: [],
  gameSystem: '',
  romsOnline: false,
  romsOnlineLoading: false,
  romsSource: '',
  downloads: [],
  dlSettings: {},
};

/** File de lecture de la musique : morceaux et position du morceau en cours (-1 : aucun). */
export const Q: { list: MediaItem[]; i: number } = { list: [], i: -1 };

/** Lecteur vidéo : file, sous-titres, minuteries des commandes, élément à refocaliser en sortant. */
export const V = {
  list: [] as MediaItem[],
  i: -1,
  /** Adresses `blob:` des sous-titres convertis, libérées à la vidéo suivante. */
  blobs: [] as string[],
  subIndex: -1,
  subLabels: [] as string[],
  hideTimer: 0,
  silentTimer: 0,
  /** Dernier enregistrement de la position de reprise (horodatage). */
  lastSave: 0,
  returnSel: null as string | null,
  seeking: false,
  cuesUp: null as boolean | null,
};

/** Visionneuse d'images : liste, image affichée, diaporama, élément à refocaliser en sortant. */
export const I = {
  list: [] as MediaItem[],
  i: 0,
  timer: 0,
  hideTimer: 0,
  returnSel: null as string | null,
};
