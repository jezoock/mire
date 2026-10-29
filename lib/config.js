'use strict';
const crypto = require('node:crypto');
const { MEDIA_KINDS } = require('./formats.js');

const CONFIG_VERSION = 5;

// Barres de la mire proposées sur l'accueil, dans l'ordre d'origine.
const HOME_BARS = ['search', 'videos', 'music', 'images', 'streaming', 'tv', 'games'];
const THEMES = ['auto', 'ecran', 'jour', 'minuit', 'velours', 'contraste'];
const THEME_BG = { ecran: '#1F2321', jour: '#F1EFE8', minuit: '#0F1524', velours: '#1C1513', contraste: '#000000' };

// Sites proposés d'office. mode "integrated" : vue web dans Mire ; "browser" : navigateur externe (secours).
// search : adresse de recherche ({q} = mots cherchés). Vide : à apprendre avec « Mémoriser la recherche ».
// providers : noms utilisés par TMDB/JustWatch pour ce service ("=nom" : correspondance exacte).
// background : la lecture continue quand on quitte le site (musique). group : rangement dans Streaming.
// Services pour regarder la télévision, proposés d'office (ils ne sont pas vidés à l'installation).
// kind "playlist" : liste M3U lue dans Mire ; kind "web" : portail du fournisseur dans la vue intégrée.
// detect : adresse jointe sur le réseau local au premier lancement pour reconnaître le service en place.
const DEFAULT_TV = [
  {
    id: 'freebox',
    name: 'Freebox TV',
    kind: 'playlist',
    url: 'http://mafreebox.freebox.fr/freeboxtv/playlist.m3u',
    detect: 'http://mafreebox.freebox.fr/',
    quality: 'hd',
  },
  { id: 'orange', name: 'Orange TV', kind: 'playlist', url: 'http://lafibre.info/images/orange/TV_sur_PC_Orange.m3u', detect: 'http://livebox.home/' },
  { id: 'sfr', name: 'SFR TV', kind: 'web', url: 'https://tv.sfr.fr/', detect: 'http://192.168.1.1/' },
  { id: 'bouygues', name: 'B.tv (Bouygues)', kind: 'web', url: 'https://www.bouyguestelecom.fr/tv-direct/', detect: 'http://mabbox.bytel.fr/' },
  { id: 'molotov', name: 'Molotov', kind: 'web', url: 'https://www.molotov.tv/', detect: '' },
];

const DEFAULT_WEB = [
  {
    id: 'netflix',
    group: 'video',
    name: 'Netflix',
    url: 'https://www.netflix.com/browse',
    color: '#E50914',
    search: 'https://www.netflix.com/search?q={q}',
    providers: ['netflix'],
  },
  {
    id: 'prime',
    group: 'video',
    name: 'Prime Video',
    url: 'https://www.primevideo.com',
    color: '#1A98FF',
    search: 'https://www.primevideo.com/search/ref=atv_nb_sug?ie=UTF8&phrase={q}',
    providers: ['prime video'],
  },
  {
    id: 'disney',
    group: 'video',
    name: 'Disney+',
    url: 'https://www.disneyplus.com/fr-fr',
    color: '#1A3FD8',
    search: '',
    providers: ['disney plus', 'disney+'],
  },
  { id: 'canal', group: 'video', name: 'Canal+', url: 'https://www.canalplus.com', color: '#2B2B2B', search: '', providers: ['canal+', 'canal plus'] },
  { id: 'hbomax', group: 'video', name: 'HBO Max', url: 'https://play.hbomax.com', color: '#4B2BD6', search: '', providers: ['hbo max', '=max'] },
  {
    id: 'appletv',
    group: 'video',
    name: 'Apple TV',
    url: 'https://tv.apple.com/fr',
    color: '#DADADF',
    search: 'https://tv.apple.com/fr/search?term={q}',
    providers: ['apple tv'],
  },
  { id: 'paramount', group: 'video', name: 'Paramount+', url: 'https://www.paramountplus.com/fr/', color: '#0064FF', search: '', providers: ['paramount'] },
  {
    id: 'crunchyroll',
    group: 'video',
    name: 'Crunchyroll',
    url: 'https://www.crunchyroll.com/fr',
    color: '#F47521',
    search: 'https://www.crunchyroll.com/fr/search?q={q}',
    providers: ['crunchyroll'],
  },
  {
    id: 'youtube',
    group: 'video',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    color: '#FF0033',
    search: 'https://www.youtube.com/results?search_query={q}',
    providers: ['youtube'],
  },
  { id: 'francetv', group: 'video', name: 'france.tv', url: 'https://www.france.tv', color: '#3046F0', search: '', providers: ['france tv', 'france.tv'] },
  {
    id: 'amazon-music',
    group: 'music',
    name: 'Amazon Music',
    url: 'https://music.amazon.fr',
    color: '#25D1DA',
    search: 'https://music.amazon.fr/search/{q}',
    background: true,
  },
  {
    id: 'spotify',
    group: 'music',
    name: 'Spotify',
    url: 'https://open.spotify.com',
    color: '#1ED760',
    search: 'https://open.spotify.com/search/{q}',
    background: true,
  },
  {
    id: 'deezer',
    group: 'music',
    name: 'Deezer',
    url: 'https://www.deezer.com/fr/',
    color: '#A238FF',
    search: 'https://www.deezer.com/search/{q}',
    background: true,
  },
  { id: 'juststream', name: 'JustStream', url: 'https://juststream.now/', color: '#8E6CF0', search: '' },
  { id: 'voir-anime', name: 'Voir-Anime', url: 'https://voir-anime.to/', color: '#F28C28', search: '' },
].map((w) => ({ mode: 'integrated', ...w }));

// Services de streaming connus : ils ne sont PAS installés d'office, mais servent de modèles
// (adresse, recherche, correspondance TMDB) quand l'utilisateur ajoute l'un d'eux.
const KNOWN_WEB = DEFAULT_WEB;

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  // Sources de la bibliothèque : dossier, partage réseau (\\NAS\Films ou smb://nas/films) ou adresse web.
  library: { sources: [] },
  // Dossiers contenant des jeux PC (exécutables ou raccourcis).
  gameSources: [],
  externalPlayer: { path: '', args: [] },
  browser: { path: '', args: [] },
  // Télévision : services proposés d'office ; "active" = celui choisi (détecté au premier lancement).
  tv: { services: structuredClone(DEFAULT_TV), active: '', detected: false },
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
const NESTED = ['library', 'externalPlayer', 'browser', 'tv', 'ui', 'search', 'scrape', 'gamesOpts', 'store', 'adblock', 'downloads'];

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Import « compléter » : ajoute au présent ce qui vient du fichier, sans doublon ni perte de l'existant.
function mergeConfig(current, incoming) {
  const out = structuredClone(current);
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const byKey = (arr, key) => new Set((arr || []).map(key));
  // Sites de streaming (par id).
  if (Array.isArray(inc.web)) {
    const have = byKey(out.web, (w) => w.id);
    for (const w of inc.web) if (w && w.id && !have.has(w.id)) out.web.push(w);
  }
  // Consoles et jeux PC (par chemin), sources de la bibliothèque et dossiers de jeux (par emplacement).
  if (Array.isArray(inc.emulators)) {
    const have = byKey(out.emulators, (e) => e.path);
    for (const e of inc.emulators) if (e && e.path && !have.has(e.path)) out.emulators.push(e);
  }
  if (Array.isArray(inc.games)) {
    const have = byKey(out.games, (g) => g.path);
    for (const g of inc.games) if (g && g.path && !have.has(g.path)) out.games.push(g);
  }
  if (inc.library && Array.isArray(inc.library.sources)) {
    const have = byKey(out.library.sources, (x) => `${x.kind}:${x.location}`);
    for (const x of inc.library.sources) if (x && x.location && !have.has(`${x.kind}:${x.location}`)) out.library.sources.push(x);
  }
  if (Array.isArray(inc.gameSources)) {
    const have = byKey(out.gameSources, (x) => x.location);
    for (const x of inc.gameSources) if (x && x.location && !have.has(x.location)) out.gameSources.push(x);
  }
  if (inc.tv && Array.isArray(inc.tv.services)) {
    const have = byKey(out.tv.services, (t) => t.id);
    for (const t of inc.tv.services) if (t && t.id && !have.has(t.id)) out.tv.services.push(t);
  }
  return out;
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const c = { ...structuredClone(DEFAULT_CONFIG), ...src };
  for (const k of NESTED) c[k] = { ...DEFAULT_CONFIG[k], ...(src[k] && typeof src[k] === 'object' ? src[k] : {}) };
  for (const k of ['web', 'games', 'emulators', 'gameSources']) if (!Array.isArray(c[k])) c[k] = structuredClone(DEFAULT_CONFIG[k]);
  const validLocation = (x) => x && typeof x === 'object' && typeof x.location === 'string' && x.location.trim();
  c.library.sources = (Array.isArray(c.library.sources) ? c.library.sources : [])
    .filter((x) => validLocation(x) && MEDIA_KINDS.includes(x.kind))
    .map((x) => ({ id: String(x.id || newId()), kind: x.kind, location: x.location.trim() }));
  delete c.library.folders;
  c.gameSources = c.gameSources.filter(validLocation).map((x) => ({ id: String(x.id || newId()), location: x.location.trim() }));
  c.web = c.web
    .filter((w) => w && typeof w === 'object' && w.url)
    .map((w, i) => ({
      ...w,
      id: String(w.id || slug(w.name) || `site-${i}`),
      mode: w.mode === 'browser' ? 'browser' : 'integrated',
      search: typeof w.search === 'string' ? w.search : '',
    }));
  c.version = CONFIG_VERSION;
  const home = { ...DEFAULT_CONFIG.ui.home, ...(src.ui?.home && typeof src.ui.home === 'object' ? src.ui.home : {}) };
  home.clock = home.clock !== false;
  home.recent = home.recent !== false;
  home.bars = [...new Set(Array.isArray(home.bars) ? home.bars : [])].filter((b) => HOME_BARS.includes(b));
  home.services = [...new Set(Array.isArray(home.services) ? home.services : [])].filter((id) => c.web.some((w) => w.id === id));
  c.ui.home = home;
  if (!THEMES.includes(c.ui.theme)) c.ui.theme = 'ecran';
  if (typeof c.ui.start !== 'string') c.ui.start = 'home';
  c.games = c.games.filter((g) => g && typeof g === 'object' && g.path);
  c.gameBookmarks = (Array.isArray(c.gameBookmarks) ? c.gameBookmarks : [])
    .filter((b) => b && typeof b === 'object' && b.source)
    .map((b) => ({
      id: String(b.id || newId()),
      source: String(b.source),
      kind: b.kind === 'torrent' ? 'torrent' : 'http',
      title: String(b.title || ''),
      console: b.console == null ? null : b.console === 'pc' ? 'pc' : Number(b.console),
      system: String(b.system || ''),
      downloadId: b.downloadId || null,
      done: b.done === true,
      added: b.added || Date.now(),
    }));
  c.bookmarks = (Array.isArray(c.bookmarks) ? c.bookmarks : [])
    .filter((b) => b && typeof b.url === 'string' && /^https?:\/\//i.test(b.url))
    .map((b) => ({
      id: String(b.id || newId()),
      url: b.url,
      title: String(b.title || ''),
      type: b.type === 'tv' ? 'tv' : 'movie',
      season: b.season || null,
      episode: b.episode || null,
      site: String(b.site || ''),
      added: b.added || Date.now(),
    }));
  c.pcSites = (Array.isArray(c.pcSites) ? c.pcSites : [])
    .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
    .map((x) => ({ name: String(x.name || x.url), url: x.url, search: typeof x.search === 'string' ? x.search : '' }));
  c.gamesOpts = { autoOnline: (c.gamesOpts && c.gamesOpts.autoOnline) === true };
  c.emulators = c.emulators
    .filter((e) => e && typeof e === 'object' && e.path)
    .map((e) => {
      const out = { ...e, sources: Array.isArray(e.sources) ? e.sources.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [] };
      if (Array.isArray(e.romSites))
        out.romSites = e.romSites
          .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
          .map((x) => ({ name: String(x.name || x.url), url: x.url, search: typeof x.search === 'string' ? x.search : '' }));
      else delete out.romSites;
      return out;
    });
  c.ui.backdrop = c.ui.backdrop !== false;
  const menu = { ...DEFAULT_CONFIG.ui.menu, ...(src.ui?.menu && typeof src.ui.menu === 'object' ? src.ui.menu : {}) };
  if (!['left', 'right', 'top', 'bottom'].includes(menu.position)) menu.position = 'left';
  menu.autohide = menu.autohide === true;
  c.ui.menu = menu;
  // Télévision : on garde les services proposés par défaut, complétés par ceux de l'utilisateur.
  const tvSrc = src.tv && typeof src.tv === 'object' ? src.tv : {};
  const userServices = Array.isArray(tvSrc.services) ? tvSrc.services : [];
  const byId = new Map(DEFAULT_TV.map((t) => [t.id, structuredClone(t)]));
  for (const t of userServices) {
    if (!t || typeof t !== 'object' || !t.url) continue;
    const id = String(t.id || slug(t.name) || newId());
    byId.set(id, { ...(byId.get(id) || {}), ...t, id, kind: t.kind === 'web' ? 'web' : 'playlist' });
  }
  c.tv = { services: [...byId.values()], active: typeof tvSrc.active === 'string' ? tvSrc.active : '', detected: tvSrc.detected === true };
  if (c.tv.active && !c.tv.services.some((t) => t.id === c.tv.active)) c.tv.active = '';
  delete c.freebox;
  return c;
}

const newId = () => crypto.randomBytes(5).toString('hex');

// Version 1 → 2 : les sites passent dans la vue intégrée et reçoivent leur adresse de recherche.
function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object') return { raw, changed: false };
  const v = Number(raw.version) || 1;
  if (v >= CONFIG_VERSION) return { raw, changed: false };
  if (v < 2 && Array.isArray(raw.web)) {
    raw.web = raw.web.map((w) => {
      if (!w || typeof w !== 'object') return w;
      const def = DEFAULT_CONFIG.web.find((d) => d.id === w.id) || {};
      const next = { ...w, mode: 'integrated' };
      if (!next.search && def.search) next.search = def.search;
      if (next.background == null && def.background) next.background = true;
      if (!next.providers && def.providers) next.providers = def.providers;
      return next;
    });
  }
  if (raw.ui) delete raw.ui.webFullscreen;
  // Version 4 : chaque dossier de la bibliothèque devient une source par type de média.
  if (v < 4 && raw.library && Array.isArray(raw.library.folders)) {
    raw.library.sources = raw.library.folders
      .filter((f) => typeof f === 'string' && f.trim())
      .flatMap((f) => MEDIA_KINDS.map((kind) => ({ id: newId(), kind, location: f })));
    delete raw.library.folders;
  }
  // Version 3 : ajout des grands services de streaming, rangés dans l'ordre par défaut ;
  // les sites ajoutés par l'utilisateur restent à la fin.
  if (v < 3 && Array.isArray(raw.web)) {
    const mine = new Map(raw.web.filter((w) => w && w.id).map((w) => [w.id, w]));
    const ordered = DEFAULT_WEB.map((d) => (mine.has(d.id) ? { ...d, ...mine.get(d.id) } : d));
    const custom = raw.web.filter((w) => w && !DEFAULT_WEB.some((d) => d.id === w.id));
    raw.web = [...ordered, ...custom];
  }
  // Version 5 : la télé devient une liste de services ; l'ancienne playlist Freebox est conservée.
  if (v < 5) {
    const services = structuredClone(DEFAULT_TV);
    if (raw.freebox && typeof raw.freebox === 'object') {
      const fb = services.find((t) => t.id === 'freebox');
      if (raw.freebox.playlist) fb.url = raw.freebox.playlist;
      if (raw.freebox.quality) fb.quality = raw.freebox.quality;
    }
    // Avant la v5, les sites étaient installés d'office : on garde ceux que l'utilisateur a réellement,
    // mais ceux qu'il a ajoutés lui-même (hors liste connue) restent, les autres ne sont gardés que s'ils existaient.
    raw.tv = { services, active: 'freebox', detected: true };
    delete raw.freebox;
    if (raw.ui && raw.ui.home && Array.isArray(raw.ui.home.services)) {
      /* conservés tels quels, filtrés plus tard */
    }
  }
  raw.version = CONFIG_VERSION;
  return { raw, changed: true };
}

module.exports = {
  CONFIG_VERSION,
  HOME_BARS,
  THEMES,
  THEME_BG,
  DEFAULT_TV,
  DEFAULT_WEB,
  DEFAULT_CONFIG,
  NESTED,
  slug,
  newId,
  mergeConfig,
  normalizeConfig,
  migrateConfig,
};
