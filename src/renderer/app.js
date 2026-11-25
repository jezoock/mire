/* Mire : interface. Affichage des sections et actions ; les lecteurs intégrés (players/) et la navigation au clavier
   et à la manette (nav/) sont branchés plus bas, avec ce qu'ils attendent de l'interface. */
import { $, $$, esc } from './core/dom.ts';
import { plural } from './core/format.ts';
import { ICON } from './core/icons.ts';
import { onColor, safeColor } from './core/colors.ts';
import { toast } from './ui/toast.ts';
import * as dialogs from './ui/dialogs.ts';
import { PAGE, S } from './state/index.ts';
import { api } from './api/index.ts';
import { DEFAULT_PALETTE, fold, isSiteAvailable } from '@mire/shared';
import * as D from './domain/index.ts';
import { collator } from './domain/index.ts';
import { focusSelectorOf } from './nav/spatial.ts';
import { focusFirst, restoreFocus } from './nav/focus.ts';
import { pendingFocusDue } from './nav/targets.ts';
import { initKeyboard } from './nav/keyboard.ts';
import { initGamepad, startGamepad } from './nav/gamepad.ts';
import { setVolume } from './players/volume.ts';
import { audio, initAudio, musicUi, playQueue, stepTrack, toggleAudio } from './players/audio.ts';
import { initVideo, isVideoOpen, openVideo, stepVideo, video, videoKey, videoUi } from './players/video.ts';
import { imageKey, imagesUi, initImages, isImagesOpen, openImages } from './players/images.ts';
import { createPaletteLoader } from '@mire/ui/palettes';
import { DEMO_SECTION, demoTitle, initDemoDialogs, isDemoHash, loadDemoTexts, viewDemo } from './demo/index.ts';
import { createControllers } from './controllers/index.ts';
import { callAction, setActionErrorHandler } from './controllers/registry.ts';
import { i18n, t } from './i18n/index.ts';
import { CENTRE_VIEW, EXPLORER_VIEW, HOME_VIEW, PAGE_VIEW, SEARCH_VIEW, SETTINGS_VIEW, createShell, legacySectionOf, settingsPartOf, targetOfLegacyView } from './shell/index.ts';
import { createPages } from './pages/index.ts';
import { createHome, homeOptions } from './home/index.ts';
import { createSearch } from './search/index.ts';
import { createWeb, webHome as webHomeOf } from './web/index.ts';
import { createExplorer } from './explorer/index.ts';
import { adblockStatusText, createSettings, drmStatusText } from './settings/index.ts';
import { cardKeyOf, groupRefOf, initEditors } from './editors/index.ts';
import { consoleCards, isGameBookmarkKey, isGameKey } from './games/model.ts';
import { STEP_FOCUS, createAssistant } from './assistant/index.ts';
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
const pcGameEntries = () => D.pcGameEntries(S.config.games, S.autoGames, infos());

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

// S, Q, V et I sont déclarés dans state/.

// Le réglage « thème » désigne une palette (P4-02) ; le chargeur suit aussi le mode du système (« Automatique »).
const palette = createPaletteLoader();
// Palettes des plugins (P5-02) : la feuille de chacune est fabriquée par le chargeur à partir de jetons vérifiés. Une
// palette choisie absente (plugin pas encore installé, désactivé) laisse place à la palette par défaut, avec un message.
let pluginPalettes = [];
palette.onMissing(() => toast(t('settingsView.palettes.missing', { name: t(`palettes.${DEFAULT_PALETTE}`) }), { duration: 8000 }));
async function loadPluginPalettes() {
  const info = await api.palettesList().catch(() => null);
  if (!info) return;
  pluginPalettes = info.palettes;
  palette.setPlugins(info);
  if (S.section === SETTINGS_VIEW) settings.refresh();
}
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
  sites: () => (S.config?.web ?? []).filter(isSiteAvailable),
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

// Assistant du premier lancement (P4-23) : section sans cible du routeur, ouverte au démarrage d'une nouvelle
// installation ou depuis les Réglages ; il installe par les dépôts, comme le Centre.
const ASSISTANT_VIEW = 'assistant';
const assistant = createAssistant({
  t,
  language: () => i18n.language,
  show: () => go(ASSISTANT_VIEW, { focus: 'content' }),
  leave(to) {
    if (to === 'centre') {
      centre.showTab('plugins');
      shell.open('screen:center', { focus: 'content' });
    } else go(HOME_VIEW, { focus: 'content' });
  },
  onLanguageChange: (listener) => i18n.onChange(listener),
  // Étape changée : le focus va au premier choix (ou au bouton principal) ; s'il s'est perdu, au contenu.
  onRendered: () => {
    if (S.section !== ASSISTANT_VIEW) return;
    if (assistant.takeFocus()) return restoreFocus({ el: null, sel: `#view mire-assistant ${STEP_FOCUS}` });
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) focusFirst();
  },
});

// Recherche (P4-13) : le catalogue groupé par page, « Où regarder » et les sites, rédigés par les catalogues.
const search = createSearch({
  t,
  raw: (key) => i18n.raw(key),
  catalog: (q) => api.catalogSearch(q),
  watch: (q) => api.searchStreaming(q),
  pages: () => shell.pages(),
  sites: () => (S.config?.web ?? []).filter(isSiteAvailable),
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
    sites: (S.config?.web ?? []).filter(isSiteAvailable),
    pageThemes: pages.engine.list().map((th) => ({ id: th.id, name: themeText(th.name), description: th.description ? themeText(th.description) : '' })),
    currentPageTheme: pages.engine.current().id,
    homeLists: ['rows', 'bars', 'sites'].map((kind) => ({ kind, label: t(`home.settings.${kind}`), items: homeOptions(S.config.ui.home, kind, { t, pages: shell.pages(), lists: home.lists(), sites: S.config.web, color: safeColor }) })),
    adblockStatus: S.adblock ? adblockStatusText(S.adblock, t, (d) => i18n.engine?.formatDate(d) ?? d.toLocaleDateString()) : '',
    drmStatus: drmText,
    configPath: S.configPath,
    sourceStatus: S.sourceStatus,
    gameSourceStatus: S.gameSourceStatus,
    scanning: !!S.scanning,
    pluginPalettes: pluginPalettes.map((p) => ({ id: p.id, name: p.name })),
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


const viewEl = $('#view');

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
  if (changed) S.draft = null;
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
}

// Page de démonstration de l'interface (P4-01), cachée : ouverte par l'adresse #demo (voir demo/index.ts).
async function openDemoFromHash() {
  if (!isDemoHash(location.hash)) return;
  await loadDemoTexts();
  go(DEMO_SECTION, { focus: 'content' });
}
addEventListener('hashchange', openDemoFromHash);

function back() {
  if (S.section === PAGE_VIEW && pages.back()) return;
  if (S.section === EXPLORER_VIEW && explorer.back()) return;
  if (S.section === 'web') { openWebHome(webHome()); return; }
  if (S.section !== HOME_VIEW) go(HOME_VIEW, { focus: 'content' });
}

function render({ resetScroll = false } = {}) {
  const active = document.activeElement;
  const hadFocus = viewEl.contains(active);
  const selector = hadFocus ? focusSelectorOf(active) : null;

  const sec = S.section;
  document.body.dataset.accent = sec === PAGE_VIEW ? (legacySectionOf(shell.router.current().target) ?? '') : sec;
  const title = sec === DEMO_SECTION ? demoTitle() : sec === PAGE_VIEW ? pages.title() : undefined;
  shell.setHeader({ view: sec, title });

  // La vue de page garde son contenu (composants, tranches chargées) : son hôte est replacé, jamais réécrit.
  // De même pour l'accueil (P4-12), dont les rangées sont relues à chaque affichage, la Recherche (P4-13), le Centre
  // (P4-18), l'explorateur (P4-08) et les Réglages (P4-20).
  const hosted = sec === 'web' ? web.host : sec === PAGE_VIEW ? pages.host : sec === HOME_VIEW ? home.host : sec === SEARCH_VIEW ? search.host : sec === CENTRE_VIEW ? centre.host : sec === EXPLORER_VIEW ? explorer.host : sec === SETTINGS_VIEW ? settings.host : sec === ASSISTANT_VIEW ? assistant.host : null;
  // L'explorateur a au-dessus de lui le bandeau du mode secours (P4-10), vide hors du mode secours.
  const hostedAll = sec === EXPLORER_VIEW ? [rescue.host, hosted] : [hosted];
  if (hosted) { if (viewEl.childElementCount !== hostedAll.length || hostedAll.some((el, i) => viewEl.children[i] !== el)) viewEl.replaceChildren(...hostedAll); }
  // Page de démonstration (P4-01) : un gabarit fixe, aux textes des catalogues échappés.
  else if (sec === DEMO_SECTION) viewEl.innerHTML = viewDemo();
  else viewEl.replaceChildren();
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
  if (sec === SETTINGS_VIEW) { fillDrmStatus(); refreshAdblock(); }
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











/* ------------------------------------------------------------------ */
/* Vues                                                                */
/* ------------------------------------------------------------------ */
















// Console désignée par son identifiant (P1-07 : plus jamais par sa position dans la liste).
function consoleOf(id) {
  return id == null ? null : S.config.emulators.find((e) => e.id === id) || null;
}




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
  // (celle du marque-page reportée sur le jeu) et les jeux de sa console (relus, ils mettent le catalogue à jour).
  if (d.gameBookmark) { S.config = (await api.getConfig()).config; S.scrape = (await api.scrapeData()) || {}; if (d.console != null) await api.listRoms(d.console).catch(() => null); }
  const m = (key, vars) => t(`centre.downloads.messages.${key}`, vars);
  if (d.console == null) toast(m('finished', { name: d.name }), { duration: 5000 });
  const installer = (d.installers || [])[0];
  if (d.kind !== 'torrent' || !installer) return;
  if (dialogs.dialogsOpen()) { toast(m('installerLater', { name: d.name }), { duration: 8000 }); return; }
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

// Code mort, retiré après la fusion de #117 (P5-12), qui en modifie une ligne (P4-24a1).
// eslint-disable-next-line no-unused-vars
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
  refreshSources();
  S.scanned = false;
  scan();
}

// État des sources affiché par les Réglages (P4-20).
function refreshSources() {
  if (S.section === SETTINGS_VIEW) settings.refresh();
}

async function askSourceAddress(kind) {
  const res = await dialogs.openForm({
    title: 'Ajouter une adresse',
    help: 'Partage réseau : \\\\NAS\\Films ou smb://nas/films. Serveur web : l’adresse d’une page qui liste les fichiers (http://192.168.1.10/films/) ou d’une liste de lecture M3U.',
    fields: [{ id: 'location', label: 'Adresse', value: '', placeholder: '\\\\NAS\\Films' }],
    actions: [{ id: 'ok', label: 'Ajouter', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action === 'ok' && res.values.location) await addSource(kind, res.values.location.trim());
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

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function scan() {
  if (S.scanning) return;
  S.scanning = true;
  refreshSources();
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
  if (S.section === HOME_VIEW) render();
  refreshSources();
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
  const res = await dialogs.openForm({
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
  const res = await dialogs.openForm({
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
  const res = await dialogs.openForm({
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


async function openRomBrowser(i, { site, url } = {}) {
  const name = i === 'pc' ? 'Jeux PC' : consoleOf(i)?.name;
  if (name == null) return;
  const r = await api.romSites(i);
  S.romSites[i] = r?.sites || [];
  if (!S.romSites[i].length) {
    if (i === 'pc') { toast('Aucun site de jeux PC configuré. Ajoutez-en dans Réglages, partie Jeux.', { duration: 7000 }); revealSettings('games'); }
    else { toast(`Aucun site n’est configuré pour ${name}. Ajoutez-en dans « Modifier la console ».`, { duration: 7000 }); callAction('mire-games', 'editConsole', { id: i }); }
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



async function addGame() {
  const cfg = await api.addGame();
  if (cfg && cfg.games) {
    S.config = cfg;
    render();
    toast('Jeu ajouté. Vous pouvez lui donner une jaquette dans Réglages.');
  }
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
  refreshSources();
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

// Les réglages du bloqueur sont enregistrés par le processus principal : on relit la configuration.
async function afterAdblockChange(st) {
  S.config = (await api.getConfig()).config;
  await refreshAdblock(st || undefined);
}

// État du bloqueur, rédigé par les Réglages (P4-20).
async function refreshAdblock(fresh) {
  S.adblock = fresh || (await api.adblockStatus());
  if (S.section === SETTINGS_VIEW) settings.refresh();
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

// Le rouage de l'en-tête ouvre les Réglages de la page ; il signale aussi une récupération d'infos en cours.
function updateScrapeButton() {
  shell.setGear({ hidden: S.section === SETTINGS_VIEW, scrape: S.scraping });
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

// Les Réglages, sur la partie de la page affichée (P4-24a1) : ses sources, ses sites, sa télévision, ses jeux…
function openPageSettings() {
  const section = S.section === PAGE_VIEW ? (pages.legacySection() ?? S.section) : S.section === 'web' ? webHome() : S.section;
  revealSettings(settingsPartOf(section));
}

// Ouvre les Réglages ; `part` : la partie qui reçoit le focus (`sources`, `games`…), sinon le début.
function revealSettings(part) {
  go(SETTINGS_VIEW, { focus: part ? 'keep' : 'content' });
  if (part) settings.focus(part);
}

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
  toast(t('settingsView.saved'), { duration: 1500 });
}
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
  const [installed, available, repos, continuity] = await Promise.all([
    api.pluginsList(),
    api.reposPlugins(),
    api.reposList(),
    api.pluginsContinuity().catch(() => null),
  ]);
  const list = (x) => (Array.isArray(x) ? x : []);
  S.plugins = { installed: list(installed), available: list(available), repos: list(repos), continuity: list(continuity?.items) };
  if (S.section === CENTRE_VIEW) centre.refresh();
}

// Avancement d'une installation de plugin : des données, rédigées par le Centre ; la fin (réussite ou erreur) est
// annoncée par l'action qui l'a lancée.
api.onPluginsProgress((p) => {
  if (p.phase === 'done' || p.phase === 'error') delete S.pluginProgress[p.id];
  else S.pluginProgress[p.id] = p;
  if (S.section === CENTRE_VIEW) centre.refresh();
  assistant.progress(p);
});

async function afterStoreChange(r, okMessage) {
  if (r?.config) S.config = r.config;
  else S.config = (await api.getConfig()).config;
  S.romsCache = {};
  await loadCatalog();
  if (S.section === CENTRE_VIEW) render();
  if (r?.ok && okMessage) toast(okMessage, { duration: 6000 });
}

/* ---------- Contrôleurs (P4-04) : les actions de l'interface ---------- */

// Opérations de la page dont les contrôleurs ont besoin (elles quitteront app.js en P4-24a2).
const legacyUi = {
  render, go, back, openPageSettings, revealSettings, confirm: dialogs.confirmDialog,
  selectedKey: () => cardKeyOf() ?? (S.section === EXPLORER_VIEW ? explorer.selectedKey() : null),
  selectedGroup: () => groupRefOf(document.activeElement, pages.route()),
  afterEdit: () => { if (S.section === SEARCH_VIEW) search.refresh(); },
  // Pages créées, modifiées ou supprimées (P4-21) : le menu suit.
  async reloadPages() {
    const list = await api.pagesList().catch(() => null);
    if (Array.isArray(list)) shell.setPages(list);
  },
  afterConsolesChange(config) {
    S.config = config;
    S.romsCache = {};
    S.romSites = {};
    render();
  },
  openFileDialog, scan, addSourceFolder, askSourceAddress, removeSource, startScrape, updateScrapeButton, reloadScrape,
  playInContext, playRecent, openVideo, playQueue, openImages,
  pauseAudio: () => audio.pause(),
  toggleAudio, openExternal, addRecent, video: videoUi, music: musicUi, images: imagesUi,
  playChannel, loadChannels,
  downloadGameBookmark, addGame, openRomBrowser,
  openWeb, openTvWeb, openBookmark, bookmarkCurrentPage, bookmarkCurrentGame, learnSearch, syncWeb, refreshWebBar,
  getQueries, rememberQuery, search, explorer, settings,
  rescue: { themes: pageThemes, refresh: () => rescue.refresh() },
  assistant: { session: () => assistant.session(), refresh: (focus) => assistant.refresh(focus), open: () => assistant.open(), close: (to) => assistant.close(to) },
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
initDemoDialogs();
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

/* ------------------------------------------------------------------ */
/* Lecteurs intégrés, clavier et manette (players/, nav/)              */
/* ------------------------------------------------------------------ */

initAudio(C);
initVideo(C);
initImages(C);

// Contexte des touches et de la manette : les lecteurs, puis le site affiché (une boîte au premier plan passe avant :
// nav/gamepad.ts la trouve elle-même).
function padContext() {
  if (isVideoOpen()) return 'video';
  if (isImagesOpen()) return 'image';
  if (S.section === 'web' && webShouldShow()) return 'web';
  return 'list';
}

initKeyboard({
  overlayKey: (key, fromPad) => (isVideoOpen() ? videoKey(key, fromPad) : isImagesOpen() ? imageKey(key, fromPad) : null),
  webBarDown: (el) => {
    if (S.section !== 'web' || !el?.closest('mire-webbar')) return false;
    C.web.focusSite();
    return true;
  },
}, C);

initGamepad({
  context: padContext,
  // Mode secours (P4-10) : Affichage + Menu ouvrent l'explorateur, quel que soit le thème.
  rescue: () => rescue.request({ reason: 'pad' }),
  // Profils de manettes des plugins (P5-04).
  profiles: () => api.gamepadsProfiles(),
  onProfilesChange: (listener) => api.onGamepadsChange(listener),
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
  // Les pages prêtes à l'emploi arrivent avec leurs plugins, démarrés après la fenêtre (P5-03) : le menu suit
  // `pages:changed`, et relit la liste une fois abonné, au cas où elle aurait changé depuis la première lecture.
  api.onPagesChange(() => void legacyUi.reloadPages());
  void legacyUi.reloadPages();
  S.scrape = (await api.scrapeData()) || {};
  S.meta = (await api.metaAll()) || {};
  S.adblock = await api.adblockStatus();
  loadDownloads();

  await loadUsage();
  setVolume(S.usage.volume);

  go(HOME_VIEW, { focus: 'content' });
  // Mode secours (P4-10) : premier écran demandé (option, touche maintenue, plantages) ou thème déjà en échec.
  rescue.start(await api.rescueStart().catch(() => null));
  // Continuité (P5-01) : fonctions devenues des plugins ; message rédigé par le processus principal, montré une fois.
  const continuityNotice = (s) => {
    if (!s?.notice) return;
    toast(s.notice, { duration: 9000 });
    api.pluginsContinuitySeen().catch(() => {});
  };
  api.onPluginsContinuity(continuityNotice);
  // Le récapitulatif est aussi montré dans le Centre (onglet Plugins, P4-19).
  api.onPluginsContinuity((s) => {
    if (!S.plugins || !Array.isArray(s?.items)) return;
    S.plugins.continuity = s.items;
    if (S.section === CENTRE_VIEW) centre.refresh();
  });
  api.pluginsContinuity().then(continuityNotice).catch(() => {});
  api.onPalettesChange(() => void loadPluginPalettes());
  void loadPluginPalettes();
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
  // Assistant du premier lancement (P4-23) : pas par-dessus le mode secours ni des fichiers ouverts avec Mire.
  const firstRun = await api.assistantState().catch(() => null);
  if (firstRun?.open && !pending?.length && !rescue.current()) assistant.open();
})();
