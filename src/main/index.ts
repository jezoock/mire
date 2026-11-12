/**
 * Mire : lecteur multimédia et frontend de jeux.
 * Racine de composition du processus principal : crée les services dans l'ordre, les relie entre eux, enregistre
 * l'IPC et ouvre la fenêtre. La logique vit dans les modules ; ici, seulement le câblage.
 */
import path from 'node:path';
import { app, BrowserWindow, WebContentsView, components, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell, webContents } from 'electron';
import { path7za } from '7zip-bin';
import { MIME, type SystemHint } from '@mire/shared';
import { createArchive } from './archive/index.ts';
import { runApp, setApplicationMenu, type PendingFiles, type Running } from './app/lifecycle.ts';
import { createConfigService } from './config/index.ts';
import { createDownloads } from './downloads/index.ts';
import { onDownloadFinished } from './games/download-finished.ts';
import { createGames } from './games/index.ts';
import { defaultRomSites } from './games/rom-sites.ts';
import { createLanguageService, useLanguage } from './i18n/index.ts';
import { registerIpc } from './ipc/handlers/index.ts';
import { mainContext } from './ipc/main-context.ts';
import { createLibraryService } from './library/service.ts';
import { registerMediaProtocol, registerMediaScheme } from './media-protocol/index.ts';
import { createUserMeta } from './meta/user-meta.ts';
import * as http from './net/http.ts';
import { createTmdbClient } from './net/tmdb.ts';
import { createLauncher, createPlayers } from './platform/index.ts';
import { createScraper, guessSystem } from './scrape/index.ts';
import { streamingSearchProvider } from './search/streaming.ts';
import { createAccessPolicy } from './security/access-policy.ts';
import { allowedFiles, allowedRoots } from './security/allowed.ts';
import { flushWithin } from './storage/json-store.ts';
import { dataPaths } from './storage/paths.ts';
import { createStore } from './store/index.ts';
import { createTv } from './tv/index.ts';
import { createUsageService } from './usage/index.ts';
import { chromeLikeUserAgent, createWebLayer, nativeUserAgent, WEB_PARTITION, type ViewLike, type WebManagerDeps } from './web/index.ts';
import { createDialogs } from './window/dialogs.ts';
import { createMainWindow } from './window/main-window.ts';

const PLATFORM = process.platform;

// Dossier de données isolé (tests de bout en bout, essais) : fixé avant toute lecture de config ou de cache
// (aucun module ne lit `userData` au chargement).
if (process.env.MIRE_USER_DATA) app.setPath('userData', process.env.MIRE_USER_DATA);

// Identité « Chrome » pour toute l'application, fixée avant la création de la moindre page (src/main/web/user-agent.ts).
const NATIVE_UA = nativeUserAgent(app.userAgentFallback, app.getName());
app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback, app.getName());

// Le schéma media:// sert les fichiers locaux à l'interface, avec gestion des plages (avance rapide).
registerMediaScheme(protocol);

/** Crée les services dans l'ordre, les relie, enregistre l'IPC et ouvre la fenêtre (application prête). */
function start(pending: PendingFiles): Running {
  const userData = app.getPath('userData');
  const files = dataPaths(userData);
  const dist = (...parts: string[]) => path.join(__dirname, '..', ...parts);

  // Configuration et données d'usage (« Reprendre », positions, volume, recherches récentes).
  const config = createConfigService({ file: files.config });
  const usage = createUsageService({ file: files.usage });

  // L'interface ne peut lire que les dossiers de la bibliothèque, les dossiers de ROMs
  // et les fichiers ouverts explicitement (boîte de dialogue, glisser-déposer).
  const roots = () => allowedRoots(config.get(), [files.scrapeImg, files.metaImg, files.romCache]);
  const access = createAccessPolicy({ roots, files: () => allowedFiles(config.get()) });
  // Une configuration modifiée : racines autorisées recalculées, sites ouverts à jour.
  config.onChange((next) => {
    access.invalidate();
    web.refreshEntries(next);
  });

  // Fenêtre fermée : l'application se ferme, sauf sous macOS.
  const onClosed = () => (PLATFORM === 'darwin' ? undefined : app.quit());
  const pages = { preload: dist('preload', 'preload.js'), html: dist('renderer', 'index.html') };
  const window = createMainWindow({ BrowserWindow, shell, nativeTheme, config, files: pages, web: () => web, onClosed });
  const { toUi } = window;

  const library = createLibraryService({ config, access });
  const dialogs = createDialogs({ dialog, window: window.get, itemFromPath: library.itemFromPath });
  const meta = createUserMeta({ file: files.meta, imgDir: files.metaImg, chooseImage: dialogs.chooseMetaImage });
  const tv = createTv({ config, http, toUi });

  // Lancement de programmes (jeux, émulateurs, lecteur externe) ; « réduire pendant le jeu ».
  const launcher = createLauncher({ shell, minimizeWhileRunning: window.minimizeWhileRunning });
  const players = createPlayers({ launcher, shell, settings: () => config.get(), isAllowed: (file) => access.isAllowed(file) });

  // Langue de l'interface : réglage ui.language, ou langue du système ; l'interface suit ses changements.
  const i18n = createLanguageService({ config, systemLanguages: () => app.getPreferredSystemLanguages(), dev: !app.isPackaged });
  i18n.onChange((info) => toUi('i18n:changed', info));
  // Textes du processus principal (erreurs, boîtes de dialogue, boutique) dans la langue de l'interface.
  useLanguage(i18n);

  // Vues web intégrées (src/main/web/setup.ts). Les types « Like » décrivent le sous-ensemble d'Electron utilisé.
  const webLayer = createWebLayer({
    window: window.get as unknown as WebManagerDeps['window'],
    createView: (webPreferences) => new WebContentsView({ webPreferences }) as unknown as ViewLike,
    config,
    defaultRomSites,
    guessSystem: (emu) => guessSystem(emu as SystemHint),
    downloads: () => downloads,
    openInBrowser: players.openInBrowser,
    toUi,
    components,
    dataDir: userData,
    session: () => session.fromPartition(WEB_PARTITION),
    ipcMain,
    preloadPath: dist('preload', 'web-preload.js'),
    google: { nativeUserAgent: NATIVE_UA, contentsFromId: (id) => webContents.fromId(id) },
  });
  const { web, drm } = webLayer;

  const streaming = streamingSearchProvider(createTmdbClient({ key: () => config.get().search.tmdbToken }));
  const games = createGames({
    config,
    access,
    launcher,
    downloads: () => downloads,
    scraper: () => scraper,
    romCacheDir: () => files.romCache,
    pickFile: dialogs.pickFile,
    toUi,
  });

  // Lecture des données, puis services qui en dépendent.
  config.load();
  usage.load();
  meta.load();
  const sevenZipPath = path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const archive = createArchive({ sevenZipPath, copyPath: files.sevenZip });
  const scraper = createScraper({ dataDir: userData, getConfig: config.get, listRoms: games.listRoms, onProgress: (p) => toUi('scrape-progress', p) });
  // Configuration lue et dossier d'images créé : les racines autorisées se calculeront à la première question.
  access.invalidate();
  const store = createStore({
    dataDir: userData,
    defaultRomsRoot: path.join(app.getPath('documents'), 'Mire', 'ROMs'),
    getConfig: config.get,
    saveConfig: config.replace,
    onProgress: (p) => toUi('store-progress', p),
    extract: archive.extract,
    paths: { home: app.getPath('home'), documents: app.getPath('documents'), appData: app.getPath('appData') },
  });
  const downloads = createDownloads({
    dataDir: userData,
    getConfig: config.get,
    getSession: () => session.fromPartition(WEB_PARTITION),
    extract: archive.extract,
    shell,
    defaultDir: path.join(app.getPath('downloads'), 'Mire'),
    onChange: (item) => toUi('download', item),
    // Marque-pages de jeux et annonce « jeu ajouté » (src/main/games/download-finished.ts).
    onFinished: onDownloadFinished({ onBookmarkDownloaded: games.onBookmarkDownloaded, list: () => downloads.list(), toUi }),
  });
  downloads.start().catch((err) => console.error('Téléchargements :', err.message));
  // Premier lancement : on repère le service de télévision en place sur le réseau local.
  tv.detectOnce().catch((err) => console.error('Détection TV :', err.message));
  setApplicationMenu(Menu, PLATFORM);
  registerMediaProtocol(protocol, { isAllowed: access.isAllowed, mimeType: (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  // Bloqueur et connexion Google branchés sur la session des vues web, Widevine.
  const adblock = webLayer.start();

  // Les handlers IPC (src/main/ipc/handlers/) reçoivent les services par leur contexte.
  const services = { config, usage, i18n, access, window, pending, meta, files, library, dialogs, web, scraper, store, downloads, adblock };
  const searchStreaming = (query: string) => streaming.search(query, { getConfig: () => config.get() });
  registerIpc(ipcMain, mainContext({ ...services, electron: { app, dialog, shell }, players, tv, drm, games, searchStreaming }));
  window.open();

  return {
    async onSecondInstance(paths) {
      if (!window.bringToFront()) return;
      const items = (await Promise.all(paths.map(library.itemFromPath))).filter(Boolean);
      if (items.length) toUi('open-files', items);
    },
    onActivate() {
      if (!BrowserWindow.getAllWindows().length) window.open();
    },
    beforeQuit() {
      downloads.stop().catch(() => {});
      const flushes = [scraper, downloads, usage].map((m) => () => m.flush());
      return flushWithin(flushes, 2000);
    },
  };
}

runApp({ app, platform: PLATFORM, argv: process.argv, packaged: app.isPackaged, start });
