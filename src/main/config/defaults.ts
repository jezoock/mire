/** Configuration par défaut d'une installation neuve, et listes de valeurs admises. */
import type { Config, HomeBar, Theme } from '@mire/shared';
import { DEFAULT_TV } from './catalogs/tv.ts';

export const CONFIG_VERSION = 5;

// Barres de la mire proposées sur l'accueil, dans l'ordre d'origine.
export const HOME_BARS: readonly HomeBar[] = ['search', 'videos', 'music', 'images', 'streaming', 'tv', 'games'];
export const THEMES: readonly Theme[] = ['auto', 'ecran', 'jour', 'minuit', 'velours', 'contraste'];
export const THEME_BG: Readonly<Record<Exclude<Theme, 'auto'>, string>> = {
  ecran: '#1F2321',
  jour: '#F1EFE8',
  minuit: '#0F1524',
  velours: '#1C1513',
  contraste: '#000000',
};

export const DEFAULT_CONFIG: Readonly<Config> = {
  version: CONFIG_VERSION,
  // Sources de la bibliothèque : dossier, partage réseau (\\NAS\Films ou smb://nas/films) ou adresse web.
  library: { sources: [] },
  // Dossiers contenant des jeux PC (exécutables ou raccourcis).
  gameSources: [],
  externalPlayer: { path: '', args: [] },
  browser: { path: '', args: [] },
  // Télévision : services proposés d'office ; "active" = celui choisi (détecté au premier lancement).
  tv: { services: structuredClone([...DEFAULT_TV]), active: '', detected: false },
  ui: {
    fullscreen: false,
    theme: 'ecran',
    backdrop: true,
    // Menu principal : à gauche ou à droite (barre latérale), en haut ou en bas (carrousel) ; rétractable ou non.
    menu: { position: 'left', autohide: false },
    start: 'home',
    home: { clock: true, recent: true, bars: [...HOME_BARS], services: [] },
  },
  search: { tmdbToken: '', region: 'FR', language: 'fr-FR' },
  scrape: { auto: true },
  // Jeux : autoOnline affiche d'emblée les jeux en ligne en ouvrant une console.
  games: [],
  gamesOpts: { autoOnline: false },
  // Sites pour télécharger des jeux PC (aucun d'office). name, url, search avec {q}.
  pcSites: [],
  // Bloqueur de publicités des sites : sites où il est désactivé, listes de filtres en plus.
  adblock: { enabled: true, allowlist: [], customLists: [] },
  // Téléchargements : dossier (vide = Téléchargements/Mire), client torrent (mire = intégré, system = logiciel installé), partage après téléchargement.
  downloads: { dir: '', torrentClient: 'mire', seed: false },
  store: { romsRoot: '' },
  // Pages de streaming mises en marque-page : elles apparaissent dans les Vidéos et rouvrent le site.
  bookmarks: [],
  // Jeux mis en marque-page depuis un site de téléchargement (fiche, lien direct ou .torrent),
  // en attente de téléchargement. Ils apparaissent dans la liste des jeux avec un bouton Télécharger.
  gameBookmarks: [],
  // Rien n'est installé d'office : ni sites de streaming, ni jeux, ni consoles, ni sources. Tout s'ajoute
  // ensuite, à la main ou par un fichier de configuration (Réglages → Importer une configuration).
  web: [],
  emulators: [],
};

// Sections objets : complétées clé par clé par les valeurs par défaut.
export const NESTED = ['library', 'externalPlayer', 'browser', 'tv', 'ui', 'search', 'scrape', 'gamesOpts', 'store', 'adblock', 'downloads'] as const;
// Sections listes : remplacées par la valeur par défaut si ce n'est pas une liste.
export const LISTS = ['web', 'games', 'emulators', 'gameSources'] as const;
