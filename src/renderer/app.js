/* Mire : interface. Affichage des sections et actions ; les lecteurs intégrés (players/) et la navigation au clavier
   et à la manette (nav/) sont branchés plus bas, avec ce qu'ils attendent de l'interface. */
import { $, $$, esc } from './core/dom.ts';
import { plural } from './core/format.ts';
import { ICON } from './core/icons.ts';
import { barFor, monogram, onColor, safeColor } from './core/colors.ts';
import { toast } from './ui/toast.ts';
import * as dialogs from './ui/dialogs.ts';
import { PAGE, S } from './state/index.ts';
import { api } from './api/index.ts';
import { fold, splitAlbumFolder } from '@mire/shared';
import * as D from './domain/index.ts';
import { cleanTrack, collator, folderLabel, folderText, genresOf, labelOf, metaKey, scrapeKey } from './domain/index.ts';
import { mediaUrl } from './core/media.ts';
import { focusSelectorOf } from './nav/spatial.ts';
import { focusFirst, restoreFocus } from './nav/focus.ts';
import { pendingFocusDue } from './nav/targets.ts';
import { initKeyboard } from './nav/keyboard.ts';
import { initGamepad, startGamepad } from './nav/gamepad.ts';
import { nextSection } from './nav/gamepad-data.ts';
import { setVolume } from './players/volume.ts';
import { audio, initAudio, markPlaying, musicUi, playQueue, stepTrack, toggleAudio } from './players/audio.ts';
import { initVideo, isVideoOpen, openVideo, stepVideo, video, videoKey, videoUi } from './players/video.ts';
import { imageKey, imagesUi, initImages, isImagesOpen, openImages } from './players/images.ts';
import { createPaletteLoader } from '@mire/ui/palettes';
import { DEMO_SECTION, demoTitle, initDemoDialogs, isDemoHash, loadDemoTexts, viewDemo } from './demo/index.ts';
import { createControllers } from './controllers/index.ts';
import { runLegacyAction } from './controllers/bridge.ts';
import { callAction, setActionErrorHandler } from './controllers/registry.ts';
import { i18n, t } from './i18n/index.ts';
import { CENTRE_VIEW, EXPLORER_VIEW, HOME_VIEW, PAGE_VIEW, SEARCH_VIEW, SETTINGS_VIEW, createShell, legacySectionOf, targetOfLegacyView } from './shell/index.ts';
import { createPages } from './pages/index.ts';
import { createHome, homeOptions } from './home/index.ts';
import { createSearch } from './search/index.ts';
import { createWeb, webHome as webHomeOf } from './web/index.ts';
import { createExplorer } from './explorer/index.ts';
import { adblockStatusText, createSettings, drmStatusText } from './settings/index.ts';
import { cardKeyOf, groupRefOf, initEditors } from './editors/index.ts';
import { consoleCards, isGameBookmarkKey, isGameKey } from './games/model.ts';
import { applyDownload, createCentre, downloadAddedNotice, romAddedNotice, romProgressNotice } from './centre/index.ts';
import { pluralLabel } from '@mire/ui/utils';
import { BUILTIN_THEMES } from './themes/index.ts';
import { activeDownloads } from './shell/menu.ts';
import { createRescue, createThemeWatch } from './rescue/index.ts';

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

// Logique sans DOM ni état (domain/) : ces raccourcis lui passent les données de S.
const infos = () => ({ scrape: S.scrape, meta: S.meta });
const withScrape = (it) => D.withScrape(it, infos());
const filterQ = (items, text) => D.filterQ(items, S.query, text);
const pcGameEntries = () => D.pcGameEntries(S.config.games, S.autoGames, infos());
const allLocalGames = () => D.allLocalGames({ games: S.config.games, autoGames: S.autoGames, emulators: S.config.emulators, localRoms: S.localRoms, gameBookmarks: S.config.gameBookmarks }, infos());

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

// S, Q, V et I sont déclarés dans state/.

// Le réglage « thème » désigne une palette (P4-02) ; le chargeur suit aussi le mode du système (« Automatique »).
const palette = createPaletteLoader();
function applyTheme() {
  palette.set(S.config?.ui?.theme);
  // Thème des pages (P4-11) : sa palette, ses polices et sa mise en page, sans redémarrage ; il peut placer le menu.
  const before = pages.engine.current();
  const after = pages.engine.set(S.config?.ui?.pageTheme);
  if (after.menu !== before.menu) applyMenu();
}

/* ---------- Coquille (P4-07) : menu, en-tête et aide de la manette, dans <mire-app> (shell/) ---------- */

function menuSettings() { return S.config?.ui?.menu || { position: 'left', autohide: false }; }

const shell = createShell({
  t,
  language: () => i18n.language,
  onLanguageChange: (listener) => i18n.onChange(listener),
  show: (section, { focus }) => go(section, { focus }),
  // Le menu rétractable s'ouvre ou se ferme : la vue web se replace.
  onLayout: () => { if (S.section === 'web') syncWeb(); },
});

// Accueil (P4-12) : ses rangées, tirées des réglages de l'accueil, du catalogue et de « Reprendre ».
const home = createHome({
  t,
  plural: (key, count) => {
    const forms = i18n.raw(key);
    return forms && typeof forms === 'object' ? pluralLabel(forms, count, i18n.language || 'fr') : '';
  },
  raw: (key) => i18n.raw(key),
  language: () => i18n.language,
  settings: () => S.config?.ui?.home,
  pages: () => shell.pages(),
  lists: () => api.listsList(),
  level: (id, path) => api.catalogPage(id, path, null),
  element: (key) => api.catalogElement(key),
  // « Reprendre » : la copie locale de la liste, que le contrôleur `mire-home` relit pour reprendre une lecture.
  recent: () => (S.recent = getRecent()),
  sites: () => S.config?.web ?? [],
  openSites: () => new Set(S.webSessions.map((x) => x.id)),
  color: safeColor,
  ink: onColor,
  onLanguageChange: (listener) => i18n.onChange(listener),
  onPagesChange: (listener) => api.onPagesChange(listener),
  // Rangées rendues : le focus va au contenu s'il était demandé, ou s'il s'est perdu.
  onRendered: () => {
    if (S.section !== HOME_VIEW) return;
    if (takePendingFocus()) focusFirst();
  },
});

// Centre (P4-18) : téléchargements et apps, rédigés par les catalogues d'après les données du processus principal.
const centre = createCentre({
  t,
  language: () => i18n.language,
  downloads: () => S.downloads,
  torrentClient: () => S.dlSettings?.torrentClient,
  catalog: () => S.catalog,
  loadCatalog: () => loadCatalog(),
  apps: () => ({ picks: S.raPick, progress: S.storeProgress, consoles: S.config?.emulators ?? [] }),
  consoles: () => consoleCards(S.config?.emulators, t),
  // Plugins et dépôts (P4-19) : listes lues sans réseau ; seul « Rechercher des mises à jour » lit les dépôts en ligne.
  plugins: () => (S.plugins ? { ...S.plugins, progress: S.pluginProgress, sheet: S.pluginSheet } : null),
  loadPlugins: () => loadPlugins(),
  onLanguageChange: (listener) => i18n.onChange(listener),
  // Centre redessiné : le focus va où l'action l'a demandé (fiche ouverte, refermée) ; s'il était sur un bouton
  // retiré, au premier élément du contenu.
  onRendered: () => {
    if (S.section !== CENTRE_VIEW) return;
    const sel = centre.takeFocus();
    if (sel) return restoreFocus({ el: null, sel: `#view mire-centre ${sel}` });
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) focusFirst();
  },
});

// Recherche (P4-13) : le catalogue groupé par page, « Où regarder » et les sites, rédigés par les catalogues.
const search = createSearch({
  t,
  raw: (key) => i18n.raw(key),
  catalog: (q) => api.catalogSearch(q),
  watch: (q) => (S.config?.search?.tmdbToken ? api.searchStreaming(q) : null),
  pages: () => shell.pages(),
  sites: () => S.config?.web ?? [],
  color: safeColor,
  ink: onColor,
  recent: () => getQueries(),
  remember: (q) => rememberQuery(q),
  onLanguageChange: (listener) => i18n.onChange(listener),
  // Recherche redessinée : le focus, s'il était sur une carte retirée, va au champ.
  onRendered: () => {
    if (S.section !== SEARCH_VIEW) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) search.focusField();
  },
});

// Explorateur (P4-08) : tout le catalogue en colonnes (pages, listes, tags, sources, dossiers), puis l'aperçu d'un élément.
// Texte au pluriel des nouveaux écrans (explorateur, et ses actions).
function explorerPlural(key, count) {
  const forms = i18n.raw(key);
  return forms && typeof forms === 'object' ? pluralLabel(forms, count, i18n.language || 'fr') : '';
}

const explorer = createExplorer({
  t,
  plural: explorerPlural,
  pages: () => shell.pages(),
  lists: () => api.listsList(),
  tags: () => api.tagsList(),
  level: (id, path, cursor) => api.catalogPage(id, path, cursor),
  element: (key) => api.catalogElement(key),
  sources: () => api.catalogSources(),
  folder: (source, path, cursor) => api.catalogFolder(source, path, cursor),
  check: async (paths) => {
    const r = await api.filesCheck(paths);
    return Array.isArray(r) ? r : null;
  },
  onLanguageChange: (listener) => i18n.onChange(listener),
  onPagesChange: (listener) => { api.onPagesChange(listener); api.onListsChange(listener); api.onFoldersChange(listener); },
  shown: () => S.section === EXPLORER_VIEW,
  // Colonnes redessinées : le focus, s'il était sur une ligne retirée, revient à la première colonne.
  onRendered: () => {
    if (S.section !== EXPLORER_VIEW) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) explorer.focusFirst();
  },
});
// Réglages (P4-20) : panneaux générés depuis le schéma des réglages et les manifestes des plugins, enregistrés dès
// qu'ils changent.
const settings = createSettings({
  t,
  sources: () => ({
    config: S.config,
    languages: i18n.available,
    sites: S.config?.web ?? [],
    pageThemes: pages.engine.list().map((th) => ({ id: th.id, name: themeText(th.name), description: th.description ? themeText(th.description) : '' })),
    currentPageTheme: pages.engine.current().id,
    homeLists: ['rows', 'bars', 'sites'].map((kind) => ({ kind, label: t(`home.settings.${kind}`), items: homeOptions(S.config.ui.home, kind, { t, pages: shell.pages(), lists: home.lists(), sites: S.config.web, color: safeColor }) })),
    adblockStatus: S.adblock ? adblockStatusText(S.adblock, t, (d) => i18n.engine?.formatDate(d) ?? d.toLocaleDateString()) : '',
    drmStatus: drmText,
    configPath: S.configPath,
    sourceStatus: S.sourceStatus,
    gameSourceStatus: S.gameSourceStatus,
    scanning: !!S.scanning,
  }),
  plugins: () => api.pluginsSettings(),
  pages: () => api.pagesOverview(),
  tags: () => api.tagsOverview(),
  lists: () => api.listsList(),
  pluginNames: async () => Object.fromEntries(((await api.pluginsList()) ?? []).map((p) => [p.id, p.name])),
  providers: () => api.pluginsMetadataProviders(),
  onChange: (key, value) => C.settings.setValue({ key, value }).catch((err) => toast(err.message, { duration: 6000 })),
  onOrder: (kind, keys) => C.settings.setOrder({ kind, keys }).catch((err) => toast(err.message, { duration: 6000 })),
  onLanguageChange: (listener) => i18n.onChange(listener),
  // Réglages redessinés : le focus, s'il était sur un bouton retiré, va au premier élément du contenu.
  onRendered: () => {
    if (S.section !== SETTINGS_VIEW) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) focusFirst();
  },
});
// Nom et description d'un thème des pages : une clé de catalogue, ou un texte tel quel.
const themeText = (n) => (typeof n === 'string' ? n : t(n.key));

// Pages de la coquille (P4-11) : la vue de page, remplie d'après la route et le thème choisi.
const pages = createPages({
  router: shell.router,
  pages: () => shell.pages(),
  level: (id, path, cursor) => api.catalogPage(id, path, cursor),
  onPagesChange: (listener) => api.onPagesChange(listener),
  t,
  raw: (key) => i18n.raw(key),
  onLanguageChange: (listener) => i18n.onChange(listener),
  themes: BUILTIN_THEMES,
  // Le thème des pages habille aussi l'accueil (P4-12) : même palette, mêmes polices, même fond.
  themed: [home.host],
  // Niveau rendu : titre de l'en-tête ; le focus, s'il était sur une carte retirée, va au premier élément du contenu.
  onLoaded: () => {
    if (S.section !== PAGE_VIEW) return;
    loadChannelsForPage();
    render();
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) focusFirst();
  },
});

home.attach(pages.engine);

// Mode secours (P4-10) : bandeau au-dessus de l'explorateur, qui s'ouvre sur une demande ou quand le thème ne
// s'affiche pas (introuvable, fichier en échec, délai dépassé). Un thème affiché sans souci le signale au processus
// principal, pour qui les plantages précédents ne comptent plus.
const pageThemes = () => pages.engine.list().map((th) => ({ id: th.id, name: themeText(th.name) }));
const rescue = createRescue({
  t,
  themes: () => { const cur = pages.engine.current().id; return pageThemes().map((th) => ({ ...th, current: th.id === cur })); },
  themeName: (id) => pageThemes().find((th) => th.id === id)?.name ?? id,
  openExplorer: () => go(EXPLORER_VIEW, { focus: 'content' }),
  onLanguageChange: (listener) => i18n.onChange(listener),
});
const themeWatch = createThemeWatch({
  onFail: (req) => rescue.request(req),
  onStable: () => { api.rescueThemeOk(); },
});
pages.engine.onLoad((load) => themeWatch.load(load));
api.onRescue((req) => rescue.request(req));

// Vue web (P4-16) : barre du site et place de la vue native, d'après l'état publié par le processus principal.
const web = createWeb({
  t,
  icons: { back: ICON.chevL, forward: ICON.chevR, reload: ICON.reload, search: ICON.search, shield: ICON.shield, shieldOff: ICON.shieldOff, star: ICON.star, fullscreen: ICON.fullscreen, globe: ICON.globe, close: ICON.close },
  adblock: () => !!S.adblock?.enabled,
  menu() {
    if (!document.body.classList.contains('menu-auto') || !document.body.classList.contains('menu-open')) return null;
    const r = $('#rail')?.getBoundingClientRect();
    return r ? { box: { x: r.left, y: r.top, width: r.width, height: r.height }, side: menuSettings().position } : null;
  },
  shouldShow: () => webShouldShow(),
  show: (id, bounds, focus) => api.webShow(id, bounds, focus),
  bounds: (bounds) => api.webBounds(bounds),
  hide: () => api.webHide(),
  onSite: (id, site) => callAction('mire-page', 'openRomSites', { consoleId: String(id).slice(4), site }),
  onLanguageChange: (listener) => i18n.onChange(listener),
});

// Le focus arrive dans la barre (clic, flèches) : Mire a le clavier, la manette pilote la barre et non plus le site.
web.host.addEventListener('focusin', () => { S.webFocused = false; });

// La page Télévision affiche les chaînes du catalogue : elles y entrent quand leur liste est lue.
function loadChannelsForPage() {
  if (shell.router.current().target !== 'tv' || S.channels || S.tvWeb || S.tvLoading || S.tvError) return;
  loadChannels();
}

function applyMenu() {
  // La place du menu voulue par le thème des pages l'emporte sur celle des réglages.
  const themed = pages.engine.current().menu;
  shell.setMenu(themed ? { ...menuSettings(), position: themed } : menuSettings());
  if (S.section === 'web') setTimeout(syncWeb, 300);
}

const SEARCHABLE = new Set(['videos', 'music', 'images', 'tv', 'games']);

const viewEl = $('#view');
const searchEl = $('#search');
const headerToolsEl = $('#header-tools');
const headerToolsRightEl = $('#header-tools-right');

/* ------------------------------------------------------------------ */
/* Historique « Reprendre »                                            */
/* ------------------------------------------------------------------ */

// La liste est tenue par le processus principal ; la copie locale est mise à jour tout de suite pour l'affichage.
function getRecent() { return S.usage.recent; }
function addRecent(it) {
  const keep = ['path', 'name', 'kind', 'ext', 'cover', 'fanart', 'native', 'folder', 'dir', 'remote'];
  const entry = Object.fromEntries(keep.map((k) => [k, it[k] ?? null]));
  S.usage.recent = [entry, ...getRecent().filter((x) => x.path !== it.path)].slice(0, 18);
  api.usageAddRecent(entry);
}
function removeRecent(p) {
  S.usage.recent = getRecent().filter((x) => x.path !== p);
  api.usageRemoveRecent(p);
}

// Données d'usage laissées dans le localStorage par une version précédente : envoyées une seule fois au processus
// principal, puis retirées. En cas d'échec, elles restent pour le lancement suivant.
async function migrateLocalUsage() {
  let legacy;
  try {
    const keys = Object.keys(localStorage);
    if (!keys.some((k) => ['recent', 'queries', 'volume'].includes(k) || k.startsWith('resume:'))) return null;
    const json = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const resume = Object.fromEntries(keys.filter((k) => k.startsWith('resume:')).map((k) => [k.slice(7), localStorage.getItem(k)]));
    legacy = { recent: json('recent'), queries: json('queries'), volume: localStorage.getItem('volume'), resume };
  } catch { return null; }
  const r = await api.usageMigrate(legacy);
  if (!r || r.ok === false) return null;
  try {
    for (const k of Object.keys(localStorage)) if (['recent', 'queries', 'volume'].includes(k) || k.startsWith('resume:')) localStorage.removeItem(k);
  } catch { /* rien */ }
  return r;
}

async function loadUsage() {
  const r = (await migrateLocalUsage()) || (await api.usageGet());
  if (r && r.ok !== false) S.usage = { recent: r.recent || [], volume: r.volume ?? 0.9, queries: r.queries || [] };
}

/* ------------------------------------------------------------------ */
/* Navigation entre sections                                           */
/* ------------------------------------------------------------------ */

// Focus demandé au contenu par go() avant qu'il soit chargé (accueil, télévision) : donné une fois le contenu rendu,
// sauf si le focus a été placé ailleurs entre-temps (pendingFocusDue).
let pendingFocusFrom = null;
function takePendingFocus() {
  const a = document.activeElement;
  const due = pendingFocusDue(S.pendingFocus, pendingFocusFrom, a, document.body, !!a?.isConnected);
  S.pendingFocus = false;
  pendingFocusFrom = null;
  return due;
}

function go(section, { focus = 'keep' } = {}) {
  const changed = section !== S.section;
  if (changed && S.section === 'web') api.webHide();
  if (changed) {
    S.genre = '';
    S.focusRef = null;
    hideBackdrop();
    S.limit = PAGE;
    S.query = '';
    searchEl.value = '';
    S.romsOf = null;
    S.draft = null;
  }
  if (changed && section !== EXPLORER_VIEW) rescue.leave();
  S.section = section;
  document.body.dataset.section = section;
  shell.setSection(section, webHome());
  renderRailSessions();
  render({ resetScroll: changed });
  updateScrapeButton();
  if (section === SEARCH_VIEW) {
    search.focusField();
    // Les chaînes entrent au catalogue quand leur liste est lue : comme l'ancienne recherche, on la lit en arrière-plan.
    if (!S.channels && !S.tvLoading && !S.tvError) loadChannels();
  }
  // Le contenu de la Recherche est son champ (ci-dessus).
  if (focus === 'content' && section === EXPLORER_VIEW) explorer.focusFirst();
  else if (focus === 'content' && section !== SEARCH_VIEW) {
    focusFirst();
    // Vue encore en chargement (télé) : le focus ira au contenu dès qu'il arrive.
    // L'accueil rend ses rangées après avoir lu le catalogue : le focus ira à la première barre une fois rendues.
    S.pendingFocus = section === HOME_VIEW || !viewEl.contains(document.activeElement);
    pendingFocusFrom = document.activeElement;
  }
  if (section === 'tv' && !S.channels && !S.tvLoading) loadChannels();
}

// Page de démonstration de l'interface (P4-01), cachée : ouverte par l'adresse #demo (voir demo/index.ts).
async function openDemoFromHash() {
  if (!isDemoHash(location.hash)) return;
  await loadDemoTexts();
  go(DEMO_SECTION, { focus: 'content' });
}
addEventListener('hashchange', openDemoFromHash);

function back() {
  if (S.section === 'games' && S.romsOf != null) { closeRoms(); return; }
  if (S.section === PAGE_VIEW && pages.back()) return;
  if (S.section === EXPLORER_VIEW && explorer.back()) return;
  if (S.section === 'web') { openWebHome(webHome()); return; }
  if (S.section !== HOME_VIEW) go(HOME_VIEW, { focus: 'content' });
}

// Outils placés dans l'en-tête, à gauche de la recherche : filtres et actions propres à la section.
// Un menu de l'en-tête : une icône qui ouvre une liste de choix (filtre, tri…).
function hdrMenu(icon, label, action, items, cur, on) {
  return `<div class="hdr-menu">
    <button class="icon-btn hdr-icon focusable${on ? ' on' : ''}" data-menu="${action}" aria-label="${esc(label)}" title="${esc(label)}" aria-haspopup="true" aria-expanded="false">${icon}</button>
    <div class="hdr-pop" role="menu" hidden>${items.map(([v, l]) => `<button class="hdr-opt focusable${v === cur ? ' sel' : ''}" role="menuitemradio" aria-checked="${v === cur}" data-action="${action}" data-id="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`;
}

// Genres présents dans une liste d'éléments, pour un menu de filtre.
function genrePool(items) {
  const counts = new Map();
  for (const it of items) for (const g of genresOf(it)) counts.set(g, (counts.get(g) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([g]) => g);
  if (S.genre && !counts.has(S.genre)) top.push(S.genre);
  return top;
}

function headerTools(sec) {
  if (sec === 'tv') {
    const { services, active } = S.config.tv;
    if (services.length < 2) return '';
    return `<select class="hdr-select focusable" id="tv-service" aria-label="Service de télévision">
      ${services.map((t) => `<option value="${esc(t.id)}"${t.id === active ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  }
  // Source de recherche : restreint la recherche de l'en-tête à une source (dossiers, un serveur, le streaming…).
  const sources = searchSourcesFor(sec);
  if (sources.length > 1) {
    const cur = S.searchSource[sec] || '';
    return `<select class="hdr-select focusable" data-search-source="${sec}" aria-label="Source de recherche" title="Chercher dans une source précise">
      <option value=""${!cur ? ' selected' : ''}>Toutes les sources</option>
      ${sources.map((x) => `<option value="${esc(x)}"${cur === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  }
  return '';
}

// Sources disponibles pour la recherche d'une section.
function searchSourcesFor(sec) {
  if (sec === 'videos') return D.sourcesOf(S.videos.map(withScrape));
  if (sec === 'music') return D.sourcesOf(S.tracks.map(withScrape));
  if (sec === 'images') return D.sourcesOf(S.images.map(withScrape));
  if (sec === 'games' && S.romsOf == null) return D.sourcesOf(allLocalGames());
  return [];
}

// Outils placés à droite de la recherche, juste avant le rouage : filtres (icône → menu), tri, téléchargement.
function headerToolsRight(sec) {
  const parts = [];
  const genreMenu = (items) => {
    const genres = genrePool(items);
    if (genres.length) parts.push(hdrMenu(ICON.filter, 'Filtrer par genre', 'genre', [['', 'Tous les genres'], ...genres.map((g) => [g, g])], S.genre, !!S.genre));
  };

  if (sec === 'videos') {
    if (S.videoSeries != null) return ''; // dans une série : pas de filtres globaux
    const vids = filterQ(D.bySource(S.videos.map(withScrape), S.videoSource), () => true);
    genreMenu(vids);
    const sources = D.sourcesOf(S.videos.map(withScrape));
    if (sources.length > 1) parts.push(hdrMenu(ICON.source, 'Filtrer par source', 'video-source', [['', 'Toutes les sources'], ...sources.map((x) => [x, x])], S.videoSource, !!S.videoSource));
    parts.push(hdrMenu(ICON.sort, 'Trier', 'video-sort', [['title', 'Titre (A→Z)'], ['year', 'Année (récent)'], ['source', 'Source']], S.videoSort, S.videoSort !== 'title'));
    return parts.join('');
  }
  if (sec === 'music') { genreMenu(S.tracks.map(withScrape)); return parts.join(''); }
  if (sec === 'images') { genreMenu(S.images.map(withScrape)); return parts.join(''); }
  if (sec === 'games') {
    const inConsole = S.romsOf != null;
    // Filtre par système (liste unifiée seulement).
    if (!inConsole) {
      const systems = D.gameSystems(allLocalGames(), S.config.emulators);
      if (systems.length > 1) parts.push(hdrMenu(ICON.layers, 'Filtrer par système', 'game-system', [['', 'Tous les systèmes'], ...systems.map((sy) => [sy.key, `${sy.name} (${sy.count})`])], S.gameSystem, !!S.gameSystem));
    }
    // Filtre par genre.
    genreMenu(inConsole ? (S.roms || []).map((r) => withScrape({ ...r, kind: 'rom' })) : allLocalGames());
    // Téléchargement : console ouverte, système filtré, sinon jeux PC.
    let target = 'pc';
    if (inConsole) target = S.romsOf;
    else if (S.gameSystem && S.gameSystem.startsWith('emu:')) target = S.gameSystem.slice(4);
    parts.push(`<button class="icon-btn hdr-icon focusable" data-action="games-download" data-id="${esc(target)}" aria-label="Télécharger des jeux" title="Télécharger des jeux">${ICON.download}</button>`);
    return parts.join('');
  }
  return '';
}

function render({ resetScroll = false } = {}) {
  const active = document.activeElement;
  const hadFocus = viewEl.contains(active);
  const selector = hadFocus ? focusSelectorOf(active) : null;

  const sec = S.section;
  document.body.dataset.accent = sec === PAGE_VIEW ? (legacySectionOf(shell.router.current().target) ?? '') : sec;
  const title = sec === 'games' && S.romsOf != null ? consoleOf(S.romsOf)?.name : sec === DEMO_SECTION ? demoTitle() : sec === PAGE_VIEW ? pages.title() : undefined;
  shell.setHeader({ view: sec, title, searchable: SEARCHABLE.has(sec), search: sec === 'tv' ? 'channel' : 'section' });
  headerToolsEl.innerHTML = headerTools(sec);
  headerToolsRightEl.innerHTML = headerToolsRight(sec);

  const views = { videos: viewVideos, music: viewMusic, images: viewImages, streaming: viewStreaming, tv: viewTv, games: viewGames, [DEMO_SECTION]: viewDemo };
  // La vue de page garde son contenu (composants, tranches chargées) : son hôte est replacé, jamais réécrit.
  // De même pour l'accueil (P4-12), dont les rangées sont relues à chaque affichage, la Recherche (P4-13), le Centre
  // (P4-18), l'explorateur (P4-08) et les Réglages (P4-20).
  const hosted = sec === 'web' ? web.host : sec === PAGE_VIEW ? pages.host : sec === HOME_VIEW ? home.host : sec === SEARCH_VIEW ? search.host : sec === CENTRE_VIEW ? centre.host : sec === EXPLORER_VIEW ? explorer.host : sec === SETTINGS_VIEW ? settings.host : null;
  // L'explorateur a au-dessus de lui le bandeau du mode secours (P4-10), vide hors du mode secours.
  const hostedAll = sec === EXPLORER_VIEW ? [rescue.host, hosted] : [hosted];
  if (hosted) { if (viewEl.childElementCount !== hostedAll.length || hostedAll.some((el, i) => viewEl.children[i] !== el)) viewEl.replaceChildren(...hostedAll); }
  else viewEl.innerHTML = views[sec]();
  if (sec === HOME_VIEW) home.refresh();
  if (sec === SEARCH_VIEW) search.refresh();
  if (sec === CENTRE_VIEW) centre.refresh();
  if (sec === EXPLORER_VIEW) explorer.refresh();
  if (sec === SETTINGS_VIEW) settings.refresh({ plugins: true });
  if (resetScroll) viewEl.scrollTop = 0;

  if (hadFocus) {
    const again = selector && viewEl.querySelector(selector);
    if (again) again.focus({ preventScroll: true });
    else focusFirst();
  }
  if (sec === 'home') tick();
  if (sec === 'music') markPlaying();
  if (sec === SETTINGS_VIEW) { fillDrmStatus(); fillAdblock(); }
  if (sec === 'web') {
    web.set(S.webActive, S.webStates[S.webActive] ?? null);
    requestAnimationFrame(() => {
      syncWeb(S.webFocusOnShow);
      S.webFocusOnShow = false;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Briques d'affichage                                                 */
/* ------------------------------------------------------------------ */

const byGenre = (items) => (S.genre ? items.filter((it) => genresOf(it).includes(S.genre)) : items);

function art(it, ratio, extra = '') {
  const label = labelOf(it);
  const src = it.kind === 'image' ? (it.native ? it.path : null) : (it.uImage || it.cover || it.image || it.sImage || null);
  return `<span class="art ${ratio} ${extra}"><span class="art-fallback" style="--mono:var(--bar-${barFor(it.dir || label)})" aria-hidden="true">${esc(monogram(label))}</span>${src ? `<img loading="lazy" decoding="async" alt="" src="${esc(mediaUrl(src))}">` : ''}</span>`;
}

function tile(it, i, action, ratio, { sub = '', noText = false } = {}) {
  const label = labelOf(it);
  const text = noText ? '' : `<span class="tile-t">${esc(label)}</span>${sub ? `<span class="tile-s">${esc(sub)}</span>` : ''}`;
  return `<button class="tile focusable" data-action="${action}" data-index="${i}"${noText ? ` aria-label="${esc(label)}" title="${esc(label)}"` : ''}>${art(it, ratio)}${text}</button>`;
}

function moreButton(total) {
  const rest = total - S.limit;
  if (rest <= 0) return '';
  return `<div class="more-wrap"><button class="btn focusable" data-action="more">Afficher ${Math.min(rest, PAGE)} de plus</button><span class="more-n">${plural(rest, 'élément restant', 'éléments restants')}</span></div>`;
}

function gridGrouped(items, tileFn, gridClass, unit) {
  const grouped = !S.query;
  const counts = new Map();
  if (grouped) for (const it of items) counts.set(it.dir, (counts.get(it.dir) || 0) + 1);
  let html = `<div class="grid ${gridClass}">`;
  let last = null;
  items.slice(0, S.limit).forEach((it, i) => {
    if (grouped && it.dir !== last) {
      last = it.dir;
      const f = folderLabel(it);
      html += `<h2 class="group-h">${esc(f.title)}${f.sub ? `<span class="group-sub">${esc(f.sub)}</span>` : ''}<span class="group-n">${plural(counts.get(it.dir), ...unit)}</span></h2>`;
    }
    html += tileFn(it, i, grouped);
  });
  return `${html}</div>${moreButton(items.length)}`;
}

function loading(text) {
  return `<div class="loading"><span class="loader bars7" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>${esc(text)}</div>`;
}

function emptyBlock(title, text, actions = '') {
  return `<div class="empty">${title ? `<h2>${esc(title)}</h2>` : ''}<p>${esc(text)}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}

const KIND_WORDS = { video: ['vidéos', 'Vos vidéos'], audio: ['musiques', 'Votre musique'], image: ['images', 'Vos images'] };
const hasSources = (kind) => S.config.library.sources.some((x) => x.kind === kind);

function libraryGate(kind) {
  // Un marque-page de streaming compte comme contenu vidéo, même sans dossier de vidéos configuré.
  if (kind === 'video' && (S.config.bookmarks || []).length) {
    if (!S.scanned) return loading('Analyse de la bibliothèque…');
    return null;
  }
  if (!hasSources(kind)) {
    return emptyBlock(
      `Aucune source de ${KIND_WORDS[kind][0]}`,
      'Ajoutez un dossier de votre disque, un partage réseau (\\\\NAS\\Films, smb://nas/films) ou l’adresse d’un serveur web. Vous pouvez en ajouter autant que vous voulez.',
      `<button class="btn btn-primary focusable" data-action="src-add-folder" data-kind="${kind}">Ajouter un dossier</button><button class="btn focusable" data-action="src-add-url" data-kind="${kind}">Ajouter une adresse</button><button class="btn btn-ghost focusable" data-action="open-file">Ouvrir un fichier</button>`,
    );
  }
  if (!S.scanned) return loading('Analyse de la bibliothèque…');
  return null;
}

function noResults(kindEmptyText) {
  if (S.query) return emptyBlock('', `Aucun résultat pour « ${S.query} ».`);
  return emptyBlock('', kindEmptyText, '<button class="btn focusable" data-action="manage-sources">Gérer les sources</button><button class="btn btn-ghost focusable" data-action="rescan">Analyser à nouveau</button>');
}

/* ------------------------------------------------------------------ */
/* Vues                                                                */
/* ------------------------------------------------------------------ */

function viewVideos() {
  const gate = libraryGate('video');
  if (gate) return gate;
  const vids = S.videos.map(withScrape);

  // Arborescence : série → saison → épisodes. On descend avec S.videoSeries puis S.videoSeason.
  if (S.videoSeries != null) {
    const eps = D.episodesOfSeries(vids, S.videoSeries);
    if (!eps.length) { S.videoSeries = null; S.videoSeason = null; }
    else return viewSeries(eps);
  }

  const items = D.sortVideos(byGenre(filterQ(bySearchSource('videos', D.bySource(vids, S.videoSource)), (v) => `${v.name} ${v.sTitle || ''} ${v.sSeries || ''} ${folderText(v)} ${v.sGenre}`)), S.videoSort);
  S.list = items;
  if (!items.length) return S.query ? noResults('Aucune vidéo.') : noResults('Aucune vidéo trouvée dans vos sources.');

  // Les épisodes d'une même série sont réunis en une seule tuile « série ».
  const cards = D.videoCards(items);
  S.videoCards = cards;
  const first = cards[0] ? (cards[0].series ? { kind: 'series', item: cards[0].item, count: cards[0].count } : { kind: 'video', item: cards[0].item }) : null;
  const tiles = cards.slice(0, S.limit).map((c, i) => c.series
    ? seriesTile(c, i)
    : tile(c.item, i, 'play-video', 'r-poster', { sub: [c.item.sYear, genresOf(c.item)[0]].filter(Boolean).join(', ') })).join('');
  return `<div class="focus-info" id="focus-info">${first ? focusInfoHtml(first) : ''}</div>
    <div class="grid grid-poster">${tiles}</div>${moreButton(cards.length)}`;
}

// Tuile d'une série : affiche de la série et nombre d'épisodes.
function seriesTile(c, i) {
  const it = c.item;
  const img = it.uImage || it.sImage || it.cover;
  const art = img ? `<img class="art-img" loading="lazy" src="${esc(mediaUrl(img))}" alt="">` : `<span class="art-mono">${esc(monogram(it.sSeries || it.seriesTitle || it.name))}</span>`;
  return `<button class="tile focusable" data-action="open-series" data-index="${i}">
    <span class="art r-poster">${art}<span class="tile-badge">${plural(c.count, 'épisode')}</span></span>
    <span class="tile-t">${esc(it.sSeries || it.seriesTitle || it.name)}</span><span class="tile-s">Série${it.sYear ? `, ${esc(it.sYear)}` : ''}</span></button>`;
}

// Vue d'une série : ses saisons, ou les épisodes d'une saison.
function viewSeries(eps) {
  const title = eps[0].sSeries || eps[0].seriesTitle || 'Série';
  const back = `<div class="btn-row back"><button class="btn btn-ghost focusable" data-action="back-videos">Retour aux vidéos</button></div>`;
  const seasons = D.seasonsOf(eps);

  if (S.videoSeason == null && seasons.length > 1) {
    // Plusieurs saisons : on les liste.
    const tiles = seasons.map((sn, i) => {
      const n = D.episodesOfSeason(eps, sn).length;
      return `<button class="tile focusable" data-action="open-season" data-index="${i}" data-season="${sn}">
        <span class="art r-poster"><span class="art-mono">${sn ? 'S' + sn : '?'}</span><span class="tile-badge">${plural(n, 'épisode')}</span></span>
        <span class="tile-t">${sn ? 'Saison ' + sn : 'Épisodes'}</span></button>`;
    }).join('');
    return `${back}<section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'series', item: eps[0], count: eps.length })}</section>
      <h2 class="sec-h">${esc(title)} <span class="count">${plural(seasons.length, 'saison')}</span></h2>
      <div class="grid grid-poster">${tiles}</div>`;
  }

  // Une seule saison, ou saison choisie : les épisodes.
  const season = S.videoSeason != null ? S.videoSeason : seasons[0];
  const list = D.episodesOfSeason(eps, season);
  S.list = list;
  const seasonBack = seasons.length > 1 ? `<button class="btn btn-ghost focusable" data-action="back-season">Retour aux saisons</button>` : '';
  const tiles = list.map((e, i) => tile(e, i, 'play-video', 'r-poster', { sub: [e.episode ? `Épisode ${e.episode}` : '', genresOf(e)[0]].filter(Boolean).join(', ') })).join('');
  return `<div class="btn-row back"><button class="btn btn-ghost focusable" data-action="back-videos">Retour aux vidéos</button>${seasonBack}</div>
    <section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'series', item: eps[0], count: eps.length })}</section>
    <h2 class="sec-h">${esc(title)}${season ? ` — Saison ${season}` : ''} <span class="count">${plural(list.length, 'épisode')}</span></h2>
    <div class="grid grid-poster">${tiles}</div>`;
}

// Restreint une liste à la source de recherche choisie pour la section.
const bySearchSource = (sec, items) => D.bySource(items, S.searchSource[sec]);

// Panneau d'infos de l'élément sélectionné (Vidéos, Images, Jeux).
function remoteRomButton(ref) {
  if (ref?.kind !== 'rom' || !ref.item?.remote) return '';
  return `<button class="btn btn-sm focusable" data-action="rom-dl" data-path="${esc(ref.item.path)}">Télécharger sur cet ordinateur</button>`;
}

// Bouton Supprimer pour un jeu présent sur l'ordinateur (jeu PC manuel ou fichier de console local).
function deleteRomButton(ref) {
  const it = ref?.item;
  if (!it) return '';
  if (ref.kind === 'rom' && it.remote) return '';
  if (ref.kind === 'game' && it.auto) return ''; // trouvé dans un dossier : se retire via le dossier
  const payload = { kind: ref.kind, path: it.path, label: labelOf(it), manualIndex: it.manualIndex, consoleId: it.consoleId != null ? it.consoleId : (ref.kind === 'rom' ? S.romsOf : undefined) };
  return `<button class="btn btn-ghost btn-sm focusable danger" data-action="game-delete" data-ref="${esc(JSON.stringify(payload))}">Supprimer</button>`;
}

function focusInfoHtml(ref) {
  if (ref?.kind === 'console') {
    const e = consoleOf(ref.consoleId);
    if (!e) return '';
    const n = ref.count != null ? ref.count : (S.romsCache[ref.consoleId] || []).length;
    const line = [e.system, n ? plural(n, 'jeu', 'jeux') : ''].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(e.name)}</h2><p class="fi-line">${esc(line)}</p></div>
      <button class="btn btn-ghost btn-sm focusable" data-action="edit-console" data-console="${esc(ref.consoleId)}">Modifier la console</button>`;
  }
  if (ref?.kind === 'gamebm') {
    const it = ref.item;
    const line = ['En attente de téléchargement', it.sYear, it.systemName].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(it.sTitle || it.name)}</h2><p class="fi-line">${esc(line)}</p>${it.sOverview ? `<p class="fi-overview">${esc(it.sOverview)}</p>` : ''}</div>
      <div class="fi-actions"><button class="btn btn-primary btn-sm focusable" data-action="gamebm-download" data-id="${esc(it.bookmarkId)}">Télécharger</button><button class="btn btn-ghost btn-sm focusable danger" data-action="gamebm-remove" data-id="${esc(it.bookmarkId)}">Retirer</button></div>`;
  }
  if (ref?.kind === 'series') {
    const it = ref.item;
    const title = it.sSeries || it.seriesTitle || it.name;
    const img = it.uImage || it.sImage || it.cover;
    const line = ['Série', it.sYear, it.sGenre, ref.count ? plural(ref.count, 'épisode') : ''].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(title)}</h2><p class="fi-line">${esc(line)}</p>${it.sOverview ? `<p class="fi-overview">${esc(it.sOverview)}</p>` : ''}</div>
      <div class="fi-actions"><button class="btn btn-ghost btn-sm focusable" data-action="edit-focused">Modifier</button></div>`;
  }
  const it = ref?.item;
  if (!it) return '';
  const title = labelOf(it);
  const emuName = ref.kind === 'rom' ? (consoleOf(it.consoleId != null ? it.consoleId : S.romsOf)?.name || '') : '';
  const place = ref.kind === 'rom' ? `${emuName}${it.remote ? ', disponible en ligne' : ''}` : ref.kind === 'game' ? (it.auto ? 'Jeu PC trouvé dans vos dossiers' : 'Jeu PC') : folderText(it);
  const line = [it.sYear, it.sGenre, place].filter(Boolean).join(', ');
  let overview = it.sOverview;
  if (!overview && ref.kind === 'video') overview = S.config.search.tmdbToken ? 'Pas encore d’infos pour cette vidéo. Le rouage en haut à droite permet de les récupérer en ligne.' : 'Ajoutez une clé TMDB (rouage en haut à droite, ou Réglages) pour récupérer les affiches, genres et résumés.';
  return `<div class="fi-text"><h2 class="fi-title">${esc(title)}</h2><p class="fi-line">${esc(line)}</p>${overview ? `<p class="fi-overview">${esc(overview)}</p>` : ''}</div>
    <div class="fi-actions">${remoteRomButton(ref)}<button class="btn btn-ghost btn-sm focusable" data-action="edit-focused">Modifier</button>${deleteRomButton(ref)}</div>`;
}
function updateFocusInfo(el) {
  const box = $('#focus-info');
  const ref = el && refFromEl(el);
  if (!box || !ref || (!ref.item && ref.kind !== 'console')) return;
  const k = ref.kind === 'console' ? `c:${ref.consoleId}` : metaKey(ref.item, ref.kind);
  if (box.dataset.key !== k) { box.dataset.key = k; box.innerHTML = focusInfoHtml(ref); S.focusRef = ref; }
}

// Retrouve l'élément (vidéo, morceau, jeu…) représenté par une vignette ou une ligne.
function refFromEl(el) {
  const t = el?.closest?.('[data-action]');
  if (!t) return null;
  const i = Number(t.dataset.index);
  switch (t.dataset.action) {
    case 'play-video': return { kind: 'video', item: S.list[i] };
    case 'open-series': { const c = S.videoCards[i]; return c ? { kind: 'series', item: c.item, count: c.count } : null; }
    case 'play-track': return { kind: 'track', item: S.list[i] };
    case 'play-album': return { kind: 'album', item: S.list[i] };
    case 'show-image': return { kind: 'image', item: S.list[i] };
    case 'launch-rom': return { kind: 'rom', item: S.list[i], emu: S.romsOf };
    case 'launch-rom-u': { const it = S.list[i]; return it ? { kind: 'rom', item: it, emu: it.consoleId } : null; }
    case 'launch-game': return { kind: 'game', item: S.gameList[i] };
    case 'gamebm': { const it = S.gameList[i]; return it ? { kind: 'gamebm', item: it } : null; }
    case 'open-emu': return { kind: 'console', consoleId: t.dataset.console };
    case 'play-recent': {
      const it = S.recent[i];
      return it ? { kind: it.kind === 'audio' ? 'track' : it.kind, item: it } : null;
    }
    default: return null;
  }
}

function viewMusic() {
  const gate = libraryGate('audio');
  if (gate) return gate;
  const all = filterQ(bySearchSource('music', S.tracks.map(withScrape)), (t) => `${t.name} ${t.sTitle || ''} ${folderText(t)} ${t.sGenre} ${t.sArtist}`);
  const items = byGenre(all);
  S.list = items;
  if (!all.length) return noResults('Aucune musique trouvée dans vos sources.');
  if (!items.length) return emptyBlock('', 'Aucun morceau de ce genre.');

  const grouped = !S.query;
  const shown = items.slice(0, S.limit);
  let html = '';
  if (grouped) {
    const counts = new Map();
    for (const t of items) counts.set(t.dir, (counts.get(t.dir) || 0) + 1);
    let last = null;
    let n = 0;
    shown.forEach((t, i) => {
      if (t.dir !== last) {
        if (last !== null) html += '</div>';
        last = t.dir;
        n = 0;
        const m = splitAlbumFolder(t.folder);
        const sc = S.scrape[`a:${t.dir}`] || {};
        const um = S.meta[`a:${t.dir}`] || {};
        const albumName = um.title || (m ? m.album : (sc.title || folderLabel(t).title));
        const artist = um.artist || (m ? m.artist : (sc.artist || folderLabel(t).sub));
        const details = [artist, um.year || sc.year, um.genre || sc.genre, plural(counts.get(t.dir), 'morceau', 'morceaux')].filter(Boolean).join(', ');
        html += `<div class="album">
          ${art({ ...t, kind: 'audio', name: albumName, sImage: sc.image || null, uImage: um.image || null }, 'album-cover')}
          <div><h2 class="album-name">${esc(albumName)}</h2><p class="album-n">${esc(details)}</p></div>
          <div class="album-actions"><button class="btn focusable" data-action="play-album" data-index="${i}">Lire l’album</button><button class="btn btn-ghost focusable" data-action="edit-album" data-index="${i}">Modifier</button></div>
        </div><div class="tracks">`;
      }
      n += 1;
      html += `<button class="track focusable" data-action="play-track" data-index="${i}"><span class="tk-n">${n}</span><span class="tk-t">${esc(labelOf(t))}</span><span class="tk-e">${esc(t.remote ? 'web' : t.ext.slice(1))}</span></button>`;
    });
    html += '</div>';
  } else {
    html = `<div class="tracks">${shown.map((t, i) => `<button class="track flat focusable" data-action="play-track" data-index="${i}"><span class="tk-t">${esc(labelOf(t))}</span><span class="tk-f">${esc(folderText(t))}</span><span class="tk-e">${esc(t.remote ? 'web' : t.ext.slice(1))}</span></button>`).join('')}</div>`;
  }
  return html + moreButton(items.length);
}

function viewImages() {
  const gate = libraryGate('image');
  if (gate) return gate;
  const all = filterQ(bySearchSource('images', S.images.map(withScrape)), (v) => `${v.name} ${v.sTitle || ''} ${v.folder} ${v.sGenre}`);
  const items = byGenre(all);
  S.list = items;
  if (!all.length) return noResults('Aucune image trouvée dans vos sources.');
  return `<div class="focus-info" id="focus-info">${focusInfoHtml({ kind: 'image', item: items[0] })}</div>`
    + (items.length ? gridGrouped(items, (it, i) => tile(it, i, 'show-image', 'r-square', { noText: true }), 'grid-square', ['image']) : emptyBlock('', 'Aucune image de ce genre.'));
}

function viewStreaming() {
  const web = S.config.web;
  if (!web.length) {
    return emptyBlock('Aucun service', 'Ajoutez des sites dans Réglages, section « Sites, jeux et consoles ».', '<button class="btn focusable" data-action="go" data-go="settings">Ouvrir les réglages</button>');
  }
  const open = new Set(S.webSessions.map((x) => x.id));
  const svcTile = (w) => {
    const color = safeColor(w.color);
    const how = open.has(w.id) ? 'Ouvert, reprendre où vous en étiez' : w.mode === 'browser' ? 'S’ouvre dans le navigateur' : 'S’ouvre dans Mire';
    return `<button class="svc focusable${open.has(w.id) ? ' is-open' : ''}" data-action="open-web" data-id="${esc(w.id)}" style="--brand:${color};--on:${onColor(color)}"><span class="svc-name">${esc(w.name)}</span><span class="svc-how">${how}</span></button>`;
  };
  const groups = [
    ['Films et séries', web.filter((w) => w.group === 'video')],
    ['Musique', web.filter((w) => w.group === 'music')],
    ['Autres sites', web.filter((w) => w.group !== 'video' && w.group !== 'music')],
  ].filter(([, list]) => list.length);
  const body = groups.map(([title, list]) => `<h2 class="sec-h">${title}</h2><div class="svc-grid">${list.map(svcTile).join('')}</div>`).join('');
  return `${body}
  <p class="hint">Les sites s’ouvrent dans Mire et gardent vos connexions d’une fois sur l’autre. En haut de la page : retour, rechargement, plein écran et fermeture. Au clavier : <kbd>F11</kbd> plein écran, <kbd>F9</kbd> revenir aux menus de Mire, <kbd>Alt</kbd>+<kbd>←</kbd> page précédente, <kbd>Ctrl</kbd>+<kbd>W</kbd> fermer le site.</p>`;
}

function viewTv() {
  const active = S.config.tv.services.find((t) => t.id === S.config.tv.active);
  if (!S.config.tv.active) {
    return emptyBlock('Choisissez votre service de télévision', 'Mire n’a pas reconnu votre box automatiquement. Choisissez votre fournisseur ci-dessus (ou dans le rouage de la page).', '<button class="btn focusable" data-action="tv-detect">Détecter ma box</button>');
  }
  // Service par portail web (SFR, Bouygues, Molotov…) : on l'ouvre dans la vue intégrée.
  if (active?.kind === 'web' && S.tvWeb) return emptyBlock(active.name, 'Ce service s’ouvre dans la vue intégrée de Mire.', `<button class="btn btn-primary focusable" data-action="tv-open-web">Ouvrir ${esc(active.name)}</button>`);
  if (S.tvLoading || (!S.channels && !S.tvError)) return loading('Chargement des chaînes…');
  if (S.tvError) {
    return emptyBlock('Télévision indisponible', S.tvError,
      '<button class="btn btn-primary focusable" data-action="tv-reload">Réessayer</button>');
  }
  const items = filterQ(S.channels, (c) => `${c.number ?? ''} ${c.name} ${c.group}`);
  S.list = items;
  if (!items.length) return emptyBlock('', `Aucune chaîne ne correspond à « ${S.query} ».`);
  const tiles = items.slice(0, S.limit).map((c, i) => {
    const variants = c.variants.map((v) => v.label).filter(Boolean).join(', ');
    const lead = c.number != null ? `<span class="ch-num">${c.number}</span>` : c.logo ? `<img class="ch-logo" alt="" src="${esc(c.logo)}">` : '';
    return `<button class="ch focusable" data-action="play-channel" data-index="${i}">${lead}<span class="ch-txt"><span class="ch-name">${esc(c.name)}</span>${variants ? `<span class="ch-var">${esc(variants)}</span>` : ''}</span></button>`;
  }).join('');
  return `<div class="ch-grid">${tiles}</div>${moreButton(items.length)}
  <p class="hint">Les chaînes s’ouvrent dans le lecteur externe (mpv ou VLC). Certaines chaînes ne sont diffusées que sur le décodeur et ne se lancent pas sur ordinateur.</p>`;
}

function viewGames() {
  if (S.romsOf != null) return viewRoms();
  const c = S.config;
  // Une seule liste : jeux PC + jeux de console présents sur l'ordinateur. Filtrable par système.
  const all = allLocalGames();
  const bySystem = S.gameSystem ? all.filter((g) => g.systemKey === S.gameSystem) : all;
  const shown = filterQ(bySearchSource('games', bySystem), (g) => `${g.name} ${g.displayName || ''} ${g.sTitle || ''} ${g.sGenre}`);
  const list = byGenre(shown);
  S.gameList = list;
  S.list = list;
  const first = list[0] ? refOfGame(list[0], 0) : null;

  const tiles = list.slice(0, S.limit).map((g, i) => {
    if (g.kind === 'gamebm') return gameBmTile(g, i);
    return tile(g, i, g.kind === 'rom' ? 'launch-rom-u' : 'launch-game', 'r-game', { sub: gameSub(g) });
  }).join('');
  const grid = tiles ? `<div class="grid grid-game">${tiles}</div>` : emptyBlock('', `Aucun jeu ne correspond à « ${S.query} ».`);

  const emptyAll = !all.length;
  const hint = emptyAll
    ? emptyBlock('Aucun jeu pour l’instant', 'Ajoutez un jeu PC, un dossier de jeux PC ou une console (avec ses jeux) dans les réglages de cette page (rouage en haut à droite). Les consoles ouvrent aussi « Ajouter des jeux » pour en télécharger.', '<button class="btn btn-primary focusable" data-action="open-store">Ouvrir les apps du Centre</button>')
    : '';

  return `<section class="games-hero" id="focus-info">${first ? focusInfoHtml(first) : ''}</section>
    ${emptyAll ? hint : grid}
    ${emptyAll ? '' : moreButton(list.length)}`;
}

// Jeux de console présents sur l'ordinateur, pour la liste unifiée. Chargé en tâche de fond.
async function loadLocalRoms() {
  for (const { id } of S.config.emulators) {
    try { const r = await api.listRoms(id); if (r?.ok) S.localRoms[id] = r.roms; } catch { /* console ignorée */ }
  }
  if (S.section === 'games' && S.romsOf == null) render();
}

function gameBmTile(g, i) {
  const img = g.uImage || g.sImage;
  const art = img ? `<img class="art-img" loading="lazy" src="${esc(mediaUrl(img))}" alt="">` : `<span class="art-mono">${esc(monogram(g.sTitle || g.name))}</span>`;
  return `<button class="tile focusable" data-action="gamebm" data-index="${i}" title="En attente de téléchargement — appuyez pour télécharger">
    <span class="art r-game">${art}<span class="tile-badge dl">${ICON.download} À télécharger</span></span>
    <span class="tile-t">${esc(g.sTitle || g.name)}</span><span class="tile-s">${esc([g.sYear, g.systemName].filter(Boolean).join(', '))}</span></button>`;
}

// Console désignée par son identifiant (P1-07 : plus jamais par sa position dans la liste).
function consoleOf(id) {
  return id == null ? null : S.config.emulators.find((e) => e.id === id) || null;
}

const gameSub = (g) => (g.kind === 'rom' ? [g.sYear, g.systemName].filter(Boolean).join(', ') : [g.sYear, genresOf(g)[0]].filter(Boolean).join(', '));
const refOfGame = (g, i) => (g.kind === 'rom' ? { kind: 'rom', item: g, emu: g.consoleId } : g.kind === 'gamebm' ? { kind: 'gamebm', item: g } : { kind: 'game', item: g });

function viewRoms() {
  const emu = consoleOf(S.romsOf);
  const sites = S.romSites[S.romsOf] || [];
  const cid = esc(S.romsOf);
  const locations = emu ? [emu.romsDir, ...(emu.sources || [])].filter(Boolean) : [];
  const remoteLocs = locations.filter((l) => /^https?:\/\//i.test(l));
  const backBtn = `<div class="btn-row back">
    <button class="btn btn-ghost focusable" data-action="back-games">Retour aux jeux</button>
    <button class="btn btn-ghost focusable" data-action="edit-console" data-console="${cid}">Modifier la console</button>
    <button class="btn btn-primary focusable" data-action="rom-sites" data-console="${cid}">Ajouter des jeux</button></div>`;
  const siteSearch = S.query && sites.length ? `<div class="site-search"><span>Chercher « ${esc(S.query)} » sur</span>${sites.map((x, n) => `<button class="btn btn-sm focusable" data-action="rom-site-search" data-console="${cid}" data-id="${n}">${esc(x.name)}</button>`).join('')}</div>` : '';
  if (S.romsError) return backBtn + emptyBlock('Jeux introuvables', S.romsError, `<button class="btn focusable" data-action="edit-console" data-console="${cid}">Modifier la console</button>`);
  if (!S.roms) return backBtn + loading('Recherche des jeux…');

  const all = filterQ(S.roms.map((r) => withScrape({ ...r, kind: 'rom', consoleId: S.romsOf })), (r) => `${r.displayName} ${r.sTitle || ''} ${r.sGenre}`);
  const items = byGenre(all);
  const fileOf = (r) => decodeURIComponent(String(r.path).split(/[\\/]/).pop().split('?')[0]).toLowerCase();
  const localNames = new Set(items.filter((r) => !r.remote).map(fileOf));
  const local = items.filter((r) => !r.remote);
  const online = items.filter((r) => r.remote && !localNames.has(fileOf(r)));
  const shownLocal = local.slice(0, S.limit);
  const shownOnline = online.slice(0, S.limit);
  S.list = [...shownLocal, ...shownOnline];

  const localTiles = shownLocal.map((r, i) => tile(r, i, 'launch-rom', 'r-game', { sub: [r.sYear, genresOf(r)[0]].filter(Boolean).join(', ') })).join('');
  const onlineTiles = shownOnline.map((r, i) => tile(r, shownLocal.length + i, 'launch-rom', 'r-game', { sub: [r.sYear, genresOf(r)[0]].filter(Boolean).join(', ') || 'En ligne' })).join('');
  const localBlock = `<h2 class="sec-h">Sur cet ordinateur <span class="count">${local.length}</span></h2>${local.length ? `<div class="grid grid-game">${localTiles}</div>` : `<p class="hint">Aucun jeu dans le dossier de la console pour l’instant.${remoteLocs.length ? ' Activez la liste en ligne ci-dessous, ou « Ajouter des jeux ».' : ' « Ajouter des jeux » ouvre des sites où en télécharger.'}</p>`}`;

  // Jeux en ligne : listés seulement sur demande (une ou plusieurs sources distantes).
  let onlineBlock = '';
  if (remoteLocs.length) {
    if (!S.romsOnline) {
      onlineBlock = `<div class="sec-h-row"><h2 class="sec-h">Disponibles en ligne</h2><button class="btn btn-sm btn-primary focusable" data-action="rom-online" data-console="${cid}">Afficher les jeux en ligne</button></div>
        <p class="hint">${plural(remoteLocs.length, 'source en ligne', 'sources en ligne')} pour cette console. L’affichage peut prendre un moment selon la source.</p>`;
    } else if (S.romsOnlineLoading) {
      onlineBlock = `<h2 class="sec-h">Disponibles en ligne</h2>${loading('Lecture de la source en ligne…')}`;
    } else {
      const picker = remoteLocs.length > 1 ? `<select class="input src-pick focusable" data-action="rom-source" aria-label="Source en ligne">
          <option value=""${!S.romsSource ? ' selected' : ''}>Toutes les sources</option>
          ${remoteLocs.map((l) => `<option value="${esc(l)}"${S.romsSource === l ? ' selected' : ''}>${esc(sourceLabel(l))}</option>`).join('')}</select>` : '';
      onlineBlock = `<div class="sec-h-row"><h2 class="sec-h">Disponibles en ligne <span class="count">${online.length}</span></h2>
          <div class="sec-tools">${picker}${online.length ? '<button class="btn btn-sm focusable" data-action="rom-dl-all">Tout télécharger</button>' : ''}</div></div>
        <p class="hint">Un appui lance le jeu (gardé en cache) ; « Télécharger sur cet ordinateur » en fait une copie dans le dossier de la console.</p>
        ${online.length ? `<div class="grid grid-game online">${onlineTiles}</div>` : '<p class="hint">Aucun jeu en ligne trouvé pour cette source.</p>'}`;
    }
  }
  const warn = S.romsWarnings?.length ? `<p class="hint warn">${esc(S.romsWarnings.join(' '))}</p>` : '';
  return `${backBtn}${warn}${siteSearch}<section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'console', consoleId: S.romsOf, count: local.length })}</section>${localBlock}${onlineBlock}${moreButton(Math.max(local.length, online.length))}`;
}

const sourceLabel = (l) => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch { return l; } };

/* ---------- Téléchargements (vue : Centre, P4-18) ---------- */

function updateDlBadge() {
  shell.setDownloads(activeDownloads(S.downloads, D.DL_ACTIVE));
}

async function loadDownloads() {
  const r = await api.downloadsList();
  S.downloads = r?.items || [];
  S.dlSettings = r?.settings || {};
  updateDlBadge();
}

let dlRenderTimer = 0;
api.onDownload((d) => {
  const { list, fine } = applyDownload(S.downloads, d);
  S.downloads = list;
  updateDlBadge();
  if (S.section !== CENTRE_VIEW) return;
  // Même état : seule la ligne de ce téléchargement change (barre et ligne d'infos). Sinon le Centre est redessiné.
  if (fine && centre.updateDownload(d)) return;
  clearTimeout(dlRenderTimer);
  dlRenderTimer = setTimeout(() => render(), 80);
});
api.onTvDetected(({ name }) => {
  if (name) toast(`Service de télévision détecté : ${name}.`, { duration: 5000 });
  api.getConfig().then((r) => { S.config = r.config; if (S.section === 'tv') { S.channels = null; S.tvWeb = null; loadChannels(); } });
});
api.onDownloadAdded((r) => toast(downloadAddedNotice(r, t), { duration: r.ok ? 4000 : 8000 }));
// Fin d'un torrent qui contient un programme d'installation : on propose de le lancer.
api.onDownloadFinished(async (d) => {
  // Un jeu bookmarké vient d'être téléchargé : on recharge config (sa carte « à télécharger » disparaît), les fiches
  // (celle du marque-page reportée sur le jeu) et les jeux.
  if (d.gameBookmark) { S.config = (await api.getConfig()).config; S.scrape = (await api.scrapeData()) || {}; if (d.console != null) { const r = await api.listRoms(d.console).catch(() => null); if (r?.ok) S.localRoms[d.console] = r.roms; } if (S.section === 'games') render(); }
  const m = (key, vars) => t(`centre.downloads.messages.${key}`, vars);
  if (d.console == null) toast(m('finished', { name: d.name }), { duration: 5000 });
  const installer = (d.installers || [])[0];
  if (d.kind !== 'torrent' || !installer) return;
  if (topDialog()) { toast(m('installerLater', { name: d.name }), { duration: 8000 }); return; }
  const res = await dialogs.openForm({
    title: m('installerTitle'),
    help: m('installerHelp', { name: d.name, file: installer.split(/[\\/]/).pop() }),
    fields: [],
    actions: [{ id: 'run', label: m('installerRun'), kind: 'primary' }, { id: 'later', label: m('installerNotNow'), kind: 'ghost' }],
  });
  if (res?.action === 'run') C.centre.runInstaller({ id: d.id, file: installer });
});

const SOURCE_GROUPS = [
  ['video', 'Vidéos', ['vidéo']], ['audio', 'Musique', ['morceau', 'morceaux']], ['image', 'Images', ['image']], ['game', 'Jeux PC', ['jeu', 'jeux']],
];
const sourceKindLabel = (loc) => (/^https?:\/\//i.test(loc) ? 'Web' : /^(\\\\|\/\/|smb:)/i.test(loc) ? 'Réseau' : 'Dossier');

function sourcesHtml(kinds = ['video', 'audio', 'image', 'game']) {
  const single = kinds.length === 1;
  return SOURCE_GROUPS.filter(([kind]) => kinds.includes(kind)).map(([kind, label, unit]) => {
    const list = kind === 'game' ? S.config.gameSources : S.config.library.sources.filter((x) => x.kind === kind);
    const status = kind === 'game' ? S.gameSourceStatus : S.sourceStatus;
    const rows = list.length ? list.map((src) => {
      const st = status[src.id];
      const state = !st ? (S.scanning ? 'Analyse…' : '') : st.ok ? plural(st.count, ...unit) : st.error;
      return `<li class="${st && !st.ok ? 'is-error' : ''}"><span class="src-type">${sourceKindLabel(src.location)}</span><span class="src-loc">${esc(src.location)}</span><span class="src-state">${esc(state)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-action="src-remove" data-kind="${kind}" data-id="${esc(src.id)}">Retirer</button></li>`;
    }).join('') : '<li class="none">Aucune source.</li>';
    return `<div class="src-group">${single ? '' : `<h3 class="set-sub">${label}</h3>`}<ul class="folder-list src-list">${rows}</ul>
      <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="src-add-folder" data-kind="${kind}">Ajouter un dossier</button><button type="button" class="btn btn-ghost btn-sm focusable" data-action="src-add-url" data-kind="${kind}">Ajouter une adresse réseau ou web</button></div></div>`;
  }).join('');
}
function renderSources() {
  for (const box of $$('.sources-box')) box.innerHTML = sourcesHtml(box.dataset.kinds.split(','));
  if (S.section === SETTINGS_VIEW) settings.refresh();
}

async function addSource(kind, location) {
  if (!location) return;
  const next = structuredClone(S.config);
  const exists = (kind === 'game' ? next.gameSources : next.library.sources.filter((x) => x.kind === kind)).some((x) => x.location === location);
  if (exists) { toast('Cette source est déjà dans la liste.'); return; }
  if (kind === 'game') next.gameSources.push({ location });
  else next.library.sources.push({ kind, location });
  S.config = await api.saveConfig(next);
  const check = await api.checkLocation(location);
  const why = check?.error ? check.error.charAt(0).toLowerCase() + check.error.slice(1) : 'elle est inaccessible pour le moment.';
  toast(check?.ok ? 'Source ajoutée. Analyse en cours…' : `Source ajoutée, mais ${why}`, { duration: check?.ok ? 3500 : 9000 });
  renderSources();
  S.scanned = false;
  if (S.section !== 'settings' && !panel.open) render();
  scan();
}

async function askSourceAddress(kind) {
  const res = await openForm({
    title: 'Ajouter une adresse',
    help: 'Partage réseau : \\\\NAS\\Films ou smb://nas/films. Serveur web : l’adresse d’une page qui liste les fichiers (http://192.168.1.10/films/) ou d’une liste de lecture M3U.',
    fields: [{ id: 'location', label: 'Adresse', value: '', placeholder: '\\\\NAS\\Films' }],
    actions: [{ id: 'ok', label: 'Ajouter', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action === 'ok' && res.values.location) await addSource(kind, res.values.location.trim());
}

function startOptions() {
  const cur = S.config.ui.start || 'home';
  const sections = [['home', 'Accueil'], ['search', 'Rechercher'], ['videos', 'Vidéos'], ['music', 'Musique'], ['images', 'Images'], ['streaming', 'Streaming'], ['tv', 'Télévision'], ['games', 'Jeux']];
  const opt = (v, l) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<optgroup label="Sections">${sections.map(([v, l]) => opt(v, l)).join('')}</optgroup>
    <optgroup label="Directement sur un service">${S.config.web.map((w) => opt(`web:${w.id}`, w.name)).join('')}</optgroup>`;
}

// Listes ordonnables de l'accueil (P4-12, home/settings.ts) : rangées, barres de la mire, sites épinglés ; valeurs
// affichées dans l'ordre choisi, puis valeurs masquées. Textes tirés des catalogues (section `home`).
function orderList(kind) {
  const items = homeOptions(S.config.ui.home, kind, { t, pages: shell.pages(), lists: home.lists(), sites: S.config.web, color: safeColor });
  const visible = items.filter((x) => x.on).length;
  return items.map((x, i) => `<li class="${x.on ? '' : 'off'}">
    <label class="check"><input type="checkbox" class="focusable" data-order="${kind}" data-id="${esc(x.id)}"${x.on ? ' checked' : ''}><span class="ol-chip" style="background:${x.color}"></span>${esc(x.label)}</label>
    <span class="ol-moves">
      <button type="button" class="icon-btn focusable" data-action="order-move" data-kind="${kind}" data-id="${esc(x.id)}" data-dir="-1" aria-label="${esc(t('home.settings.up', { name: x.label }))}"${x.on && i > 0 ? '' : ' disabled'}>${ICON.chevU}</button>
      <button type="button" class="icon-btn focusable" data-action="order-move" data-kind="${kind}" data-id="${esc(x.id)}" data-dir="1" aria-label="${esc(t('home.settings.down', { name: x.label }))}"${x.on && i < visible - 1 ? '' : ' disabled'}>${ICON.chevD}</button>
    </span>
  </li>`).join('');
}

// Réglages de l'accueil (P4-12) : horloge, rangées et leur ordre, barres de la mire, sites épinglés. Le bloc porte la
// langue de l'interface ; P4-20 le reprendra dans les nouveaux Réglages.
function homeSettingsBlock() {
  const lang = esc(document.documentElement.lang || 'fr');
  const list = (kind) => `<h3 class="set-sub">${esc(t(`home.settings.${kind}`))}</h3><ul class="order-list" id="order-${kind}">${orderList(kind)}</ul>`;
  return `<div class="home-settings" lang="${lang}">
    <label class="check"><input type="checkbox" class="focusable" data-ui="clock"${S.config.ui.home.clock ? ' checked' : ''}> ${esc(t('home.settings.clock'))}</label>
    ${list('rows')}${list('bars')}${list('sites')}</div>`;
}

// Enregistre tout de suite une modification de l'apparence ou de l'accueil.
async function saveUi(mutate) {
  const next = structuredClone(S.config);
  mutate(next.ui);
  const saved = await api.saveConfig(next);
  if (saved && saved.ui) S.config = saved;
  applyTheme();
  // Réglages de l'accueil changés depuis le rouage de l'accueil : ses rangées suivent.
  if (S.section === HOME_VIEW) home.refresh();
}

function refreshOrderList(kind, focusId, dir) {
  const ul = $(`#order-${kind}`);
  if (!ul) return;
  ul.innerHTML = orderList(kind);
  if (focusId) {
    const sel = dir ? `[data-action="order-move"][data-id="${CSS.escape(focusId)}"][data-dir="${dir}"]` : `[data-order="${kind}"][data-id="${CSS.escape(focusId)}"]`;
    const el = ul.querySelector(sel);
    (el && !el.disabled ? el : ul.querySelector(`[data-order="${kind}"][data-id="${CSS.escape(focusId)}"]`))?.focus();
  }
}

function onUiChange(e) {
  const t = e.target;
  if (t.dataset.order) {
    const { order: kind, id } = t.dataset;
    C.settings.toggleHomeItem({ kind, id, on: t.checked }).then(() => refreshOrderList(kind, id));
    return;
  }
  if (t.dataset.ui === 'clock') {
    C.settings.setHomeClock({ on: t.checked });
    return;
  }
  if (t.dataset.ui === 'adblock') {
    api.adblockSetEnabled(t.checked).then((st) => { afterAdblockChange(st); toast(t.checked ? 'Bloqueur activé. Les sites ouverts se rechargent.' : 'Bloqueur désactivé.'); });
    return;
  }
  if (t.dataset.ui === 'backdrop') {
    saveUi((ui) => { ui.backdrop = t.checked; }).then(() => { if (!t.checked) hideBackdrop(); });
    return;
  }
  if (t.dataset.ui === 'start') {
    saveUi((ui) => { ui.start = t.value; }).then(() => toast('Page de démarrage enregistrée'));
  }
  if (t.dataset.ui === 'menu-autohide') {
    saveUi((ui) => { ui.menu = { ...ui.menu, autohide: t.checked }; }).then(applyMenu);
  }
}
viewEl.addEventListener('change', onUiChange);

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function scan() {
  if (S.scanning) return;
  S.scanning = true;
  if (['home', 'videos', 'music', 'images'].includes(S.section)) render();
  if (S.section === SETTINGS_VIEW) settings.refresh();
  let items = [];
  try {
    const [lib, games] = await Promise.all([api.scanLibrary(), api.scanGameSources()]);
    items = Array.isArray(lib?.items) ? lib.items : [];
    S.sourceStatus = lib?.status || {};
    S.autoGames = Array.isArray(games?.games) ? games.games : [];
    S.gameSourceStatus = games?.status || {};
  } catch { items = []; }
  const byDirName = (a, b) => collator.compare(a.dir, b.dir) || collator.compare(a.name, b.name);
  S.library = items;
  S.videos = items.filter((x) => x.kind === 'video').sort(byDirName);
  S.tracks = items.filter((x) => x.kind === 'audio').sort(byDirName);
  S.images = items.filter((x) => x.kind === 'image').sort(byDirName);
  S.scanning = false;
  S.scanned = true;
  if (['home', 'videos', 'music', 'images', 'games'].includes(S.section)) render();
  renderSources();
  if (S.config.scrape?.auto !== false) startScrape(['videos', 'music', 'games'], { quiet: true });
}

async function openFileDialog() {
  const items = await api.openMediaDialog();
  if (items?.length) openItems(items);
}

function playList(list, i) {
  const it = list[i];
  if (!it) return;
  if (it.kind === 'video') openVideo(list, i);
  else if (it.kind === 'audio') playQueue(list, i);
  else openImages(list, i);
}

function playInContext(item) {
  const pool = item.kind === 'video' ? S.videos : item.kind === 'audio' ? S.tracks : S.images;
  let list = pool.filter((x) => x.dir === item.dir);
  let idx = list.findIndex((x) => x.path === item.path);
  if (idx < 0) { list = [item]; idx = 0; }
  playList(list, idx);
}

function openItems(items) {
  if (!items?.length) { toast('Aucun fichier lisible dans la sélection.'); return; }
  const kind = items[0].kind;
  const list = items.filter((x) => x.kind === kind);
  if (list.length === 1) playInContext(list[0]);
  else playList(list, 0);
}

async function playRecent(it) {
  if (!it) return;
  if (it.remote || /^https?:\/\//i.test(it.path)) { playInContext(it); return; }
  const [fresh] = await api.fromPaths([it.path]);
  if (!fresh) {
    toast(`Fichier introuvable : ${it.name}. Il a été retiré de la liste.`);
    removeRecent(it.path);
    if (S.section === 'home') render();
    return;
  }
  playInContext(fresh);
}

async function openBookmark(id) {
  const r = await api.bookmarkOpen(id);
  if (!r?.ok) { toast(r?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  audio.pause();
  const wid = `bm:${id}`;
  S.webActive = wid;
  if (r.state) S.webStates[wid] = r.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

// Marque-page de la page de streaming affichée : crée une entrée vidéo, scrapée aussitôt.
// Marque-page d'un jeu depuis le navigateur de téléchargement : fiche de la page, ou lien collé.
async function bookmarkCurrentGame() {
  const st = S.webStates[S.webActive];
  const url = st?.bookmarkUrl || st?.url;
  const curConsole = st?.rom?.console;
  if (S.section === 'web') api.webHide();
  const res = await openForm({
    title: 'Ajouter ce jeu (à télécharger)',
    help: 'La page du jeu (sa fiche torrent), un lien de téléchargement direct, ou un lien magnet. Le jeu apparaîtra dans la liste avec un bouton Télécharger.',
    fields: [
      { id: 'title', label: 'Titre du jeu', value: (st?.title || '').replace(/\s*[-|–].*$/, '').trim(), full: true },
      { id: 'source', label: 'Lien (page, téléchargement direct, ou magnet)', value: url || '', full: true },
    ],
    actions: [{ id: 'add', label: 'Ajouter', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action !== 'add') { if (S.section === 'web') syncWeb(); return; }
  const v = res.values;
  if (!v.source.trim()) { toast('Indiquez un lien.'); if (S.section === 'web') syncWeb(); return; }
  toast('Ajout du jeu…', { duration: 3000 });
  const r = await api.gameBookmarkAdd({ source: v.source.trim(), title: v.title.trim(), console: curConsole });
  if (!r?.ok) { toast(r?.error || 'Ajout impossible.', { duration: 7000 }); if (S.section === 'web') syncWeb(); return; }
  S.config = r.config;
  await loadDownloads();
  // Système non déterminé : on le demande (console ouverte par défaut).
  if (r.needSystem) await askBookmarkConsole(r.bookmark.id, curConsole);
  // Fiche trouvée pour le marque-page (à l'ajout, ou quand le système a été choisi) : affichée sur sa carte.
  S.scrape = (await api.scrapeData()) || {};
  if (S.section === 'web') syncWeb();
  toast('Jeu ajouté à la liste. Téléchargez-le quand vous voulez.', { duration: 6000 });
}

// Demande à quel système rattacher un jeu bookmarké (console ouverte par défaut).
async function askBookmarkConsole(id, def) {
  const options = [['pc', 'Jeux PC'], ...S.config.emulators.map((e) => [e.id, e.name])];
  if (!options.length) return;
  const res = await openForm({
    title: 'Système du jeu',
    help: 'Le système n’a pas pu être déterminé automatiquement. À quel système ce jeu appartient-il ?',
    fields: [{ id: 'console', type: 'select', label: 'Système', value: def != null ? String(def) : options[0][0], options, full: true }],
    actions: [{ id: 'ok', label: 'Valider', kind: 'primary' }],
  });
  const val = res?.values?.console;
  if (val != null) { const r = await api.gameBookmarkSetConsole(id, val); if (r?.config) S.config = r.config; }
}

async function downloadGameBookmark(id) {
  if (!id) return;
  const r = await api.gameBookmarkDownload(id);
  if (!r?.ok) { toast(r?.error || 'Téléchargement impossible.', { duration: 7000 }); return; }
  await loadDownloads();
  toast('Téléchargement lancé. Suivez-le dans le Centre.', { duration: 5000 });
  render();
}

async function bookmarkCurrentPage() {
  const st = S.webStates[S.webActive];
  const url = st?.bookmarkUrl || st?.url;
  if (!url) { toast('Aucune page à mettre en marque-page.'); return; }
  const suggested = (st.title || '').replace(/\s*[-|–].*$/, '').trim();
  // La vue web est une couche native au-dessus de l'interface : on la cache pour voir la fenêtre.
  if (S.section === 'web') api.webHide();
  const res = await openForm({
    title: 'Ajouter cette page aux vidéos',
    help: (() => { try { return decodeURI(url); } catch { return url; } })(),
    fields: [
      { id: 'title', label: 'Titre à rechercher (film ou série)', value: suggested, full: true },
      { id: 'type', type: 'select', label: 'Type', value: 'movie', options: [['movie', 'Film'], ['tv', 'Série']], full: true },
      { id: 'season', label: 'Saison (séries)', value: '', placeholder: 'ex. 1' },
      { id: 'episode', label: 'Épisode (séries)', value: '', placeholder: 'ex. 3' },
    ],
    actions: [{ id: 'add', label: 'Ajouter et récupérer les infos', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action !== 'add') { if (S.section === 'web') syncWeb(); return; }
  const v = res.values;
  if (!v.title.trim()) { toast('Donnez un titre à rechercher.'); return; }
  toast('Ajout et récupération des infos…', { duration: 3000 });
  const r = await api.bookmarkAdd({ url, title: v.title.trim(), type: v.type, season: v.season, episode: v.episode });
  if (!r?.ok) { toast(r?.error || 'Ajout impossible.', { duration: 7000 }); return; }
  S.config = r.config;
  S.scrape = (await api.scrapeData()) || {};
  await scan(); // la nouvelle entrée apparaît dans les Vidéos
  if (S.section === 'web') syncWeb(); // on reste sur la page, la vue web revient
  toast(r.scraped ? `Ajouté aux vidéos et infos récupérées : ${v.title.trim()}.` : `Ajouté aux vidéos : ${v.title.trim()}. Infos non trouvées (à corriger via Modifier).`, { duration: 6000 });
}

async function openExternal(it, start = 0) {
  const r = await api.playExternal(it.path, it.name, start);
  toast(r.ok ? `${it.name} s’ouvre dans le lecteur externe` : r.error, { duration: r.ok ? 3000 : 7000 });
}

async function openWeb(id, url) {
  const w = S.config.web.find((x) => x.id === id);
  if (!w) return;
  const firstTime = !S.webSessions.some((x) => x.id === id);
  if (firstTime) toast(t('webView.opening', { name: w.name }), { duration: 2500 });
  const r = await api.webOpen(id, url);
  if (!r?.ok) { toast(r?.error || t('webView.openFailed'), { duration: 7000 }); return; }
  if (!r.integrated) { toast(t('webView.inBrowser', { name: w.name })); return; }
  if (!w.background) audio.pause();
  S.webActive = id;
  if (r.state) S.webStates[id] = r.state;
  S.webFocusOnShow = true;
  go('web');
}

// Service de télé par portail web (SFR, Bouygues, Molotov) : ouvert dans la vue intégrée.
async function openTvWeb(web) {
  const id = `tv:${web.id}`;
  const res = await api.webOpen(id);
  if (!res?.ok) { toast(res?.error || t('webView.openFailed'), { duration: 7000 }); return; }
  audio.pause();
  S.webActive = id;
  if (res.state) S.webStates[id] = res.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

// Nettoyage : vérifie que les jeux existent encore (fichiers locaux, et sources en ligne si demandé).
async function cleanupGames() {
  const online = await confirmDialog('Nettoyer la base de jeux', 'Mire vérifie que chaque jeu est toujours là. Vérifier aussi que les sources en ligne répondent ? (plus long)', 'Vérifier aussi en ligne');
  toast('Vérification des jeux…', { duration: 3000 });
  const r = await api.gamesCleanup(online);
  if (!r?.ok) { toast('Nettoyage impossible.', { duration: 6000 }); return; }
  if (r.config) S.config = r.config;
  await loadLocalRoms();
  try { const g = await api.scanGameSources(); if (Array.isArray(g?.games)) S.autoGames = g.games; } catch { /* dossiers inchangés */ }
  const parts = [];
  if (r.removedManual) parts.push(`${plural(r.removedManual, 'jeu PC retiré', 'jeux PC retirés')} (fichier absent)`);
  if (r.missingRemote?.length) parts.push(`${plural(r.missingRemote.length, 'source en ligne injoignable', 'sources en ligne injoignables')}`);
  toast(parts.length ? `Nettoyage terminé : ${parts.join(', ')}.` : 'Nettoyage terminé : tous les jeux sont disponibles.', { duration: 7000 });
  if (panel.open) refreshPanel();
  render();
}

async function openRomBrowser(i, { site, url } = {}) {
  const name = i === 'pc' ? 'Jeux PC' : consoleOf(i)?.name;
  if (name == null) return;
  const r = await api.romSites(i);
  S.romSites[i] = r?.sites || [];
  if (!S.romSites[i].length) {
    if (i === 'pc') { toast('Aucun site de jeux PC configuré. Ajoutez-en dans les réglages de la page Jeux, onglet Jeux PC.', { duration: 7000 }); openPageSettings('pc'); }
    else { toast(`Aucun site n’est configuré pour ${name}. Ajoutez-en dans « Modifier la console ».`, { duration: 7000 }); editConsole(i); }
    return;
  }
  const id = `rom:${i}`;
  if (!S.webSessions.some((x) => x.id === id)) toast(`Ouverture des sites de jeux pour ${name}…`, { duration: 2500 });
  const res = await api.webOpen(id, url, { site: site != null ? site : undefined });
  if (!res?.ok) { toast(res?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  audio.pause();
  S.webActive = id;
  if (res.state) S.webStates[id] = res.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

// Une chaîne est désignée par sa clé : le service de télévision du processus principal choisit sa variante (qualité
// préférée) et ouvre le lecteur externe (P4-16).
async function playChannel(c) {
  if (!c?.key) return;
  toast(t('webView.channelOpening', { name: c.name }), { duration: 2500 });
  audio.pause();
  const r = await api.tvWatch(c.key);
  if (!r?.ok) toast(r?.error || t('webView.openFailed'), { duration: 7000 });
}

async function loadChannels() {
  S.tvLoading = true;
  S.tvError = null;
  if (S.section === 'tv') render();
  const r = await api.tvChannels();
  S.tvLoading = false;
  S.tvWeb = null;
  if (r?.ok && r.web) { S.tvWeb = r.web; S.channels = null; S.tvError = null; }
  else if (r?.ok) S.channels = r.channels;
  else { S.channels = null; S.tvError = r?.error || 'Erreur inconnue.'; }
  if (S.section === 'tv') {
    render();
    if (takePendingFocus()) focusFirst();
  }
  if (S.section === SEARCH_VIEW) search.refresh();
}

async function launchEntry(g) {
  if (!g) return;
  if (g.manualIndex != null) { launchGame(g.manualIndex); return; }
  toast(`Lancement de ${labelOf(g)}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchGamePath(g.path);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function launchGame(i) {
  const g = S.config.games[i];
  if (!g) return;
  toast(`Lancement de ${g.name}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchGame(i);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function addGame() {
  const cfg = await api.addGame();
  if (cfg && cfg.games) {
    S.config = cfg;
    render();
    toast('Jeu ajouté. Vous pouvez lui donner une jaquette dans Réglages.');
  }
}

async function openEmu(i) {
  S.genre = '';
  S.romsOf = i;
  S.roms = null;
  S.romsError = null;
  S.romsOnline = false;
  S.romsOnlineLoading = false;
  S.romsSource = '';
  S.query = '';
  searchEl.value = '';
  S.limit = PAGE;
  render({ resetScroll: true });
  const r = await api.listRoms(i);
  if (S.romsOf !== i) return;
  api.romSites(i).then((x) => { S.romSites[i] = x?.sites || []; });
  if (r.ok) { S.roms = r.roms; S.romsWarnings = r.errors || []; S.localRoms[i] = r.roms; }
  else S.romsError = r.error;
  render();
  // Option : afficher d'emblée les jeux en ligne.
  const emu = consoleOf(i);
  const hasRemote = emu && [emu.romsDir, ...(emu.sources || [])].filter(Boolean).some((l) => /^https?:\/\//i.test(l));
  if (S.config.gamesOpts?.autoOnline && hasRemote) {
    S.romsOnline = true; S.romsOnlineLoading = true; render();
    const rr = await api.romListSource(i); if (S.romsOf !== i) return;
    S.romsOnlineLoading = false;
    if (rr?.ok) { S.roms = rr.roms; S.romsWarnings = rr.errors || []; }
    render();
  }
  const banner = consoleOf(i)?.banner;
  if (banner) showBackdrop(banner);
  (viewEl.querySelector('.tile') || viewEl.querySelector('.focusable'))?.focus();
}

function closeRoms() {
  const i = S.romsOf;
  S.romsOf = null;
  S.genre = '';
  setTimeout(updateScrapeButton);
  S.query = '';
  searchEl.value = '';
  S.limit = PAGE;
  render({ resetScroll: true });
  (viewEl.querySelector(`[data-action="open-emu"][data-console="${CSS.escape(String(i))}"]`) || viewEl.querySelector('.focusable'))?.focus();
}

async function launchRom(rom, consoleId) {
  if (!rom) return;
  const i = consoleId != null ? consoleId : S.romsOf;
  toast(`Lancement de ${rom.displayName}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchRom(i, rom.path);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function addSourceFolder(kind) {
  const p = await api.pickFolder();
  if (p) await addSource(kind, p);
}

async function removeSource(kind, id) {
  const next = structuredClone(S.config);
  if (kind === 'game') next.gameSources = next.gameSources.filter((x) => x.id !== id);
  else next.library.sources = next.library.sources.filter((x) => x.id !== id);
  S.config = await api.saveConfig(next);
  renderSources();
  toast('Source retirée');
  scan();
}

/* ------------------------------------------------------------------ */
/* Vue web intégrée                                                    */
/* ------------------------------------------------------------------ */

// Sites ouverts dans le menu, sous leur page d'origine : les services sous Streaming, les portails TV sous
// Télévision, les sites de jeux d'une console sous Jeux.
function renderRailSessions() {
  shell.setSessions(S.webSessions, S.webActive, webHome, safeColor);
}

// Page d'où vient une vue web : Jeux pour les sites de jeux, Télévision pour les portails TV, sinon Streaming.
function webHome(id = S.webActive) {
  return webHomeOf(id);
}

function webShouldShow() {
  return S.section === 'web' && !!S.webActive && !isVideoOpen() && !isImagesOpen() && !dialogs.dialogsOpen();
}
// Une couche plein écran (vidéo locale, images) ou une boîte sur les composants (P4-06) passe devant : la vue web se
// cache, puis revient.
function syncWeb(focus = false) {
  if (S.section === 'web') web.sync(focus);
}

// Retour d'un site : sa page d'origine (Streaming, Télévision, Jeux), dans la vue de page comme depuis le menu ;
// la section historique si la page n'existe plus.
function openWebHome(home) {
  if (!shell.open(home, { focus: 'content' })) go(home, { focus: 'content' });
}

// Barre du site redessinée d'après le dernier état publié (bloqueur changé, éléments bloqués).
function refreshWebBar() {
  if (S.section === 'web') web.set(S.webActive, S.webStates[S.webActive] ?? null);
}

async function learnSearch() {
  const r = await api.webLearnSearch(S.webActive);
  if (!r?.ok) { toast(r?.error || t('webView.learnFailed'), { duration: 9000 }); return; }
  S.config = r.config;
  // La barre se met à jour avec l'état publié (recherche mémorisée).
  toast(t('webView.learned'), { duration: 6000 });
}

api.onWebState((st) => {
  S.webStates[st.id] = st;
  if (S.section === 'web' && st.id === S.webActive) web.set(st.id, st);
});
viewEl.addEventListener('change', (e) => {
  if (e.target.matches('[data-action="rom-source"]')) runLegacyAction(e.target, legacyView);
});
api.onWebSessions((list) => {
  S.webSessions = Array.isArray(list) ? list : [];
  renderRailSessions();
  if (S.section === 'streaming') render();
});
api.onWebClosed(({ id }) => {
  delete S.webStates[id];
  if (S.webActive === id) {
    const home = webHome(id);
    S.webActive = null;
    if (S.section === 'web') openWebHome(home);
  }
});
api.onWebError(({ message }) => toast(message, { duration: 8000 }));
api.onWebBlocked(({ id, count }) => {
  if (S.webStates[id]) S.webStates[id] = { ...S.webStates[id], blocked: count };
  if (id === S.webActive) refreshWebBar();
});
let lastAdToast = 0;
api.onWebAdblocked(({ host }) => {
  if (Date.now() - lastAdToast < 4000) return;
  lastAdToast = Date.now();
  toast(`Redirection publicitaire bloquée${host ? ` (${host})` : ''}`, { duration: 3000 });
});
api.onWebFocus((focused) => { S.webFocused = !!focused; });
api.onMireFocus(() => {
  S.webFocused = false;
  document.body.classList.remove('mouse');
  const target = (S.section === 'web' && web.firstButton()) || $('.rail-item[aria-current]');
  target?.focus();
});

/* ------------------------------------------------------------------ */
/* Recherche globale                                                   */
/* ------------------------------------------------------------------ */

function getQueries() { return S.usage.queries; }
function rememberQuery(q) {
  if (!q) return;
  S.usage.queries = [q, ...getQueries().filter((x) => fold(x) !== fold(q))].slice(0, 10);
  api.usageAddQuery(q);
}

async function fillAdblock(fresh) {
  const st = fresh || await api.adblockStatus();
  S.adblock = st;
  if (S.section === SETTINGS_VIEW) settings.refresh();
  const el = $('#adblock-status');
  if (!el || !st) return;
  el.textContent = adblockStatusText(st, t, (d) => i18n.engine?.formatDate(d) ?? d.toLocaleDateString());
  const row = (value, kind) => `<li><span class="src-loc">${esc(value)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-action="adblock-remove" data-kind="${kind}" data-id="${esc(value)}">Retirer</button></li>`;
  $('#adblock-allow').innerHTML = st.allowlist.length ? st.allowlist.map((h) => row(h, 'allowlist')).join('') : '<li class="none">Aucun : le bloqueur agit partout. Le bouton « Pubs bloquées » de la barre d’un site permet de le désactiver sur ce site.</li>';
  $('#adblock-lists').innerHTML = st.customLists.length ? st.customLists.map((u) => row(u, 'customLists')).join('') : '<li class="none">Aucune.</li>';
}

// Les réglages du bloqueur sont enregistrés par le processus principal : on relit la configuration.
async function afterAdblockChange(st) {
  S.config = (await api.getConfig()).config;
  await fillAdblock(st || undefined);
}

// État de la lecture protégée, rédigé pour les Réglages (P4-20).
let drmText = '';
async function fillDrmStatus() {
  const d = await api.drmStatus();
  drmText = drmStatusText(d, t);
  if (S.section === SETTINGS_VIEW) settings.refresh();
}

/* ------------------------------------------------------------------ */
/* Infos et images en ligne                                            */
/* ------------------------------------------------------------------ */

const SCRAPE_KIND = { videos: 'videos', music: 'music', games: 'games' };

// Le rouage de l'en-tête ouvre les réglages de la page ; il signale aussi une récupération d'infos en cours.
function updateScrapeButton() {
  shell.setGear({ hidden: S.section === 'settings', scrape: S.scraping });
  const p = S.scraping;
  const st = $('#scrape-state');
  if (st) st.textContent = scrapeStateText();
  const runBtn = $('#scrape-run');
  if (runBtn) runBtn.textContent = p?.running ? 'Arrêter' : 'Récupérer les infos';
}
function scrapeStateText() {
  const p = S.scraping;
  if (p?.running) return p.total ? `Récupération en cours : ${p.done} sur ${p.total}.` : 'Préparation de la récupération…';
  return '';
}

function scrapeJobs(kinds) {
  const albums = [];
  const seen = new Set();
  for (const t of S.tracks) if (!seen.has(t.dir)) { seen.add(t.dir); albums.push({ dir: t.dir, folder: t.folder }); }
  return {
    kinds,
    videos: kinds.includes('videos') ? S.videos.map((v) => ({ path: v.path, name: v.name, dir: v.dir })) : [],
    albums: kinds.includes('music') ? albums : [],
    pcGames: kinds.includes('games') ? pcGameEntries().map((g) => ({ name: g.name, path: g.path })) : [],
  };
}

async function startScrape(kinds, { quiet = false, force = false } = {}) {
  if (S.scraping?.running) return;
  S.scrapeQuiet = quiet;
  S.scraping = { running: true, done: 0, total: 0 };
  updateScrapeButton();
  const r = await api.scrapeRun({ ...scrapeJobs(kinds), force });
  if (r && r.ok === false && r.error) toast(r.error);
}

async function reloadScrape() {
  S.scrape = (await api.scrapeData()) || {};
  S.meta = (await api.metaAll()) || {};
  S.romsCache = {};
  if (['home', 'videos', 'music', 'games', 'search'].includes(S.section)) render();
}

// Seule la fin est signalée : le suivi du téléchargement se fait dans le gestionnaire.
api.onRomDownload((p) => {
  if (p.phase !== 'done') return;
  delete S.romsCache[p.console];
  toast(romAddedNotice(p, t), { duration: 7000 });
  if (S.section === 'games' && S.romsOf === p.console) openEmu(p.console);
});

api.onRomProgress((p) => toast(romProgressNotice(p, t), { duration: p.phase === 'done' ? 2500 : 5000 }));

api.onScrapeProgress((p) => {
  S.scraping = p;
  updateScrapeButton();
  if (!p.running) {
    reloadScrape();
    const skipped = p.skipped?.length ? ` Ignorées : ${p.skipped.join(', ')}.` : '';
    if (!S.scrapeQuiet || p.found) {
      if (!p.total) toast(`Tout est déjà à jour.${skipped}`);
      else toast(`${plural(p.found || 0, 'élément complété', 'éléments complétés')}, ${plural(p.missing || 0, 'introuvable', 'introuvables')}.${skipped}`, { duration: 6000 });
    }
  }
});


/* ---------- Réglages de la page (rouage de l'en-tête) ---------- */

const panel = $('#panel');
const panelBody = $('#panel-body');
const panelTabs = $('#panel-tabs');
const P = { section: null, tab: null };

const PANEL_TITLES = { home: 'Accueil', search: 'Rechercher', videos: 'Vidéos', music: 'Musique', images: 'Images', streaming: 'Streaming', web: 'Streaming', tv: 'Télévision', games: 'Jeux', downloads: 'Centre' };

// Champ enregistré dès qu'il change (data-cfg="chemin.dans.la.config").
const cfgInput = (path, label, value, placeholder = '', type = 'text') => `<div class="field"><label for="cfg-${path}">${esc(label)}</label><input class="input focusable" id="cfg-${path}" data-cfg="${path}" type="${type}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"></div>`;

function scrapeBlock(kind, help) {
  return `<section class="pset"><h3 class="pset-h">Infos et images</h3><p class="set-help">${help}</p>
    <div class="btn-row"><button type="button" class="btn btn-primary btn-sm focusable" id="scrape-run" data-action="scrape-section" data-kind="${kind}">${S.scraping?.running ? 'Arrêter' : 'Récupérer les infos'}</button><button type="button" class="btn btn-ghost btn-sm focusable" data-action="scrape-section" data-kind="${kind}" data-force="1">Tout récupérer à nouveau</button></div>
    <p class="set-help" id="scrape-state">${esc(scrapeStateText())}</p>
    <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="scrape.auto"${S.config.scrape?.auto !== false ? ' checked' : ''}> Récupérer automatiquement après chaque analyse</label>
    <p class="set-help">Pour corriger un élément mal reconnu : « Modifier » (ou clic droit, touche E, bouton X), puis « Rechercher en ligne » et choisissez la bonne fiche.</p></section>`;
}

function menuBlock() {
  const m = S.config.ui.menu;
  const pos = [['left', 'À gauche'], ['right', 'À droite'], ['top', 'En haut'], ['bottom', 'En bas']];
  return `<section class="pset"><h3 class="pset-h">Menu principal</h3>
    <p class="set-help">À gauche ou à droite, le menu est une barre latérale ; en haut ou en bas, c’est un carrousel qu’on fait défiler. Appliqué immédiatement.</p>
    <div class="seg" role="group" aria-label="Position du menu">${pos.map(([v, l]) => `<button type="button" class="seg-btn focusable" data-action="menu-pos" data-id="${v}" aria-pressed="${m.position === v}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" class="focusable" data-ui="menu-autohide"${m.autohide ? ' checked' : ''}> Menu rétractable : il se cache et réapparaît quand on approche du bord ou qu’on y revient avec les flèches</label></section>`;
}

function panelSpec(section) {
  const c = S.config;
  switch (section) {
    case 'home':
      return [
        { id: 'home', label: 'Accueil', html: () => `<section class="pset"><h3 class="pset-h">Page d’accueil</h3>
          <div class="field"><label for="set-start">Au démarrage, ouvrir</label><select class="input focusable" id="set-start" data-ui="start">${startOptions()}</select></div>
          ${homeSettingsBlock()}</section>` },
        { id: 'menu', label: 'Menu', html: menuBlock },
      ];
    case 'search':
      return [{ id: 'search', label: 'Recherche', html: () => `<section class="pset"><h3 class="pset-h">Catalogues de streaming</h3>
        <p class="set-help">Avec une clé gratuite de TMDB, la recherche montre les films et séries et le service où les regarder.</p>
        ${cfgInput('search.tmdbToken', 'Clé ou jeton TMDB', c.search.tmdbToken, 'Facultatif', 'password')}
        <div class="field"><label for="cfg-region">Pays des disponibilités</label><select class="input focusable" id="cfg-region" data-cfg="search.region">${[['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['LU', 'Luxembourg'], ['CA', 'Canada']].map(([v, l]) => `<option value="${v}"${v === (c.search.region || 'FR') ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm focusable" data-action="clear-queries">Effacer les recherches récentes</button></div></section>` }];
    case 'videos':
    case 'music':
    case 'images': {
      const kind = { videos: 'video', music: 'audio', images: 'image' }[section];
      const tabs = [{ id: 'sources', label: 'Sources', html: () => `<section class="pset"><p class="set-help">Dossiers, partages réseau (\\\\NAS\\Films, smb://nas/films) ou serveurs web. Appliqué immédiatement.</p><div class="sources-box" data-kinds="${kind}">${sourcesHtml([kind])}</div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm focusable" data-action="rescan">Analyser à nouveau</button></div></section>` }];
      if (section === 'videos') tabs.push({ id: 'infos', label: 'Infos et affiches', html: () => scrapeBlock('videos', c.search.tmdbToken ? 'Affiches, résumés, genres et fonds d’écran depuis TMDB.' : 'Ajoutez une clé TMDB (Réglages ou page Rechercher) pour récupérer affiches, résumés, genres et fonds d’écran.') });
      if (section === 'music') tabs.push({ id: 'infos', label: 'Infos et pochettes', html: () => scrapeBlock('music', 'Pochettes, artistes, années et genres depuis MusicBrainz.') });
      tabs.push({ id: 'display', label: 'Affichage', html: () => `<section class="pset"><label class="check"><input type="checkbox" class="focusable" data-ui="backdrop"${c.ui.backdrop !== false ? ' checked' : ''}> Afficher le fond d’écran de l’élément sélectionné</label>
        ${section === 'videos' ? cfgInput('externalPlayer.path', 'Lecteur externe (formats non lus par Mire, télévision)', c.externalPlayer.path, 'Détection automatique (mpv, puis VLC)') : ''}</section>` });
      return tabs;
    }
    case 'streaming':
    case 'web':
      return [
        { id: 'adblock', label: 'Bloqueur de pubs', html: () => adblockBlock() },
        { id: 'sites', label: 'Sites', html: () => `<section class="pset"><h3 class="pset-h">Ajouter un site</h3>
          <p class="set-help">Le site apparaît dans Streaming, rubrique « Autres sites ». Pour le modifier ou le retirer, voir Réglages, « Sites, jeux et consoles ».</p>
          <div class="field"><label for="ns-name">Nom</label><input class="input focusable" id="ns-name" placeholder="Arte"></div>
          <div class="field"><label for="ns-url">Adresse</label><input class="input focusable" id="ns-url" placeholder="https://www.arte.tv/fr/"></div>
          <div class="btn-row"><button type="button" class="btn btn-primary btn-sm focusable" data-action="add-site">Ajouter</button></div></section>` },
      ];
    case 'tv':
      return [{ id: 'tv', label: 'Télévision', html: () => tvBlock() }];
    case 'downloads':
      return [{ id: 'downloads', label: 'Téléchargements', html: () => `<section class="pset"><h3 class="pset-h">Torrents</h3>
        <div class="field"><label for="cfg-tclient">Client torrent</label><select class="input focusable" id="cfg-tclient" data-cfg="downloads.torrentClient">
          <option value="mire"${S.config.downloads?.torrentClient !== 'system' ? ' selected' : ''}>Intégré à Mire (progression suivie ici)</option>
          <option value="system"${S.config.downloads?.torrentClient === 'system' ? ' selected' : ''}>Logiciel installé sur l’ordinateur (qBittorrent, Transmission…)</option></select></div>
        <p class="set-help">Avec un logiciel installé, Mire lui confie le lien ou le fichier : le téléchargement se suit alors dans ce logiciel.</p>
        <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="downloads.seed"${S.config.downloads?.seed ? ' checked' : ''}> Continuer à partager un torrent une fois téléchargé (tant que Mire est ouvert)</label></section>
        <section class="pset"><h3 class="pset-h">Dossier</h3>
        <div class="field"><label for="cfg-dldir">Dossier des téléchargements</label><div class="field-row"><input class="input focusable" id="cfg-dldir" data-cfg="downloads.dir" value="${esc(S.config.downloads?.dir || '')}" placeholder="Téléchargements/Mire"><button type="button" class="btn focusable" data-action="dl-pick-dir">Parcourir</button></div></div>
        <p class="set-help">Les jeux téléchargés pour une console vont toujours dans le dossier principal de cette console.</p></section>` }];
    case 'games':
      return [
        { id: 'consoles', label: 'Consoles', html: () => consolesBlock() },
        { id: 'pc', label: 'Jeux PC', html: () => `<section class="pset"><h3 class="pset-h">Dossiers de jeux PC</h3><p class="set-help">Analysés automatiquement : un jeu par raccourci ou par sous-dossier.</p><div class="sources-box" data-kinds="game">${sourcesHtml(['game'])}</div>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="add-game">Ajouter un jeu à la main</button></div></section>
          <section class="pset"><h3 class="pset-h">Sites pour télécharger des jeux PC</h3>
          <p class="set-help">Mire ne propose aucun site d’office. Ajoutez ceux que vous voulez : « Ajouter des jeux PC » les ouvrira dans un navigateur intégré, avec recherche et téléchargement, comme pour les consoles. Un par ligne : « Nom | adresse | adresse de recherche avec {q} ».</p>
          <textarea class="input focusable" id="pc-sites" rows="4" placeholder="Nom | https://… | https://…?q={q}">${esc(D.sitesToText(c.pcSites))}</textarea>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="save-pc-sites">Enregistrer les sites</button></div></section>` },
        { id: 'infos', label: 'Infos et jaquettes', html: () => scrapeBlock('games', 'Jaquettes, genres, années et fonds : libretro pour les consoles, Steam pour les jeux PC.') },
        { id: 'maint', label: 'Entretien', html: () => `<section class="pset"><h3 class="pset-h">Liste des jeux</h3>
          <p class="set-help">La liste des jeux réunit vos jeux PC et les jeux de console présents sur l’ordinateur, filtrables par système. Pour un jeu venant d’une source en ligne, ouvrez la console puis « Afficher les jeux en ligne ».</p>
          <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="gamesOpts.autoOnline"${c.gamesOpts?.autoOnline ? ' checked' : ''}> Afficher d’emblée les jeux en ligne en ouvrant une console (sans cliquer sur « Afficher »)</label>
          <h3 class="set-sub">Nettoyage</h3>
          <p class="set-help">Vérifie que chaque jeu est toujours disponible : fichiers locaux présents, et sources en ligne joignables si vous le demandez. Les jeux PC dont le fichier a disparu sont retirés de la liste.</p>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="games-cleanup">Nettoyer la base de jeux</button></div></section>` },
      ];
    default:
      return null;
  }
}

function tvBlock() {
  const c = S.config;
  const rows = c.tv.services.map((t) => `<li class="tv-row${t.id === c.tv.active ? ' active' : ''}">
      <label class="radio"><input type="radio" name="tv-svc" class="focusable" data-action="tv-service-radio" data-id="${esc(t.id)}"${t.id === c.tv.active ? ' checked' : ''}>
        <span class="tv-name">${esc(t.name)}<span class="tv-sub">${t.kind === 'web' ? 'portail web' : 'playlist M3U'}${t.id === c.tv.active ? ' · actif' : ''}</span></span></label>
    </li>`).join('');
  const active = c.tv.services.find((t) => t.id === c.tv.active);
  return `<section class="pset"><h3 class="pset-h">Service de télévision</h3>
    <p class="set-help">Au premier lancement, Mire reconnaît votre box sur le réseau. Vous pouvez aussi choisir le service à la main.</p>
    <ul class="folder-list">${rows}</ul>
    <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="tv-detect">Détecter ma box</button>${active ? '<button type="button" class="btn btn-sm focusable" data-action="tv-reload">Recharger</button>' : ''}</div></section>
    ${active && active.kind === 'playlist' ? `<section class="pset"><h3 class="pset-h">${esc(active.name)}</h3>
      <div class="field"><label for="tv-url">Adresse de la playlist</label><input class="input focusable" id="tv-url" data-tv-url="${esc(active.id)}" value="${esc(active.url || '')}"></div></section>` : ''}
    <section class="pset"><h3 class="pset-h">Lecteur</h3>${cfgInput('externalPlayer.path', 'Lecteur externe (mpv, VLC)', c.externalPlayer.path, 'Détection automatique')}</section>`;
}

function consolesBlock() {
  const list = S.config.emulators;
  const rows = list.length ? list.map((e) => `<li class="con-row">
      <span class="con-thumb"${e.banner ? ` style="background-image:url('${esc(mediaUrl(e.banner)).replace(/'/g, '%27')}')"` : ''}></span>
      <span class="con-name">${esc(e.name)}<span class="con-sub">${esc([e.system || '', plural((e.sources || []).length + (e.romsDir ? 1 : 0), 'source')].filter(Boolean).join(', '))}</span></span>
      <button type="button" class="btn btn-ghost btn-sm focusable" data-action="edit-console" data-console="${esc(e.id)}">Modifier</button>
    </li>`).join('') : '<li class="none">Aucune console. Les apps du Centre les installent en un clic.</li>';
  return `<section class="pset"><p class="set-help">« Modifier » change l’émulateur, les dossiers et sources de jeux, et la bannière affichée dans Jeux.</p><ul class="folder-list con-list">${rows}</ul></section>`;
}

function adblockBlock() {
  const c = S.config;
  return `<section class="pset" id="set-adblock">
    <p class="set-help">Bloque publicités, pistage, fenêtres surgissantes et redirections publicitaires dans les sites, avec les listes d’Adblock Plus et d’uBlock Origin.</p>
    <label class="check"><input type="checkbox" class="focusable" data-ui="adblock"${c.adblock?.enabled !== false ? ' checked' : ''}> Bloquer les publicités dans les sites</label>
    <p class="set-help" id="adblock-status">Vérification…</p>
    <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="adblock-update">Mettre à jour les listes</button></div>
    <h3 class="set-sub">Sites où le bloqueur est désactivé</h3><ul class="folder-list" id="adblock-allow"></ul>
    <h3 class="set-sub">Listes de filtres supplémentaires</h3><ul class="folder-list" id="adblock-lists"></ul>
    <div class="field-row"><input class="input focusable" id="adblock-new" placeholder="Adresse d’une liste au format Adblock Plus ou uBlock (https://…)"><button type="button" class="btn btn-sm focusable" data-action="adblock-add-list">Ajouter</button></div>
  </section>`;
}

function renderPanel(keepFocus = true) {
  const tabs = panelSpec(P.section);
  if (!tabs) return;
  if (!tabs.some((t) => t.id === P.tab)) P.tab = tabs[0].id;
  const active = document.activeElement;
  const sel = keepFocus && panelBody.contains(active) ? focusSelectorOf(active) : null;
  const scroll = panelBody.scrollTop;
  panelTabs.innerHTML = tabs.length > 1 ? tabs.map((t) => `<button type="button" class="tab focusable" role="tab" data-panel-tab="${t.id}" aria-selected="${t.id === P.tab}">${esc(t.label)}</button>`).join('') : '';
  panelTabs.hidden = tabs.length < 2;
  panelBody.innerHTML = tabs.find((t) => t.id === P.tab).html();
  panelBody.scrollTop = scroll;
  if (P.tab === 'adblock') fillAdblock();
  if (sel) panelBody.querySelector(sel)?.focus({ preventScroll: true });
}

function openPageSettings(tab) {
  // Vue de page (P4-11) : les réglages de l'ancienne vue de la page (sources, infos, filtres).
  const section = S.section === 'games' && S.romsOf != null ? 'games' : S.section === PAGE_VIEW ? (pages.legacySection() ?? S.section) : S.section;
  if (!panelSpec(section)) { go('settings'); return; }
  P.section = section;
  P.tab = tab || (section === P.lastSection ? P.tab : null);
  P.lastSection = section;
  $('#panel-title').textContent = `Réglages : ${PANEL_TITLES[section] || ''}`;
  renderPanel(false);
  if (S.section === 'web') api.webHide();
  openModal(panel);
  (panelTabs.querySelector('[aria-selected="true"]') || panelBody.querySelector('.focusable'))?.focus();
}
function refreshPanel() { if (panel.open) renderPanel(); }

panel.addEventListener('close', () => {
  if (S.section === 'web') syncWeb();
  if (['videos', 'music', 'images', 'games', 'home', 'tv', 'streaming', 'downloads'].includes(S.section)) render();
  $('#page-gear')?.focus({ preventScroll: true });
});
panelBody.addEventListener('change', (e) => onUiChange(e));
panel.addEventListener('click', (e) => {
  if (e.target === panel || e.target.closest('[data-panel-close]')) { panel.close(); return; }
  const tab = e.target.closest('[data-panel-tab]');
  if (tab) { P.tab = tab.dataset.panelTab; renderPanel(false); panelTabs.querySelector(`[data-panel-tab="${P.tab}"]`)?.focus(); }
});

// Champs enregistrés dès qu'ils changent.
async function setCfg(pathStr, value) {
  const next = structuredClone(S.config);
  const keys = pathStr.split('.');
  let o = next;
  for (const k of keys.slice(0, -1)) { o[k] = o[k] || {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
  S.config = await api.saveConfig(next);
  if (pathStr.startsWith('tv.')) { S.channels = null; S.tvError = null; }
  if (pathStr.startsWith('search.')) search.resetWatch();
  if (pathStr.startsWith('downloads.')) S.dlSettings = { ...S.dlSettings, ...(S.config.downloads || {}) };
  // Réglages de l'interface (écran Réglages, P4-20) : appliqués tout de suite, comme depuis l'ancienne vue.
  if (pathStr.startsWith('ui.')) applyTheme();
  if (pathStr.startsWith('ui.menu.')) applyMenu();
  if (pathStr === 'ui.backdrop' && !value) hideBackdrop();
  toast(t('settingsView.saved'), { duration: 1500 });
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset?.tvUrl) {
    const id = t.dataset.tvUrl;
    const services = S.config.tv.services.map((x) => (x.id === id ? { ...x, url: t.value.trim() } : x));
    api.saveConfig({ ...S.config, tv: { ...S.config.tv, services } }).then((cfg) => { S.config = cfg; S.channels = null; S.tvError = null; toast('Adresse enregistrée', { duration: 1500 }); });
  } else if (t.dataset?.cfg) setCfg(t.dataset.cfg, t.value.trim());
  else if (t.dataset?.cfgBool) setCfg(t.dataset.cfgBool, t.checked);
});

/* ---------- Boîte de dialogue générique : champs, images, listes de sources ---------- */

const dlg = $('#dlg');
const dlgForm = $('#dlg-form');

// Plusieurs fenêtres peuvent être ouvertes (réglages de page, puis modification, puis choix d'une fiche) :
// la dernière ouverte est celle qui reçoit le clavier et la manette.
function openModal(d) { d.dataset.opened = String(Date.now() + Math.random()); d.showModal(); }
function topDialog() {
  return [...document.querySelectorAll('dialog[open]')].sort((a, b) => Number(a.dataset.opened || 0) - Number(b.dataset.opened || 0)).pop() || null;
}

function fieldHtml(f) {
  const id = `dlgf-${f.id}`;
  const cls = `field${f.full ? ' full' : ''}`;
  const dl = f.options?.length && f.type !== 'select' ? `<datalist id="dl-${f.id}">${f.options.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>` : '';
  if (f.type === 'select') return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><select class="input focusable" id="${id}">${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}"${val === f.value ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></div>`;
  if (f.type === 'textarea') return `<div class="${cls} full"><label for="${id}">${esc(f.label)}</label><textarea class="input focusable" id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></div>`;
  if (f.type === 'image') {
    return `<div class="${cls}"><span class="flabel">${esc(f.label)}</span><div class="img-field"><span class="img-prev${f.wide ? ' wide' : ''}" data-img="${f.id}">${f.value ? `<img alt="" src="${esc(mediaUrl(f.value))}">` : '<span>Aucune</span>'}</span>
      <div class="img-btns"><button type="button" class="btn btn-sm focusable" data-dlg="pick:${f.id}">Choisir une image</button><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="clear:${f.id}">Retirer</button></div></div></div>`;
  }
  if (f.type === 'list') {
    return `<div class="${cls} full"><span class="flabel">${esc(f.label)}</span><ul class="dlg-list" data-list="${f.id}"></ul>
      <div class="field-row"><input class="input focusable" id="${id}-new" placeholder="${esc(f.placeholder || '')}"><button type="button" class="btn btn-sm focusable" data-dlg="list-add:${f.id}">Ajouter</button><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="list-folder:${f.id}">Choisir un dossier</button></div></div>`;
  }
  const browse = f.browse ? `<button type="button" class="btn btn-sm focusable" data-dlg="browse-${f.browse}:${f.id}">Parcourir</button>` : '';
  const input = `<input class="input focusable" id="${id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"${dl ? ` list="dl-${f.id}"` : ''}${f.required ? ' required' : ''}>`;
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label>${browse ? `<div class="field-row">${input}${browse}</div>` : input}${dl}</div>`;
}

// Question oui/non (annuler un téléchargement, tout télécharger…).
async function confirmDialog(title, help, yesLabel) {
  const res = await openForm({ title, help, fields: [], actions: [{ id: 'yes', label: yesLabel, kind: 'primary' }, { id: 'no', label: 'Non', kind: 'ghost' }] });
  return res?.action === 'yes';
}

function openForm({ title, help = '', fields, actions, onAction, wide = false }) {
  $('#dlg-title').textContent = title;
  $('#dlg-help').textContent = help;
  dlg.classList.toggle('wide', wide);
  const box = $('#dlg-fields');
  box.innerHTML = fields.map(fieldHtml).join('');
  $('#dlg-actions').innerHTML = actions.map((a) => `<button type="${a.kind === 'primary' ? 'submit' : 'button'}" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'ghost' ? 'btn-ghost' : ''} focusable" data-dlg="${a.id}">${esc(a.label)}</button>`).join('');
  const lists = {};
  const renderList = (id) => {
    const ul = box.querySelector(`[data-list="${id}"]`);
    if (!ul) return;
    ul.innerHTML = lists[id].length
      ? lists[id].map((v, n) => `<li><span class="src-type">${sourceKindLabel(v)}</span><span class="src-loc">${esc(v)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="list-del:${id}:${n}">Retirer</button></li>`).join('')
      : '<li class="none">Aucune source supplémentaire.</li>';
  };
  for (const f of fields) if (f.type === 'list') { lists[f.id] = [...(f.value || [])]; renderList(f.id); }

  const form = {
    values() {
      const v = {};
      for (const f of fields) {
        if (f.type === 'list') v[f.id] = [...lists[f.id]];
        else if (f.type !== 'image') { const el = $(`#dlgf-${f.id}`); if (el) v[f.id] = el.value.trim(); }
      }
      return v;
    },
    set(id, value) { const el = $(`#dlgf-${id}`); if (el) el.value = value ?? ''; },
    setImage(id, src) { const el = box.querySelector(`[data-img="${id}"]`); if (el) el.innerHTML = src ? `<img alt="" src="${esc(mediaUrl(src))}">` : '<span>Aucune</span>'; },
    help(text) { $('#dlg-help').textContent = text; },
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = (action) => {
      if (done) return;
      done = true;
      const values = form.values();
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
      dlg.close();
      resolve({ action, values });
    };
    async function onClick(e) {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      e.preventDefault();
      const [act, id, n] = b.dataset.dlg.split(':');
      if (act === 'cancel') { finish('cancel'); return; }
      if (act === 'list-del') { lists[id].splice(Number(n), 1); renderList(id); return; }
      if (act === 'list-add') {
        const input = $(`#dlgf-${id}-new`);
        const v = input.value.trim();
        if (v && !lists[id].includes(v)) { lists[id].push(v); renderList(id); }
        input.value = '';
        return;
      }
      if (act === 'list-folder') { const p = await api.pickFolder(); if (p && !lists[id].includes(p)) { lists[id].push(p); renderList(id); } return; }
      if (act === 'browse-file') { const p = await api.pickFile('program'); if (p) form.set(id, p); return; }
      if (act === 'browse-folder') { const p = await api.pickFolder(); if (p) form.set(id, p); return; }
      if (b.type === 'submit' && !dlgForm.reportValidity()) return;
      const keepOpen = onAction ? await onAction(b.dataset.dlg, form) : false;
      if (!keepOpen) finish(b.dataset.dlg);
    }
    function onCancel(e) { e.preventDefault(); finish('cancel'); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    openModal(dlg);
    (box.querySelector('input, textarea') || dlg.querySelector('[data-dlg]'))?.focus();
  });
}
dlgForm.addEventListener('submit', (e) => e.preventDefault());

/* ---------- Choisir la bonne fiche parmi celles trouvées en ligne ---------- */

const pickDlg = $('#pick');
function pickCandidate(items, { title, help }) {
  $('#pick-title').textContent = title;
  $('#pick-help').textContent = help || '';
  const grid = $('#pick-grid');
  grid.innerHTML = items.map((c, n) => `<button type="button" class="pick-card focusable" data-pick="${n}">
      <span class="pick-art">${c.image ? `<img alt="" loading="lazy" src="${esc(c.image)}"${c.fallback ? ` data-fallback="${esc(c.fallback)}"` : ''}>` : ''}<span class="pick-mono">${esc(monogram(c.title))}</span></span>
      <span class="pick-title">${esc(c.title)}</span>
      <span class="pick-sub">${esc([c.year, c.sub].filter(Boolean).join(', '))}</span>
    </button>`).join('');
  // Image manquante : on essaie la vignette de secours, sinon on garde l'initiale.
  for (const img of grid.querySelectorAll('img')) {
    img.addEventListener('error', () => { if (img.dataset.fallback) { img.src = img.dataset.fallback; delete img.dataset.fallback; } else img.remove(); });
  }
  return new Promise((resolve) => {
    const done = (v) => { pickDlg.removeEventListener('click', onClick); pickDlg.removeEventListener('cancel', onCancel); pickDlg.close(); resolve(v); };
    function onClick(e) {
      const b = e.target.closest('[data-pick]');
      if (b) { done(items[Number(b.dataset.pick)]); return; }
      if (e.target.closest('[data-pick-cancel]')) done(null);
    }
    function onCancel(e) { e.preventDefault(); done(null); }
    pickDlg.addEventListener('click', onClick);
    pickDlg.addEventListener('cancel', onCancel);
    openModal(pickDlg);
    grid.querySelector('.pick-card')?.focus();
  });
}

/* ---------- Modifier un média ou un jeu ---------- */

const EDIT_FIELDS = {
  video: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
  album: ['title', 'artist', 'year', 'genre', 'image', 'backdrop'],
  track: ['title', 'genre'],
  image: ['title', 'genre'],
  rom: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
  game: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
};
const FIELD_LABELS = { title: 'Titre', artist: 'Artiste', year: 'Année', genre: 'Genre', overview: 'Résumé', image: 'Image', backdrop: 'Fond d’écran' };

// Genres déjà utilisés, proposés dans la liste du champ Genre.
function knownGenres(kind) {
  const pool = kind === 'video' ? S.videos : kind === 'album' || kind === 'track' ? S.tracks : kind === 'image' ? S.images : kind === 'game' ? pcGameEntries() : (S.roms || Object.values(S.localRoms).flat()).map((r) => ({ ...r, kind: 'rom' }));
  const set = new Set();
  for (const it of pool) for (const g of genresOf(withScrape(it))) set.add(g);
  return [...set].sort(collator.compare);
}

// Valeurs « d'origine » (fichier et infos en ligne), sans les modifications manuelles.
function baseValues(kind, it) {
  const sc = kind === 'track' ? {} : S.scrape[kind === 'album' ? `a:${it.dir}` : scrapeKey(it)] || {};
  const m = kind === 'album' ? splitAlbumFolder(it.folder) : null;
  const title = {
    video: sc.series ? it.name : (sc.title || it.name),
    album: m ? m.album : (sc.title || it.folder),
    track: cleanTrack(it.name),
    image: it.name,
    rom: sc.title || it.displayName || it.name,
    game: sc.title || it.name,
  }[kind];
  return {
    title,
    artist: kind === 'album' ? (m ? m.artist : sc.artist || '') : '',
    year: sc.year || '',
    genre: sc.genre || '',
    overview: sc.overview || '',
    image: it.cover || it.image || sc.image || '',
    backdrop: it.fanart || sc.backdrop || '',
  };
}

// Un jeu présent sur l'ordinateur peut être supprimé (jeu PC manuel ou fichier de console local).
function deletableGame(ref) {
  const it = ref?.item;
  if (!it) return false;
  if (ref.kind === 'rom') return !it.remote;
  if (ref.kind === 'game') return !it.auto;
  return false;
}
async function deleteGameRef(ref) {
  const it = ref.item;
  const payload = { kind: ref.kind, path: it.path, label: labelOf(it), manualIndex: it.manualIndex, consoleId: it.consoleId != null ? it.consoleId : (ref.kind === 'rom' ? S.romsOf : undefined) };
  const ok = await confirmDialog(`Supprimer « ${payload.label} » ?`, ref.kind === 'rom' ? 'Le fichier du jeu sera supprimé de l’ordinateur.' : 'Le jeu sera retiré de la liste.', 'Supprimer');
  if (!ok) return;
  const r = await api.gameDelete(payload);
  if (!r?.ok) { toast(r?.error || 'Suppression impossible.', { duration: 8000 }); return; }
  if (r.config) S.config = r.config;
  if (ref.kind === 'rom' && payload.consoleId != null) { const rr = await api.listRoms(payload.consoleId); if (rr?.ok) { S.localRoms[payload.consoleId] = rr.roms; if (S.romsOf === payload.consoleId) S.roms = rr.roms; } }
  else S.autoGames = S.autoGames.filter((g) => g.path !== payload.path);
  toast('Jeu supprimé');
  render();
}

async function editRef(ref) {
  if (!ref) return;
  if (ref.kind === 'console') { editConsole(ref.consoleId); return; }
  if (!ref.item || !EDIT_FIELDS[ref.kind]) return;
  const kind = ref.kind;
  const it = ref.item;
  const key = metaKey(it, kind);
  const base = baseValues(kind, it);
  const cur = () => ({ ...base, ...(S.meta[key] || {}) });
  const v = cur();
  const manualGame = kind === 'game' && it.manualIndex != null ? S.config.games[it.manualIndex] : null;
  const fields = EDIT_FIELDS[kind].map((f) => {
    if (f === 'image' || f === 'backdrop') return { id: f, type: 'image', label: FIELD_LABELS[f], value: v[f], wide: f === 'backdrop' };
    if (f === 'overview') return { id: f, type: 'textarea', label: FIELD_LABELS[f], value: v[f] };
    if (f === 'genre') return { id: f, label: 'Genre (plusieurs : séparés par des virgules)', value: v[f], options: knownGenres(kind), full: true };
    return { id: f, label: FIELD_LABELS[f], value: v[f], full: f === 'title' };
  });
  if (manualGame) {
    fields.push({ id: 'gpath', label: 'Programme ou raccourci', value: manualGame.path, browse: 'file', full: true });
    fields.push({ id: 'gargs', label: 'Arguments', value: D.joinArgs(manualGame.args || []), full: true });
  }
  const canScrape = ['video', 'album', 'rom', 'game'].includes(kind);
  const actions = [
    { id: 'save', label: 'Enregistrer', kind: 'primary' },
    ...(canScrape ? [{ id: 'scrape', label: 'Rechercher en ligne' }] : []),
    { id: 'reset', label: 'Réinitialiser', kind: 'ghost' },
    { id: 'cancel', label: 'Annuler', kind: 'ghost' },
  ];
  const kindWord = { video: 'la vidéo', album: 'l’album', track: 'le morceau', image: 'l’image', rom: 'le jeu', game: 'le jeu' }[kind];
  const res = await openForm({
    title: `Modifier ${kindWord}`,
    help: (() => { const p = it.path || it.dir || ''; try { return it.remote ? decodeURI(p) : p; } catch { return p; } })(),
    fields,
    actions,
    wide: fields.length > 3,
    async onAction(action, form) {
      const [act, field] = action.split(':');
      if (act === 'pick') {
        const m = await api.metaPickImage(key, field);
        if (m) { S.meta[key] = m; form.setImage(field, m[field]); }
        return true;
      }
      if (act === 'clear') {
        const m = await api.metaSet(key, { [field]: '' });
        if (m) S.meta[key] = m; else delete S.meta[key];
        form.setImage(field, base[field]);
        return true;
      }
      if (act === 'scrape') {
        const val = form.values();
        form.help('Recherche des fiches…');
        const job = {
          video: { kind: 'video', item: { path: it.path, name: it.name, dir: it.dir } },
          album: { kind: 'album', item: { dir: it.dir, folder: it.folder } },
          rom: { kind: 'rom', item: { path: it.path, name: it.name, displayName: it.displayName, emu: ref.emu } },
          game: { kind: 'pc', item: { name: it.name, path: it.path } },
        }[kind];
        const found = await api.scrapeCandidates({ ...job, query: val.title, year: val.year, artist: val.artist });
        if (!found?.ok) { form.help(found?.error || 'La recherche n’a pas abouti.'); return true; }
        if (!found.items.length) { form.help('Aucune fiche trouvée avec ce titre. Essayez une autre orthographe, puis « Rechercher en ligne ».'); return true; }
        const pick = await pickCandidate(found.items, {
          title: 'Choisir la bonne fiche',
          help: `${plural(found.items.length, 'fiche trouvée', 'fiches trouvées')} pour « ${val.title} ». Les plus proches du titre sont en premier.`,
        });
        if (!pick) { form.help('Aucune fiche choisie.'); return true; }
        form.help(`Récupération de « ${pick.title} »…`);
        const r = await api.scrapeOne({ ...job, override: { pick } });
        if (!r?.ok) { form.help(r?.error || 'Impossible de récupérer cette fiche.'); return true; }
        S.scrape = (await api.scrapeData()) || {};
        const nb = baseValues(kind, it);
        Object.assign(base, nb);
        for (const f of EDIT_FIELDS[kind]) {
          if (f === 'image' || f === 'backdrop') { if (!S.meta[key]?.[f]) form.setImage(f, nb[f]); } else form.set(f, nb[f]);
        }
        // Les champs prennent les nouvelles valeurs : on retire les anciennes saisies qui les masqueraient.
        if (S.meta[key]) {
          const cleared = await api.metaSet(key, { title: '', year: '', genre: '', overview: '', artist: '' });
          if (cleared) S.meta[key] = cleared; else delete S.meta[key];
        }
        form.help(`Fiche « ${pick.title} » récupérée : vérifiez les champs, puis enregistrez.`);
        return true;
      }
      if (act === 'reset') { await api.metaReset(key); delete S.meta[key]; return false; }
      if (act === 'save') {
        const val = form.values();
        const patch = {};
        for (const f of EDIT_FIELDS[kind]) if (f !== 'image' && f !== 'backdrop') patch[f] = val[f] === base[f] ? '' : val[f];
        const m = await api.metaSet(key, patch);
        if (m) S.meta[key] = m; else delete S.meta[key];
        if (manualGame) {
          const next = structuredClone(S.config);
          next.games[it.manualIndex] = { ...manualGame, path: val.gpath || manualGame.path, args: D.parseArgs(val.gargs || '') };
          S.config = await api.saveConfig(next);
        }
        return false;
      }
      return false;
    },
  });
  if (res && res.action !== 'cancel') {
    if (res.action === 'save') toast('Modifications enregistrées');
    if (res.action === 'reset') toast('Infos d’origine rétablies');
  }
  // Les fiches modifiées pendant l'édition (images) sont à jour : on réaffiche la vue en gardant le focus.
  S.focusRef = null;
  render();
}

/* ---------- Modifier une console : programme, dossiers et sources de jeux ---------- */

async function editConsole(i) {
  const e = consoleOf(i);
  if (!e) return;
  let banner = e.banner || '';
  const siteInfo = await api.romSites(i);
  const sitesText = D.sitesToText(siteInfo?.sites);
  const res = await openForm({
    title: `Modifier la console ${e.name}`,
    help: 'Les sources supplémentaires peuvent être des dossiers, des partages réseau ou des adresses web (une page qui liste les fichiers). Un jeu d’une source web est téléchargé une fois dans le cache de Mire avant d’être lancé.',
    wide: true,
    fields: [
      { id: 'name', label: 'Nom', value: e.name, required: true },
      { id: 'system', label: 'Système (pour les jaquettes et genres)', value: e.system || '', options: D.SYSTEM_IDS },
      { id: 'path', label: 'Émulateur', value: e.path, browse: 'file', full: true, required: true },
      { id: 'args', label: 'Arguments ({rom} = chemin du jeu)', value: D.joinArgs(e.args?.length ? e.args : ['{rom}']), full: true },
      { id: 'romsDir', label: 'Dossier principal des jeux (téléchargements et imports)', value: e.romsDir || '', browse: 'folder', full: true },
      { id: 'sources', type: 'list', label: 'Sources supplémentaires', value: e.sources || [], placeholder: '\\\\NAS\\Jeux\\SNES, smb://nas/jeux ou http://…/snes/' },
      { id: 'extensions', label: 'Extensions des jeux (séparées par des virgules)', value: (e.extensions || []).join(', '), full: true },
      { id: 'imagesDir', label: 'Dossier de jaquettes (facultatif)', value: e.imagesDir || '', browse: 'folder', full: true },
      { id: 'banner', type: 'image', label: 'Bannière (affichée dans Jeux)', value: e.banner || '', wide: true },
      { id: 'romSites', type: 'textarea', rows: 5, label: 'Sites pour « Ajouter des jeux » : un par ligne, « Nom | adresse | adresse de recherche avec {q} » (la recherche est facultative, la loupe permet de la mémoriser). Videz le champ pour revenir aux sites proposés par Mire.', value: sitesText },
    ],
    actions: [{ id: 'save', label: 'Enregistrer', kind: 'primary' }, { id: 'delete', label: 'Supprimer la console', kind: 'ghost' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
    async onAction(action, form) {
      if (action === 'pick:banner') { const p = await api.pickImageFile('Choisir la bannière de la console'); if (p) { banner = p; form.setImage('banner', p); } return true; }
      if (action === 'clear:banner') { banner = ''; form.setImage('banner', ''); return true; }
      return false;
    },
  });
  if (!res || res.action === 'cancel') return;
  const next = structuredClone(S.config);
  if (res.action === 'delete') {
    const confirm = await openForm({
      title: `Supprimer la console ${e.name} ?`,
      help: 'Seule la console disparaît de Mire : l’émulateur et vos jeux restent sur le disque.',
      fields: [],
      actions: [{ id: 'yes', label: 'Supprimer', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
    });
    if (confirm?.action !== 'yes') return;
    next.emulators = next.emulators.filter((x) => x.id !== i);
    S.config = await api.saveConfig(next);
    S.romsCache = {};
    refreshPanel();
    if (S.romsOf === i) closeRoms(); else if (!panel.open) render();
    toast('Console supprimée');
    return;
  }
  const v = res.values;
  const at = next.emulators.findIndex((x) => x.id === i);
  if (at < 0) return;
  next.emulators[at] = {
    ...e,
    name: v.name || e.name,
    system: v.system,
    path: v.path || e.path,
    args: D.parseArgs(v.args || '{rom}'),
    romsDir: v.romsDir,
    sources: v.sources,
    extensions: v.extensions.split(/[,;\s]+/).filter(Boolean).map((x) => (x.startsWith('.') ? x : `.${x}`).toLowerCase()),
    imagesDir: v.imagesDir,
    banner,
  };
  // Sites : on ne garde une liste propre à la console que si elle diffère de celle proposée par Mire.
  const parsedSites = D.parseSites(v.romSites);
  if (!v.romSites.trim() || JSON.stringify(parsedSites) === JSON.stringify(siteInfo?.defaults || [])) delete next.emulators[at].romSites;
  else next.emulators[at].romSites = parsedSites;
  delete S.romSites[i];
  S.config = await api.saveConfig(next);
  S.romsCache = {};
  toast('Console enregistrée');
  refreshPanel();
  if (S.romsOf === i) openEmu(i); else if (!panel.open) render();
}

/* ---------- Fond d'écran de l'élément sélectionné ---------- */

const backdropEl = $('#backdrop');
let bdTimer = 0;
let bdCurrent = '';
function backdropFor(ref) {
  const it = ref?.item;
  if (!it) return null;
  if (ref.kind === 'image') return it.native ? it.path : null;
  if (ref.kind === 'album' || ref.kind === 'track') return it.sBackdrop || it.uImage || it.cover || it.sImage || null;
  return it.sBackdrop || null;
}
function showBackdrop(src) {
  if (S.config?.ui?.backdrop === false || !src || src === bdCurrent) return;
  clearTimeout(bdTimer);
  bdTimer = setTimeout(() => {
    bdCurrent = src;
    const url = mediaUrl(src);
    const img = new Image();
    img.onload = () => {
      if (bdCurrent !== src) return;
      const [a, b] = backdropEl.children;
      const next = a.classList.contains('on') ? b : a;
      const prev = next === a ? b : a;
      next.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      next.classList.add('on');
      prev.classList.remove('on');
      backdropEl.classList.add('show');
    };
    img.src = url;
  }, 140);
}
function hideBackdrop() {
  clearTimeout(bdTimer);
  bdCurrent = '';
  backdropEl.classList.remove('show');
  for (const l of backdropEl.children) l.classList.remove('on');
}
function onHoverItem(target) {
  const ref = refFromEl(target);
  if (!ref) return;
  if (ref.kind === 'console') {
    updateFocusInfo(target);
    const banner = consoleOf(ref.consoleId)?.banner;
    if (banner) showBackdrop(banner);
    return;
  }
  if (!ref.item) return;
  updateFocusInfo(target);
  const it = ref.item.sBackdrop !== undefined ? ref.item : withScrape(ref.item);
  const consoleBanner = ref.kind === 'rom' ? consoleOf(S.romsOf)?.banner : null;
  showBackdrop(backdropFor({ ...ref, item: it }) || consoleBanner);
}

viewEl.addEventListener('focusin', (e) => onHoverItem(e.target));
viewEl.addEventListener('mouseover', (e) => { const t = e.target.closest('.tile, .track, .emu, .album-actions [data-action="play-album"]'); if (t) onHoverItem(t); });
// Clic droit sur un média ou un jeu : le modifier.
viewEl.addEventListener('contextmenu', (e) => {
  const ref = refFromEl(e.target);
  if (!ref) return;
  e.preventDefault();
  editRef(ref);
});

/* ------------------------------------------------------------------ */
/* Boutique (vue : Centre, P4-18)                                      */
/* ------------------------------------------------------------------ */

async function loadCatalog() {
  S.catalog = await api.storeCatalog();
  if (S.section === CENTRE_VIEW) centre.refresh();
}

// Avancement d'une installation (données du processus principal, rédigées par le Centre). La fin est traitée par
// l'action qui l'a lancée (afterStoreChange) ; une erreur est annoncée ici.
api.onStoreProgress((p) => {
  S.storeProgress[p.id] = p;
  if (p.phase === 'error') toast(p.message || t('centre.apps.messages.installFailed'), { duration: 9000 });
  if (p.phase !== 'done' && p.phase !== 'error' && S.section === CENTRE_VIEW) centre.refresh();
});

/* Plugins et dépôts (vue : Centre, P4-19) */

async function loadPlugins() {
  const [installed, available, repos] = await Promise.all([api.pluginsList(), api.reposPlugins(), api.reposList()]);
  const list = (x) => (Array.isArray(x) ? x : []);
  S.plugins = { installed: list(installed), available: list(available), repos: list(repos) };
  if (S.section === CENTRE_VIEW) centre.refresh();
}

// Avancement d'une installation de plugin : des données, rédigées par le Centre ; la fin (réussite ou erreur) est
// annoncée par l'action qui l'a lancée.
api.onPluginsProgress((p) => {
  if (p.phase === 'done' || p.phase === 'error') delete S.pluginProgress[p.id];
  else S.pluginProgress[p.id] = p;
  if (S.section === CENTRE_VIEW) centre.refresh();
});

async function afterStoreChange(r, okMessage) {
  if (r?.config) S.config = r.config;
  else S.config = (await api.getConfig()).config;
  S.romsCache = {};
  await loadCatalog();
  if (!panel.open && [CENTRE_VIEW, 'games'].includes(S.section)) render();
  if (r?.ok && okMessage) toast(okMessage, { duration: 6000 });
}

/* Délégation des clics dans la vue */
/* ---------- Contrôleurs (P4-04) : les actions de l'interface, et le pont des data-action historiques ---------- */

// Opérations des vues historiques dont les contrôleurs ont besoin, tant qu'elles ne sont pas remplacées.
const legacyUi = {
  render, go, back, nextSection, webHome, openPageSettings, refreshPanel, confirm: confirmDialog,
  isPanelOpen: () => panel.open,
  revealSettings(blockId) {
    go(SETTINGS_VIEW);
    settings.focus(blockId.replace(/^set-/, ''));
  },
  selectedRef: () => refFromEl(document.activeElement),
  selectedKey: () => cardKeyOf() ?? (S.section === EXPLORER_VIEW ? explorer.selectedKey() : null),
  selectedGroup: () => groupRefOf(document.activeElement, pages.route()),
  afterEdit: () => { if (S.section === SEARCH_VIEW) search.refresh(); },
  // Pages créées, modifiées ou supprimées (P4-21) : le menu suit.
  async reloadPages() {
    const list = await api.pagesList().catch(() => null);
    if (Array.isArray(list)) shell.setPages(list);
  },
  firstItemRef: () => refFromEl(viewEl.querySelector('.tile, .track')),
  editRef, editConsole, deletableGame, deleteGameRef,
  afterConsolesChange(config) {
    S.config = config;
    S.romsCache = {};
    S.romSites = {};
    refreshPanel();
    if (S.section === CENTRE_VIEW) centre.refresh();
    else if (!panel.open) render();
  },
  consoleName: (id) => consoleOf(id)?.name,
  openFileDialog, scan, addSourceFolder, askSourceAddress, removeSource, startScrape, updateScrapeButton, reloadScrape,
  playInContext, playRecent, openVideo, playQueue, openImages,
  pauseAudio: () => audio.pause(),
  toggleAudio, openExternal, addRecent, video: videoUi, music: musicUi, images: imagesUi,
  playChannel, loadChannels,
  launchEntry, launchRom, downloadGameBookmark, cleanupGames, addGame, openEmu, closeRoms, openRomBrowser, loadLocalRoms,
  openWeb, openTvWeb, openBookmark, bookmarkCurrentPage, bookmarkCurrentGame, learnSearch, syncWeb, refreshWebBar,
  getQueries, rememberQuery, search, explorer, settings,
  rescue: { themes: pageThemes, refresh: () => rescue.refresh() },
  loadDownloads, updateDlBadge, loadCatalog, afterStoreChange,
  showCentreTab: (tab) => { centre.showTab(tab); if (S.section === CENTRE_VIEW) render(); }, afterAdblockChange, setCfg, saveUi, applyMenu,
  loadPlugins,
  refreshCentre(focus) {
    if (focus) centre.focusAfterRender(focus);
    centre.refresh();
  },
  open: (target, opts) => shell.open(target, opts),
  cycle: (step) => shell.cycle(step),
  openPageGroup: (value) => pages.openGroup(value),
  openPagePath: (path) => pages.openPath(path),
  loadMorePage: () => pages.loadMore(),
  pageLegacySection: () => pages.legacySection(),
  // Site ouvert, choisi dans le menu : un portail de télévision, les sites d'une console, un marque-page ou un service.
  openSite(id) {
    if (id.startsWith('tv:')) callAction('mire-web', 'openPortal', { id: id.slice(3) });
    else if (id.startsWith('rom:')) callAction('mire-page', 'openRomSites', { consoleId: id.slice(4) });
    else if (id.startsWith('bm:')) callAction('mire-web', 'openBookmark', { id: id.slice(3) });
    else callAction('mire-web', 'open', { id });
  },
};
// Boîtes de dialogue sur les composants (P4-06) : la vue web native se masque tant qu'une boîte est ouverte.
dialogs.initDialogs({
  t,
  pickFile: () => api.pickFile('program'),
  pickFolder: () => api.pickFolder(),
  onOpenChange: () => syncWeb(),
  toastWithAction: (message, opts) => toast(message, opts),
});
initDemoDialogs({ openForm });
const C = createControllers({ S, api, toast, t, plural: explorerPlural, ui: legacyUi, page: PAGE, dialogs: { act: dialogs.dialogAction, form: dialogs.openForm, pick: dialogs.pickCandidate } });
// Jeux (P4-17) : hôte des actions de `mire-games` ; un jeu ouvre sa boîte (émulateur, lancer, infos, supprimer).
document.body.appendChild(document.createElement('mire-games'));
initEditors(document, (key) => (isGameKey(key) || isGameBookmarkKey(key) ? C.games.gameOptions({ key }) : C.editor.edit({ key })), (node) => {
  const ref = groupRefOf(node, pages.route());
  if (ref) C.editor.editGroup(ref);
  return ref;
});
setActionErrorHandler((error, { tag, method }) => {
  console.error(`Action ${tag}.${method} :`, error);
  toast(t('app.errors.actionFailed'), { duration: 6000 });
});
const legacyView = { root: viewEl, refreshOrderList };

function onActionClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !e.currentTarget.contains(el)) return;
  // Une liste déroulante agit quand on change sa valeur, pas quand on clique dessus.
  if (el.tagName === 'SELECT') return;
  runLegacyAction(el, legacyView);
}
viewEl.addEventListener('click', onActionClick);
panelBody.addEventListener('click', onActionClick);

let searchTimer = 0;
// Menus déroulants de l'en-tête (filtres Jeux, service de télé).
headerToolsEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tv-service') {
    api.tvSetActive(t.value).then((cfg) => { S.config = cfg; S.channels = null; S.tvWeb = null; S.tvError = null; loadChannels(); });
    return;
  }
  if (t.dataset.searchSource) {
    S.searchSource[t.dataset.searchSource] = t.value;
    S.limit = PAGE;
    render({ resetScroll: true });
  }
});
headerToolsRightEl.addEventListener('click', (e) => {
  // Téléchargement de jeux.
  const dl = e.target.closest('[data-action="games-download"]');
  if (dl) {
    if (dl.dataset.id === 'pc') onActionClick({ target: dl, currentTarget: headerToolsRightEl });
    else callAction('mire-page', 'openRomSites', { consoleId: Number(dl.dataset.id) });
    return;
  }
  // Ouvrir/fermer un menu (filtre, tri).
  const toggle = e.target.closest('[data-menu]');
  if (toggle) {
    const pop = toggle.nextElementSibling;
    const open = pop.hidden;
    closeHeaderMenus();
    if (open) { pop.hidden = false; toggle.setAttribute('aria-expanded', 'true'); pop.querySelector('.hdr-opt')?.focus(); }
    return;
  }
  // Choix dans un menu : l'action est traitée par onActionClick, puis le menu se ferme.
  const opt = e.target.closest('.hdr-opt');
  if (opt) { onActionClick({ target: opt, currentTarget: headerToolsRightEl }); closeHeaderMenus(); }
});
function closeHeaderMenus() {
  for (const pop of headerToolsRightEl.querySelectorAll('.hdr-pop')) pop.hidden = true;
  for (const t of headerToolsRightEl.querySelectorAll('[data-menu]')) t.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', (e) => { if (!e.target.closest('.hdr-menu')) closeHeaderMenus(); });

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.query = searchEl.value.trim(); S.limit = PAGE; render({ resetScroll: true }); }, 140);
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); clearTimeout(searchTimer); S.query = searchEl.value.trim(); render(); focusFirst(); }
});

/* ------------------------------------------------------------------ */
/* Lecteurs intégrés, clavier et manette (players/, nav/)              */
/* ------------------------------------------------------------------ */

initAudio(C);
initVideo(C);
initImages(C);

// Contexte des touches et de la manette : la dernière boîte de dialogue ouverte, puis les lecteurs, puis le site affiché.
function padContext() {
  if (topDialog()) return 'dialog';
  if (isVideoOpen()) return 'video';
  if (isImagesOpen()) return 'image';
  if (S.section === 'web' && webShouldShow()) return 'web';
  return 'list';
}

initKeyboard({
  dialog: topDialog,
  overlayKey: (key, fromPad) => (isVideoOpen() ? videoKey(key, fromPad) : isImagesOpen() ? imageKey(key, fromPad) : null),
  webBarDown: (el) => {
    if (S.section !== 'web' || !el?.closest('mire-webbar')) return false;
    C.web.focusSite();
    return true;
  },
}, C);

initGamepad({
  context: padContext,
  dialog: topDialog,
  // Mode secours (P4-10) : Affichage + Menu ouvrent l'explorateur, quel que soit le thème.
  rescue: () => rescue.request({ reason: 'pad' }),
}, C);

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => (isVideoOpen() ? video.play().catch(() => {}) : audio.play().catch(() => {})));
  ms.setActionHandler('pause', () => (isVideoOpen() ? video.pause() : audio.pause()));
  ms.setActionHandler('previoustrack', () => (isVideoOpen() ? stepVideo(-1) : stepTrack(-1)));
  ms.setActionHandler('nexttrack', () => (isVideoOpen() ? stepVideo(1) : stepTrack(1)));
}

/* ------------------------------------------------------------------ */
/* Glisser-déposer, horloge, images manquantes                         */
/* ------------------------------------------------------------------ */

const dropEl = $('#drop');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth += 1;
  dropEl.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth -= 1;
  if (dragDepth <= 0) { dragDepth = 0; dropEl.hidden = true; }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) openItems(await api.fromPaths(paths));
});

// Une vignette qui ne se charge pas laisse place au carton titre.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el?.tagName !== 'IMG') return;
  if (el.closest('.art')) el.remove();
}, true);

function tick() {
  const now = new Date();
  shell.tick(now);
  home.tick(now);
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

(async function init() {
  // Traduction : catalogues demandés pendant le reste du démarrage (lang du document, textes des contrôleurs).
  const i18nReady = i18n.start(api);
  const pages = api.pagesList().catch(() => null);
  for (const el of $$('[data-icon]')) el.innerHTML = ICON[el.dataset.icon] || '';
  const res = await api.getConfig();
  S.config = res.config;
  S.configPath = res.configPath;
  S.platform = res.platform;
  applyTheme();
  applyMenu();
  // Textes de la coquille et pages épinglées au menu avant le premier écran.
  await i18nReady;
  const list = await pages;
  shell.setPages(Array.isArray(list) ? list : null);
  S.scrape = (await api.scrapeData()) || {};
  S.meta = (await api.metaAll()) || {};
  S.adblock = await api.adblockStatus();
  loadDownloads();
  loadLocalRoms();

  await loadUsage();
  setVolume(S.usage.volume);

  go(HOME_VIEW, { focus: 'content' });
  // Mode secours (P4-10) : premier écran demandé (option, touche maintenue, plantages) ou thème déjà en échec.
  rescue.start(await api.rescueStart().catch(() => null));
  tick();
  setInterval(tick, 5000);

  api.onOpenFiles(openItems);
  S.webSessions = (await api.webSessions()) || [];
  renderRailSessions();
  const pending = await api.takePendingFiles();
  if (pending?.length) openItems(pending);

  startGamepad();
  scan();

  // Page de démarrage choisie dans Réglages.
  const start = S.config.ui.start || 'home';
  if (!pending?.length) {
    if (start.startsWith('web:')) openWeb(start.slice(4));
    else if (start !== 'home' && targetOfLegacyView(start)) shell.open(targetOfLegacyView(start), { focus: 'content' });
  }
})();
