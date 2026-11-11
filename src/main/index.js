'use strict';
/**
 * Mire : lecteur multimédia et frontend de jeux.
 * Processus principal : fenêtres, accès au disque, télévision, lancement des programmes.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, shell, session, Menu, nativeTheme, webContents } = require('electron');
// API propre à castLabs Electron (Widevine). Absente d'Electron standard : on la teste avant usage.
const { components } = require('electron');
// Dossier de données isolé (tests de bout en bout, essais) : fixé avant toute lecture de config ou de cache.
if (process.env.MIRE_USER_DATA) app.setPath('userData', process.env.MIRE_USER_DATA);
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { createScraper, guessSystem } = require('./scrape/index.ts');
const { createStore } = require('./store/index.ts');
const { createArchive } = require('./archive/index.ts');
const http = require('./net/http.ts');
const { createAdblock } = require('./adblock.js');
const { defaultRomSites } = require('./romsites.js');
const { createDownloads } = require('./downloads/index.ts');
const { createGames } = require('./games/index.ts');
const { THEME_BG, createConfigService } = require('./config/index.ts');
const { createTv } = require('./tv/index.ts');
const { createUsageService } = require('./usage/index.ts');
const library = require('./library/index.ts');
const { resolveLocation, locationError } = library;
const { createLauncher, createPlayers } = require('./platform/index.ts');
const { createJsonStore, flushWithin } = require('./storage/json-store.ts');
const { dataPaths } = require('./storage/paths.ts');
const { createAccessPolicy } = require('./security/access-policy.ts');
const { registerMediaScheme, registerMediaProtocol } = require('./media-protocol/index.ts');
const { createWebManager, createDrm, createWebExtensions, createGoogleSignin, setupWebSession: setupWebSessionOf, chromeLikeUserAgent, nativeUserAgent, WEB_PARTITION } = require('./web/index.ts');
const { createTmdbClient } = require('./net/tmdb.ts');
const { streamingSearchProvider } = require('./search/streaming.ts');
const { registerIpc: registerIpcHandlers } = require('./ipc/handlers/index.ts');
const { createLanguageService } = require('./i18n/index.ts');
const { EXT, MIME } = require('@mire/shared');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Identité « Chrome » pour toute l'application, fixée avant la création de la moindre page (src/main/web/user-agent.ts).
const NATIVE_UA = nativeUserAgent(app.userAgentFallback, app.getName());
app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback, app.getName());

// Le schéma media:// sert les fichiers locaux à l'interface, avec gestion des plages (avance rapide).
registerMediaScheme(protocol);

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

let mainWindow = null;
let pendingFiles = [];
const dataFiles = () => dataPaths(app.getPath('userData'));
const configPath = () => dataFiles().config;
// Seul détenteur de la configuration : lue au démarrage (loadConfig), modifiée par update/replace.
const configService = createConfigService({ file: configPath() });
const loadConfig = () => configService.load();
// « Reprendre », positions de reprise, volume et recherches récentes (src/main/usage), lus au démarrage.
const usage = createUsageService({ file: dataFiles().usage });

/* ------------------------------------------------------------------ */
/* Fichiers autorisés                                                  */
/* ------------------------------------------------------------------ */

let scraper = null;
let store = null;
let adblock = null;
let webExtensions = null;
let downloads = null;
let adblockReady = Promise.resolve(false);

const metaDir = () => dataFiles().metaDir;
const romCacheDir = () => dataFiles().romCache;

function allowedRoots() {
  const roots = [];
  const addLoc = (loc) => { const r = resolveLocation(loc); if (r.type === 'path' && r.path) roots.push(r.path); };
  for (const src of configService.get().library.sources) addLoc(src.location);
  for (const src of configService.get().gameSources) addLoc(src.location);
  for (const e of configService.get().emulators) {
    if (e.romsDir) roots.push(e.romsDir);
    if (e.imagesDir) roots.push(e.imagesDir);
    for (const x of e.sources || []) addLoc(x);
  }
  if (scraper) roots.push(scraper.imgDir);
  roots.push(path.join(metaDir(), 'img'), romCacheDir());
  return roots;
}

// Fichiers autorisés un par un par la configuration : image d'un jeu PC, bannière d'une console.
function allowedFiles() {
  const cfg = configService.get();
  return [...cfg.games.map((g) => g.image), ...cfg.emulators.map((e) => e.banner)];
}

// L'interface ne peut lire que les dossiers de la bibliothèque, les dossiers de ROMs
// et les fichiers ouverts explicitement (boîte de dialogue, glisser-déposer).
const access = createAccessPolicy({ roots: allowedRoots, files: allowedFiles });
configService.onChange(() => access.invalidate());

function registerMedia() {
  registerMediaProtocol(protocol, {
    isAllowed: access.isAllowed,
    mimeType: (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
  });
}

/* ------------------------------------------------------------------ */
/* Bibliothèque (src/main/library)                                     */
/* ------------------------------------------------------------------ */

// Sous-titres des vidéos en ligne trouvés par la dernière analyse.
let remoteSubtitles = new Map();

// Analyse de toutes les sources ; renvoie aussi l'état de chacune (nombre d'éléments, erreur).
async function scanLibrary() {
  const cfg = configService.get();
  const { items, status, subtitles } = await library.scanLibrary({ sources: cfg.library.sources, bookmarks: cfg.bookmarks || [] });
  remoteSubtitles = subtitles;
  return { items, status };
}

const itemFromPath = (p) => library.itemFromPath(p, { allowFile: access.allowFile });
const findSubtitles = (videoPath) => library.findSubtitles(videoPath, { remote: remoteSubtitles, isAllowed: access.isAllowed });

/* ------------------------------------------------------------------ */
/* Télévision (src/main/tv)                                            */
/* ------------------------------------------------------------------ */

// toUi est défini plus bas, avec les vues web ; il n'est appelé qu'après le démarrage.
const tv = createTv({ config: configService, http, toUi: (channel, payload) => toUi(channel, payload) });

/* ------------------------------------------------------------------ */
/* Lancement de programmes (jeux, émulateurs, lecteur externe)         */
/* ------------------------------------------------------------------ */

// « Réduire pendant le jeu » : la fenêtre est réduite au lancement, rétablie à la fermeture du programme.
function minimizeWhileRunning() {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined;
  mainWindow.minimize();
  return () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.restore(); mainWindow.focus(); } };
}
const { launchProcess, openTarget } = createLauncher({ shell, minimizeWhileRunning });
const { playExternal, openInBrowser } = createPlayers({
  launcher: { launchProcess, openTarget }, shell,
  settings: () => configService.get(), isAllowed: (file) => access.isAllowed(file),
});

/* ---------- Vues web intégrées (src/main/web) ---------- */

const toUi = (channel, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); };

// Langue de l'interface (src/main/i18n) : réglage ui.language, ou langue du système ; l'interface suit ses changements.
const i18n = createLanguageService({ config: configService, systemLanguages: () => app.getPreferredSystemLanguages(), dev: !app.isPackaged });
i18n.onChange((info) => toUi('i18n:changed', info));

const drm = createDrm({ components, onError: (err) => console.error('Widevine :', err?.message || err) });

const web = createWebManager({
  window: () => mainWindow,
  createView: (webPreferences) => new WebContentsView({ webPreferences }),
  config: configService,
  defaultRomSites,
  guessSystem,
  downloads: () => downloads,
  extensions: () => webExtensions,
  // Le premier site ouvert attend Widevine, puis le bloqueur.
  whenReady: async () => { await drm.whenReady(); await adblockReady; },
  openInBrowser,
  toUi,
});

// Extensions des vues web, dans l'ordre où elles voient passer les requêtes : bloqueur, puis connexion Google.
function setupWebSession() {
  webExtensions = createWebExtensions([
    adblock,
    createGoogleSignin({ nativeUserAgent: NATIVE_UA, contentsFromId: (id) => webContents.fromId(id) }),
  ]);
  setupWebSessionOf({
    session: session.fromPartition(WEB_PARTITION),
    ipcMain,
    preloadPath: path.join(__dirname, '..', 'preload', 'web-preload.js'),
    onDownload: web.onDownload,
    takeMagnet: web.takeMagnet,
    extensions: webExtensions,
  });
}

/* ---------- Recherche « où regarder » (src/main/search/streaming.ts) ---------- */

const streamingSearch = streamingSearchProvider(createTmdbClient({ key: () => configService.get().search.tmdbToken }));
const searchStreaming = (query) => streamingSearch.search(query, { getConfig: () => configService.get() });

/* ---------- Jeux et émulateurs (src/main/games) ---------- */

const games = createGames({
  config: configService,
  access,
  launcher: { launchProcess, openTarget },
  downloads: () => downloads,
  scraper: () => scraper,
  romCacheDir,
  pickFile: (kind) => pickFile(kind),
  toUi,
});

/* ---------- Modifications manuelles des infos (titre, genre, images…) ---------- */

let userMeta = {};
let metaStore = null;
function loadMeta() {
  metaStore = createJsonStore(dataFiles().meta, { defaults: {}, space: 2 });
  userMeta = metaStore.load();
}
function saveMeta() {
  metaStore.set(userMeta);
}
const META_FIELDS = ['title', 'year', 'genre', 'overview', 'artist', 'image', 'backdrop'];
function setMeta(key, patch) {
  if (typeof key !== 'string' || !key) return null;
  const cur = { ...(userMeta[key] || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!META_FIELDS.includes(k)) continue;
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val == null) delete cur[k]; else cur[k] = val;
  }
  if (Object.keys(cur).length) userMeta[key] = cur; else delete userMeta[key];
  saveMeta();
  return userMeta[key] || null;
}
async function pickMetaImage(key, field) {
  if (!['image', 'backdrop'].includes(field)) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: field === 'image' ? 'Choisir l’image' : 'Choisir le fond d’écran',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const dest = path.join(metaDir(), 'img', `${crypto.createHash('sha1').update(`${key}|${field}|${Date.now()}`).digest('hex')}${path.extname(src).toLowerCase()}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  return setMeta(key, { [field]: dest });
}

/* ------------------------------------------------------------------ */
/* Dialogues                                                           */
/* ------------------------------------------------------------------ */

async function pickFolder() {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Choisir un dossier', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}

async function pickFile(kind) {
  const filters = {
    program: IS_WIN ? [{ name: 'Programmes', extensions: ['exe'] }] : IS_MAC ? [{ name: 'Applications', extensions: ['app'] }] : [],
    game: IS_WIN ? [{ name: 'Jeux et raccourcis', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }] : IS_MAC ? [{ name: 'Applications', extensions: ['app'] }] : [],
    image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  }[kind] || [];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [...filters, { name: 'Tous les fichiers', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
}

async function openMediaDialog() {
  const all = Object.values(EXT).flat().map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir des fichiers',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vidéos, musiques et images', extensions: all }, { name: 'Tous les fichiers', extensions: ['*'] }],
  });
  if (r.canceled) return [];
  return (await Promise.all(r.filePaths.map(itemFromPath))).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Fenêtre principale                                                  */
/* ------------------------------------------------------------------ */

function themeBackground() {
  const t = configService.get().ui.theme === 'auto' ? (nativeTheme.shouldUseDarkColors ? 'ecran' : 'jour') : configService.get().ui.theme;
  return THEME_BG[t] || THEME_BG.ecran;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 960,
    minHeight: 620,
    title: 'Mire',
    backgroundColor: themeBackground(),
    autoHideMenuBar: true,
    fullscreen: !!configService.get().ui.fullscreen,
    show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { mainWindow.setFullScreen(!mainWindow.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); e.preventDefault(); }
  });
  mainWindow.on('resize', () => web.onWindowResize());
  // Bouton « précédent » de la souris (Windows) dans un site.
  mainWindow.on('app-command', (_e, cmd) => web.onAppCommand(cmd));
  mainWindow.on('closed', () => {
    mainWindow = null;
    web.onWindowClosed();
    if (!IS_MAC) app.quit();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function filesFromArgv(argv) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => a && !a.startsWith('-'))
    .filter((a) => { try { return fs.statSync(a).isFile(); } catch { return false; } });
}

// Les handlers IPC (src/main/ipc/handlers/) accèdent à l'état de ce fichier par ce contexte : accesseurs pour ce qui
// change (configuration, fenêtre, services créés au démarrage), fonctions pour le reste.
const ipcContext = {
  electron: { app, dialog, shell },
  config: configService,
  usage,
  i18n,
  get mainWindow() { return mainWindow; },
  get pendingFiles() { return pendingFiles; },
  set pendingFiles(next) { pendingFiles = next; },
  get userMeta() { return userMeta; },
  web,
  get scraper() { return scraper; },
  get store() { return store; },
  get downloads() { return downloads; },
  get adblock() { return adblock; },
  access,
  configPath, themeBackground,
  scanLibrary, findSubtitles, openMediaDialog, itemFromPath, locationError, pickFolder, pickFile,
  metaDir, saveMeta, setMeta, pickMetaImage,
  playExternal, detectTvService: tv.detect, fetchChannels: tv.channels,
  drmStatus: drm.status, searchStreaming,
  games,
};

function registerIpc() {
  registerIpcHandlers(ipcMain, ipcContext);
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFiles = filesFromArgv(process.argv);

  app.on('second-instance', async (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const items = (await Promise.all(filesFromArgv(argv).map(itemFromPath))).filter(Boolean);
    if (items.length) mainWindow.webContents.send('open-files', items);
  });

  app.whenReady().then(() => {
    loadConfig();
    usage.load();
    loadMeta();
    const sevenZipPath = require('7zip-bin').path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const archive = createArchive({ sevenZipPath, copyPath: dataFiles().sevenZip });
    scraper = createScraper({
      dataDir: app.getPath('userData'),
      getConfig: configService.get,
      listRoms: games.listRoms,
      onProgress: (p) => toUi('scrape-progress', p),
    });
    // Configuration lue et dossier d'images créé : les racines autorisées se calculeront à la première question.
    access.invalidate();
    store = createStore({
      dataDir: app.getPath('userData'),
      defaultRomsRoot: path.join(app.getPath('documents'), 'Mire', 'ROMs'),
      getConfig: configService.get,
      saveConfig: configService.replace,
      onProgress: (p) => toUi('store-progress', p),
      extract: archive.extract,
      paths: { home: app.getPath('home'), documents: app.getPath('documents'), appData: app.getPath('appData') },
    });
    downloads = createDownloads({
      dataDir: app.getPath('userData'),
      getConfig: configService.get,
      getSession: () => session.fromPartition(WEB_PARTITION),
      extract: archive.extract,
      shell,
      defaultDir: path.join(app.getPath('downloads'), 'Mire'),
      onChange: (item) => toUi('download', item),
      onFinished: (item) => {
        // Marque-page de jeu téléchargé : terminé, et sa fiche reportée sur le jeu (src/main/games/bookmarks.ts),
        // avant de prévenir l'interface, qui recharge alors la liste et les fiches.
        if (item.gameBookmark) {
          games.onBookmarkDownloaded(item)
            .catch((err) => console.error('Marque-page de jeu :', err.message))
            .finally(() => toUi('download-finished', item));
        } else toUi('download-finished', item);
        if (item.console == null) return;
        // Index qui attend ses pistes : on annoncera le jeu quand tout sera là.
        if (item.companions && !item.group) return;
        if (item.group) {
          // Fichiers d'un même jeu sur disque : un seul message, quand le dernier est arrivé.
          const same = downloads.list().filter((d) => d.group === item.group && d.console === item.console);
          if (same.some((d) => !['done', 'error', 'cancelled'].includes(d.state))) return;
          // L'index téléchargé seul depuis une page compte aussi parmi les fichiers du jeu.
          const index = downloads.list().filter((d) => !d.group && d.companions && d.console === item.console && path.basename(d.name, path.extname(d.name)) === item.group).length;
          toUi('rom-download', { phase: 'done', console: item.console, consoleName: item.consoleName, name: item.group, files: same.length + index, extracted: same.some((d) => d.extracted) });
          return;
        }
        toUi('rom-download', { phase: 'done', console: item.console, consoleName: item.consoleName, name: item.name, extracted: !!item.extracted });
      },
    });
    downloads.start().catch((err) => console.error('Téléchargements :', err.message));
    // Premier lancement : on repère le service de télévision en place sur le réseau local.
    tv.detectOnce().catch((err) => console.error('Détection TV :', err.message));
    if (IS_MAC) {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }
    registerMedia();
    adblock = createAdblock({
      dataDir: app.getPath('userData'),
      getConfig: configService.get,
      saveConfig: configService.replace,
      onCount: web.onBlockedCount,
    });
    setupWebSession();
    drm.start();
    // Le premier site ouvert attend le bloqueur (dix secondes au plus) pour ne pas laisser passer de pubs.
    // Désactivé, le bloqueur ne charge rien et ne télécharge aucune liste.
    adblockReady = Promise.race([
      adblock.start().catch((err) => { console.error('Bloqueur :', err.message); return false; }),
      new Promise((resolve) => { setTimeout(() => resolve(false), 10000); }),
    ]);
    registerIpc();
    createMainWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
  });

  // Avant de quitter, on attend les écritures différées (deux secondes au plus), puis on quitte pour de bon.
  let flushedBeforeQuit = false;
  app.on('before-quit', (event) => {
    if (flushedBeforeQuit) return;
    flushedBeforeQuit = true;
    event.preventDefault();
    downloads?.stop().catch(() => {});
    const flushes = [scraper, downloads, usage].filter(Boolean).map((m) => () => m.flush());
    flushWithin(flushes, 2000).finally(() => app.quit());
  });

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
}
