/**
 * Pont temporaire des vues historiques (P4-04) : chaque `data-action` d'un gabarit de `app.js` appelle la méthode d'un
 * contrôleur, comme le fera un `ds-trigger`. Il traduit les attributs de l'élément (`data-index`, `data-id`…) en
 * arguments par clé stable, et laisse aux vues historiques ce qui ne regarde qu'elles (focus, champs à vider).
 * Disparaît avec la dernière vue historique (P4-24). `npm run check:actions` vérifie que chaque `data-action` des
 * gabarits a une entrée, et que chaque entrée désigne une méthode existante.
 */
import { $, $$ } from '../core/dom.ts';
import { S } from '../state/index.ts';
import type { ControllerTag } from './index.ts';
import { invokeAction, reportActionError } from './registry.ts';
import type { ActionArgs } from './registry.ts';

/** Ce que le pont demande aux vues historiques après une action. */
export interface LegacyView {
  /** Conteneur de la vue affichée (`#view`). */
  root: ParentNode;
  /** Remet à jour la liste ordonnée d'une partie de l'accueil (Réglages). */
  refreshOrderList(kind: string, id: string, dir: string): void;
}

type Dataset = Record<string, string | undefined>;

export interface BridgeEntry {
  tag: ControllerTag;
  method: string;
  /** Arguments de la méthode, tirés des attributs de l'élément (et des champs de la vue). */
  args?: (d: Dataset, el: HTMLElement) => ActionArgs;
  /** Avant l'appel : ce que la vue montre aussitôt. */
  before?: (d: Dataset, el: HTMLElement) => void;
  /** Après un appel réussi, avec sa valeur : focus, champs vidés… */
  after?: (value: unknown, d: Dataset, view: LegacyView) => void;
}

// Position dans une liste de l'état (`data-index`) → clé stable de l'élément.
const index = (d: Dataset) => (d.index != null ? Number(d.index) : -1);
const keyAt = (list: unknown, d: Dataset, key: string) => (list as Record<string, unknown>[] | null | undefined)?.[index(d)]?.[key];
const gs = (kind: string) => (S.gs as Record<string, unknown>)[kind];
const field = (sel: string) => $<HTMLInputElement>(sel)?.value ?? '';
const clear = (...sels: string[]) => {
  for (const sel of sels) {
    const el = $<HTMLInputElement>(sel);
    if (el) el.value = '';
  }
};
const focusIn = (view: LegacyView, sel: string) => (view.root.querySelector(sel) as HTMLElement | null)?.focus();
const pressed = (els: HTMLElement[], id: string | undefined) => {
  for (const b of els) b.setAttribute('aria-pressed', String(b.dataset.id === id));
};
const byId = (d: Dataset) => ({ id: d.id });

/** Les actions des vues historiques (valeur de `data-action`) et la méthode qu'elles appellent. */
export const LEGACY_ACTIONS: Record<string, BridgeEntry> = {
  // Écrans, réglages, édition
  go: { tag: 'mire-app', method: 'go', args: (d) => ({ section: d.go }) },
  'open-file': { tag: 'mire-app', method: 'openFile' },
  more: { tag: 'mire-app', method: 'showMore', after: (first, _d, view) => focusIn(view, `[data-index="${first}"]`) },
  'open-store': { tag: 'mire-app', method: 'openPageSettings', args: () => ({ tab: 'store' }) },
  'manage-sources': { tag: 'mire-app', method: 'openSettings', args: () => ({ part: 'sources' }) },
  'edit-focused': { tag: 'mire-app', method: 'editInfo' },
  // Accueil
  // Pages : lecture, filtres, regroupements
  'play-video': { tag: 'mire-page', method: 'playVideo', args: (d) => ({ path: keyAt(S.list, d, 'path') }) },
  'play-track': { tag: 'mire-page', method: 'playTrack', args: (d) => ({ path: keyAt(S.list, d, 'path') }) },
  'play-album': { tag: 'mire-page', method: 'playAlbum', args: (d) => ({ dir: keyAt(S.list, d, 'dir') }) },
  'show-image': { tag: 'mire-page', method: 'showImage', args: (d) => ({ path: keyAt(S.list, d, 'path') }) },
  'play-channel': { tag: 'mire-page', method: 'playChannel', args: (d) => ({ name: keyAt(S.list, d, 'name') }) },
  'edit-album': { tag: 'mire-page', method: 'editAlbum', args: (d) => ({ path: keyAt(S.list, d, 'path') }) },
  'open-series': { tag: 'mire-page', method: 'openSeries', args: (d) => ({ key: keyAt(S.videoCards, d, 'key') }) },
  'open-season': { tag: 'mire-page', method: 'openSeason', args: (d) => ({ season: Number(d.season) }) },
  'back-videos': { tag: 'mire-page', method: 'closeSeries' },
  'back-season': { tag: 'mire-page', method: 'closeSeason' },
  'video-source': { tag: 'mire-page', method: 'filterSource', args: byId },
  'video-sort': { tag: 'mire-page', method: 'sortVideos', args: byId },
  genre: {
    tag: 'mire-page',
    method: 'filterGenre',
    args: byId,
    after: (_v, d, view) => focusIn(view, `[data-action="genre"][data-id="${CSS.escape(d.id ?? '')}"]`),
  },
  'scrape-section': { tag: 'mire-page', method: 'scrapeSection', args: (d) => ({ kind: d.kind, force: d.force === '1' }) },
  // Télévision
  'tv-reload': { tag: 'mire-page', method: 'reloadChannels' },
  'tv-detect': { tag: 'mire-page', method: 'detectBox' },
  'tv-open-web': { tag: 'mire-page', method: 'openTvPortal' },
  // Jeux et consoles
  'games-cleanup': { tag: 'mire-page', method: 'cleanupGames' },
  'launch-game': { tag: 'mire-page', method: 'launchGame', args: (d) => ({ path: keyAt(S.gameList, d, 'path') }) },
  gamebm: { tag: 'mire-page', method: 'downloadGameBookmark', args: (d) => ({ id: keyAt(S.gameList, d, 'bookmarkId') }) },
  'gamebm-download': { tag: 'mire-page', method: 'downloadGameBookmark', args: byId },
  'gamebm-remove': { tag: 'mire-page', method: 'removeGameBookmark', args: byId },
  'add-game': { tag: 'mire-page', method: 'addGame' },
  'game-delete': { tag: 'mire-page', method: 'deleteGame', args: (d) => ({ ref: JSON.parse(d.ref ?? 'null') }) },
  'game-system': {
    tag: 'mire-page',
    method: 'filterSystem',
    args: byId,
    after: (_v, d, view) => focusIn(view, `[data-action="game-system"][data-id="${CSS.escape(d.id ?? '')}"]`),
  },
  'open-emu': { tag: 'mire-page', method: 'openConsole', args: (d) => ({ consoleId: d.console }) },
  'edit-console': { tag: 'mire-page', method: 'editConsole', args: (d) => ({ consoleId: d.console }) },
  'back-games': { tag: 'mire-page', method: 'closeConsole' },
  'launch-rom': { tag: 'mire-page', method: 'launchRom', args: (d) => ({ path: keyAt(S.list, d, 'path') }) },
  'launch-rom-u': { tag: 'mire-page', method: 'launchRom', args: (d) => ({ path: keyAt(S.list, d, 'path'), consoleId: keyAt(S.list, d, 'consoleId') }) },
  'rom-online': { tag: 'mire-page', method: 'showOnlineRoms' },
  'rom-source': { tag: 'mire-page', method: 'chooseRomSource', args: (_d, el) => ({ id: (el as HTMLSelectElement).value }) },
  'rom-sites': { tag: 'mire-page', method: 'openRomSites', args: (d) => ({ consoleId: d.console }) },
  'rom-site-search': { tag: 'mire-page', method: 'searchRomSite', args: (d) => ({ consoleId: d.console, site: Number(d.id) }) },
  'games-download': { tag: 'mire-page', method: 'downloadGames', args: (d) => ({ consoleId: d.id }) },
  'rom-dl': { tag: 'mire-page', method: 'downloadRom', args: (d) => ({ path: d.path }) },
  'rom-dl-all': { tag: 'mire-page', method: 'downloadAllRoms' },
  // Recherche
  'gs-recent': { tag: 'mire-search', method: 'useRecentQuery', args: (d) => ({ query: S.usage.queries[index(d)] }) },
  'gs-video': { tag: 'mire-search', method: 'playVideo', args: (d) => ({ path: keyAt(gs('videos'), d, 'path') }) },
  'gs-track': { tag: 'mire-search', method: 'playTrack', args: (d) => ({ path: keyAt(gs('tracks'), d, 'path') }) },
  'gs-image': { tag: 'mire-search', method: 'showImage', args: (d) => ({ path: keyAt(gs('images'), d, 'path') }) },
  'gs-channel': { tag: 'mire-search', method: 'playChannel', args: (d) => ({ name: keyAt(gs('channels'), d, 'name') }) },
  'gs-game': { tag: 'mire-search', method: 'launchGame', args: (d) => ({ path: keyAt(gs('games'), d, 'path') }) },
  'gs-rom': { tag: 'mire-search', method: 'launchRom', args: (d) => ({ path: keyAt(gs('roms'), d, 'path'), consoleId: keyAt(gs('roms'), d, 'emu') }) },
  'gs-tmdb': { tag: 'mire-search', method: 'openTmdb', args: (d) => ({ key: keyAt(S.tmdb.results, d, 'key') }) },
  'gs-site': { tag: 'mire-search', method: 'searchSite', args: byId },
  'clear-queries': { tag: 'mire-search', method: 'clearQueries' },
  // Sources
  'src-add-folder': { tag: 'mire-explorer', method: 'addFolder', args: (d) => ({ kind: d.kind }) },
  'src-add-url': { tag: 'mire-explorer', method: 'addAddress', args: (d) => ({ kind: d.kind }) },
  'src-remove': { tag: 'mire-explorer', method: 'removeSource', args: (d) => ({ kind: d.kind, id: d.id }) },
  rescan: { tag: 'mire-explorer', method: 'rescan' },
  // Téléchargements, boutique, BIOS
  'dl-add': {
    tag: 'mire-centre',
    method: 'addDownload',
    args: () => ({ url: field('#dl-url').trim(), console: field('#dl-dest') }),
    after: (added) => added && clear('#dl-url'),
  },
  'dl-torrent': { tag: 'mire-centre', method: 'addTorrentFile', args: () => ({ console: field('#dl-dest') }) },
  'dl-pause': { tag: 'mire-centre', method: 'pauseDownload', args: byId },
  'dl-resume': { tag: 'mire-centre', method: 'resumeDownload', args: byId },
  'dl-start': { tag: 'mire-centre', method: 'startDownload', args: byId },
  'dl-cancel': { tag: 'mire-centre', method: 'cancelDownload', args: byId },
  'dl-remove': { tag: 'mire-centre', method: 'removeDownload', args: byId },
  'dl-clear': { tag: 'mire-centre', method: 'clearDownloads' },
  'dl-reveal': { tag: 'mire-centre', method: 'revealDownload', args: byId },
  'dl-install': { tag: 'mire-centre', method: 'runInstaller', args: (d) => ({ id: d.id, file: d.file }) },
  'ra-pick': { tag: 'mire-centre', method: 'toggleSystem', args: byId },
  'store-install': { tag: 'mire-centre', method: 'install', args: byId },
  'store-uninstall': { tag: 'mire-centre', method: 'uninstall', args: byId },
  'store-game': { tag: 'mire-centre', method: 'installGame', args: byId },
  'store-import': { tag: 'mire-centre', method: 'importGames', args: () => ({ console: $<HTMLSelectElement>('#st-console')?.value }) },
  'store-root': { tag: 'mire-centre', method: 'chooseGamesFolder' },
  'bios-add': { tag: 'mire-centre', method: 'addBios', args: byId },
  'bios-open': { tag: 'mire-centre', method: 'openBios', args: byId },
  // Réglages
  theme: { tag: 'mire-settings', method: 'setTheme', args: byId, after: (_v, d, view) => pressed($$('.theme-card', view.root), d.id) },
  'page-theme': { tag: 'mire-settings', method: 'setPageTheme', args: byId, after: (_v, d) => pressed($$('[data-action="page-theme"]'), d.id) },
  'menu-pos': { tag: 'mire-settings', method: 'setMenuPosition', args: byId, after: (_v, d) => pressed($$('[data-action="menu-pos"]'), d.id) },
  'order-move': {
    tag: 'mire-settings',
    method: 'moveHomeItem',
    args: (d) => ({ kind: d.kind, id: d.id, dir: Number(d.dir) }),
    after: (_v, d, view) => view.refreshOrderList(d.kind!, d.id!, d.dir!),
  },
  'config-export': { tag: 'mire-settings', method: 'exportConfig' },
  'config-import': { tag: 'mire-settings', method: 'importConfig', args: (d) => ({ mode: d.mode || 'replace' }) },
  'reveal-config': { tag: 'mire-settings', method: 'revealConfig' },
  browse: {
    tag: 'mire-settings',
    method: 'browse',
    args: (d) => ({ kind: d.kind }),
    after: (p, d) => {
      const input = p ? $<HTMLInputElement>(`#${d.id}`) : null;
      if (input) input.value = p as string;
    },
  },
  'save-pc-sites': { tag: 'mire-settings', method: 'savePcSites', args: () => ({ text: field('#pc-sites') }) },
  'add-site': {
    tag: 'mire-settings',
    method: 'addSite',
    args: () => ({ name: field('#ns-name').trim(), url: field('#ns-url').trim() }),
    after: (added) => added && clear('#ns-name', '#ns-url'),
  },
  'adblock-update': {
    tag: 'mire-settings',
    method: 'updateFilterLists',
    before: () => {
      const el = $('#adblock-status');
      if (el) el.textContent = 'Mise à jour des listes en cours…';
    },
  },
  'adblock-remove': { tag: 'mire-settings', method: 'removeFilterList', args: (d) => ({ kind: d.kind, id: d.id }) },
  'adblock-add-list': {
    tag: 'mire-settings',
    method: 'addFilterList',
    args: () => ({ url: field('#adblock-new').trim() }),
    after: (added) => added && clear('#adblock-new'),
  },
  'scrape-all': { tag: 'mire-settings', method: 'scrapeAll' },
  'scrape-clear': { tag: 'mire-settings', method: 'clearScrape' },
  'tv-service-radio': { tag: 'mire-settings', method: 'setTvService', args: byId },
  'dl-pick-dir': { tag: 'mire-settings', method: 'chooseDownloadFolder' },
  // Vue web
  'open-web': { tag: 'mire-web', method: 'open', args: byId },
  'web-nav': { tag: 'mire-web', method: 'navigate', args: byId },
  'web-close': { tag: 'mire-web', method: 'close' },
  'web-adblock': { tag: 'mire-web', method: 'toggleAdblock' },
  'web-bookmark': { tag: 'mire-web', method: 'bookmarkPage' },
  'game-bookmark': { tag: 'mire-web', method: 'bookmarkGame' },
  'web-learn': { tag: 'mire-web', method: 'learnSearch' },
};

/** Exécute l'action d'un élément `data-action` d'une vue historique ; sans effet pour une action inconnue. */
export async function runLegacyAction(el: HTMLElement, view: LegacyView): Promise<void> {
  const action = el.dataset.action ?? '';
  const entry = Object.hasOwn(LEGACY_ACTIONS, action) ? LEGACY_ACTIONS[action]! : null;
  if (!entry) return;
  const d = el.dataset as Dataset;
  let args: ActionArgs | undefined;
  try {
    entry.before?.(d, el);
    args = entry.args?.(d, el);
  } catch (error) {
    reportActionError(error, { tag: entry.tag, method: entry.method });
    return;
  }
  const r = await invokeAction(entry.tag, entry.method, args);
  if (r.ok) entry.after?.(r.value, d, view);
}
