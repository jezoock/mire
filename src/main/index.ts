/**
 * Mire : lecteur multimédia et frontend de jeux.
 * Racine de composition du processus principal : crée les services dans l'ordre, les relie entre eux, enregistre
 * l'IPC et ouvre la fenêtre. La logique vit dans les modules ; ici, seulement le câblage.
 */
import path from 'node:path';
import {
  app,
  BrowserWindow,
  WebContentsView,
  components,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  safeStorage,
  session,
  shell,
  webContents,
} from 'electron';
import { path7za } from '7zip-bin';
import { MIME, type SystemHint } from '@mire/shared';
import { BUILTIN_CATALOGS } from '@mire/shared/i18n';
import { createArchive } from './archive/index.ts';
import { runApp, setApplicationMenu, type PendingFiles, type Running } from './app/lifecycle.ts';
import type { Config } from '@mire/shared';
import { createCatalog } from './catalog/index.ts';
import { createMetadataStore, metadataContributors, metadataOrder } from './catalog/metadata.ts';
import type { Contributor } from './catalog/tags/engine.ts';
import { createOverrides } from './catalog/overrides.ts';
import { createTagEngine } from './catalog/tags/engine.ts';
import { createPages } from './catalog/pages/index.ts';
import { createSearch } from './catalog/search/index.ts';
import { createLists } from './catalog/lists/index.ts';
import { builtinTaggers, taggerContributor } from './catalog/tags/taggers.ts';
import { fileTagRules } from './catalog/tags/file-rules.ts';
import { createRegistry } from './catalog/tags/registry.ts';
import { createTargetFinder } from './catalog/targets.ts';
import { syncFeeds } from './catalog/sync.ts';
import { createConfigService } from './config/index.ts';
import { createDownloads, type PluginDownloader } from './downloads/index.ts';
import { onDownloadFinished } from './games/download-finished.ts';
import { createGames } from './games/index.ts';
import { gameConfigFeed } from './games/element-sources.ts';
import { defaultRomSites } from './games/rom-sites.ts';
import { createLanguageService, useLanguage } from './i18n/index.ts';
import { t } from './i18n/current.ts';
import { registerIpc } from './ipc/handlers/index.ts';
import { mainContext } from './ipc/main-context.ts';
import { createLibraryService } from './library/service.ts';
import { catalogFollow } from './files/follow.ts';
import { managedRoots } from './files/roots.ts';
import { createFilesService } from './files/service.ts';
import { registerMediaProtocol, registerMediaScheme } from './media-protocol/index.ts';
import { createUserMeta } from './meta/user-meta.ts';
import {
  createContextHandler,
  createJournal,
  createPluginBridges,
  createPluginService,
  createPluginSettings,
  createPluginState,
  electronRunners,
  folderPicker,
  PLUGIN_SCHEME_PRIVILEGES,
  pluginStorages,
  safeStorageBox,
} from './plugins/index.ts';
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
import { tvConfigFeed } from './tv/element-sources.ts';
import { siteConfigFeed } from './web/element-sources.ts';
import { createUsageService } from './usage/index.ts';
import { chromeLikeUserAgent, createWebLayer, nativeUserAgent, WEB_PARTITION, type ViewLike, type WebExtension, type WebManagerDeps } from './web/index.ts';
import { createDialogs } from './window/dialogs.ts';
import { createMainWindow } from './window/main-window.ts';

const PLATFORM = process.platform;

// Dossier de données isolé (tests de bout en bout, essais) : fixé avant toute lecture de config ou de cache
// (aucun module ne lit `userData` au chargement).
if (process.env.MIRE_USER_DATA) app.setPath('userData', process.env.MIRE_USER_DATA);

// Identité « Chrome » pour toute l'application, fixée avant la création de la moindre page (src/main/web/user-agent.ts).
const NATIVE_UA = nativeUserAgent(app.userAgentFallback, app.getName());
app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback, app.getName());

// Le schéma media:// sert les fichiers locaux à l'interface, avec gestion des plages (avance rapide). Le schéma
// mire-plugin:// (P3-03, ADR 0002) n'est servi que sur les sessions de l'hôte isolé des plugins, jamais sur celle de
// la fenêtre ni des vues web : il est enregistré ici parce qu'Electron n'accepte qu'un appel avant `ready`.
registerMediaScheme(protocol, [PLUGIN_SCHEME_PRIVILEGES]);

/** Crée les services dans l'ordre, les relie, enregistre l'IPC et ouvre la fenêtre (application prête). */
function start(pending: PendingFiles): Running {
  const userData = app.getPath('userData');
  const files = dataPaths(userData);
  const dist = (...parts: string[]) => path.join(__dirname, '..', ...parts);

  // Configuration et données d'usage (« Reprendre », positions, volume, recherches récentes).
  const config = createConfigService({ file: files.config });
  const usage = createUsageService({ file: files.usage });
  // Catalogue d'éléments : alimenté par les analyses de la bibliothèque ; l'interface historique ne s'en sert pas.
  const catalog = createCatalog({ dir: files.catalogSources });
  // Modifications faites à la main (tags, infos, images), qui reprennent l'ancien meta/meta.json.
  const find = createTargetFinder(catalog);
  const overrides = createOverrides({ file: files.catalogOverrides, legacyFile: files.meta, find });
  // Infos en ligne (fiches des fournisseurs), qui reprennent l'ancien scrape/db.json.
  const metadata = createMetadataStore({ file: files.catalogMetadata, legacyFile: files.scrapeDb, find });

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

  // Chaque analyse de la bibliothèque alimente aussi le catalogue d'éléments.
  const library = createLibraryService({ config, access, catalog });
  const dialogs = createDialogs({ dialog, window: window.get, itemFromPath: library.itemFromPath });
  // Façade de l'interface historique sur les modifications faites à la main.
  const meta = createUserMeta({ overrides, imgDir: files.metaImg, chooseImage: dialogs.chooseMetaImage });
  const tv = createTv({ config, http, toUi, catalog });

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
    catalog,
  });

  // Lecture des données, puis services qui en dépendent.
  config.load();
  usage.load();
  catalog.load();
  // Après le catalogue : les fiches de l'ancien meta.json se rangent sous la clé de leur élément.
  const migrated = overrides.load();
  if (migrated)
    console.log(
      `Catalogue : infos modifiées à la main reprises (${migrated.matched} rattachées à un élément, ${migrated.unmatched.length} gardées sous leur ancienne clé).`,
    );
  const scraped = metadata.load();
  if (scraped)
    console.log(
      `Catalogue : infos en ligne reprises (${scraped.matched} rattachées à un élément, ${scraped.unmatched.length} gardées sous leur ancienne clé).`,
    );
  // Tags et infos effectifs, index ; les règles par extension, les consoles et l'ordre des fournisseurs suivent la
  // configuration. Tags automatiques internes (séries, films, musique, consoles, photos), puis infos en ligne : le
  // moteur fait passer les infos en ligne avant celles des tags automatiques, quel que soit l'ordre de la liste.
  // Tags automatiques des plugins actifs (P3-03) : branchés une fois l'hôte de plugins créé, plus bas.
  let pluginTaggers: () => Contributor[] = () => [];
  const contributors = () => [
    ...builtinTaggers(() => config.get().emulators).map(taggerContributor),
    ...pluginTaggers(),
    ...metadataContributors(metadata, metadataOrder(config.get().catalog)),
  ];
  const registry = createRegistry(t);
  const tags = createTagEngine({
    catalog,
    overrides,
    registry,
    rules: () => fileTagRules(config.get().catalog),
    contributors: contributors(),
  });
  config.onChange((next, prev) => {
    if (JSON.stringify(next.catalog?.fileTags) !== JSON.stringify(prev.catalog?.fileTags)) tags.refreshRules();
    const providers = JSON.stringify(next.catalog?.metadataProviders) !== JSON.stringify(prev.catalog?.metadataProviders);
    if (providers || JSON.stringify(next.emulators) !== JSON.stringify(prev.emulators)) tags.setContributors(contributors());
  });
  // Pages : définitions lues, rien n'est calculé avant la première demande ; les pages touchées sont annoncées.
  const catalogPages = createPages({ file: files.catalogPages, engine: tags, catalog, translate: t });
  catalogPages.load();
  catalogPages.onChange((ids) => toUi('pages:changed', { pages: ids }));
  // Listes : fichier lu ; un élément disparu ou revenu fait annoncer les listes qui le contiennent.
  const lists = createLists({ file: files.catalogLists, engine: tags });
  lists.load();
  lists.onChange((ids) => toUi('lists:changed', { lists: ids }));
  // Gestion des fichiers (P2-10) : seulement sous les dossiers locaux de la configuration ; suppression vers la
  // corbeille. Le catalogue suit ; les éléments déplacés reviennent sous leur nouvelle clé à l'analyse suivante,
  // lancée peu après la dernière opération (une sélection de plusieurs fichiers ne lance qu'une analyse).
  let rescanTimer: NodeJS.Timeout | undefined;
  const rescan = () => {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => library.scan().catch((err: Error) => console.error('Catalogue (fichiers) :', err.message)), 2000);
  };
  const fileManager = createFilesService({
    roots: () => managedRoots(config.get()),
    ops: { trash: (p) => shell.trashItem(p) },
    follow: catalogFollow({ catalog, overrides, metadata, lists, usage, rescan }),
  });
  // Recherche : textes préparés à la première recherche, puis suivis par le moteur de tags.
  const search = createSearch({ engine: tags, catalog, pages: catalogPages, registry, translate: t });
  // Hôte de plugins (P3-03) : plugins inclus (resources/plugins/) et installés (userData/plugins/). Leurs tags et
  // infos vont au registre, leurs textes au moteur de traduction, leurs tags automatiques au moteur de tags. Sans
  // plugin, rien n'est créé ni démarré. Leur contexte (P3-04) : client HTTP du cœur limité aux hôtes déclarés,
  // dossiers accordés par l'utilisateur (mémorisés dans l'état), stockage dans userData/plugin-data/<id>/, réglages
  // sous `plugins.<id>` dans la configuration (secrets chiffrés par safeStorage quand le système le permet).
  const pluginState = createPluginState(files.pluginState);
  const storages = pluginStorages(files.pluginData);
  const pickFolder = folderPicker(dialog, window.get, (id) => ({
    title: t('plugins.folder.title', { name: plugins.list().find((p) => p.id === id)?.name ?? id }),
    button: t('plugins.folder.button'),
  }));
  const plugins = createPluginService({
    roots: {
      bundled: app.isPackaged ? path.join(process.resourcesPath, 'plugins') : path.join(__dirname, '..', '..', 'resources', 'plugins'),
      installed: files.plugins,
    },
    appVersion: app.getVersion(),
    languages: Object.keys(BUILTIN_CATALOGS),
    state: pluginState,
    journal: createJournal({ dir: files.pluginLogs }),
    context: createContextHandler({ pickFolder, folders: { list: pluginState.folders, add: pluginState.addFolder }, storage: storages.of }),
    settings: createPluginSettings({
      read: () => config.get().plugins,
      write: (id, values) => config.update((d) => void (d.plugins = { ...(d.plugins ?? {}), [id]: values })),
      box: safeStorageBox(safeStorage),
    }),
    flush: storages.flush,
    dropData: storages.drop,
    tagRegistry: registry,
    setTexts: (key, texts) => i18n.setPluginTexts(key, texts),
    translate: t,
    locale: () => i18n.language(),
    runners: electronRunners(dist('plugin-host')),
    onTaggersChange: () => tags.setContributors(contributors()),
    refresh: (keys) => tags.refresh(keys),
  });
  pluginTaggers = plugins.taggerContributors;
  // Sources, infos en ligne et recherche des plugins (P3-04) : catalogue, moteur d'infos, `pluginBridges.search`.
  const pluginBridges = createPluginBridges({ service: plugins, catalog });
  i18n.onChange((info) => plugins.emit('language', { language: info.language }));
  // Une fiche enregistrée (ou oubliée) recalcule son élément ; une adresse analysée retrouve sa fiche.
  metadata.onChange((keys) => tags.refresh(keys));
  catalog.onChange(({ added }) => {
    if (added.length) metadata.adopt(added.map((k) => catalog.get(k)).filter((e) => !!e));
  });
  // Jeux ajoutés à la main, marque-pages, sites, portail de télévision : leurs éléments suivent la configuration ;
  // les consoles, dossiers de jeux et services qui n'y sont plus quittent le catalogue (P2-03). Après le moteur et
  // l'abonnement ci-dessus : un élément qui arrive retrouve aussitôt les fiches gardées sous son ancienne clé.
  const syncConfig = (cfg: Config) => {
    try {
      syncFeeds(catalog, [gameConfigFeed(cfg), tvConfigFeed(cfg), siteConfigFeed(cfg)]);
    } catch (err) {
      console.error('Catalogue (configuration) :', (err as Error).message);
    }
  };
  syncConfig(config.get());
  config.onChange((next) => syncConfig(next));
  const sevenZipPath = path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const archive = createArchive({ sevenZipPath, copyPath: files.sevenZip });
  const scraper = createScraper({
    dataDir: userData,
    getConfig: config.get,
    listRoms: games.listRoms,
    onProgress: (p) => toUi('scrape-progress', p),
    store: metadata.scrapeStore,
    extraProviders: pluginBridges.metadataProviders,
  });
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
  const services = {
    config,
    usage,
    i18n,
    catalog,
    tags,
    pages: catalogPages,
    lists,
    search,
    fileManager,
    plugins,
    access,
    window,
    pending,
    meta,
    files,
    library,
    dialogs,
    web,
    scraper,
    store,
    downloads,
    adblock,
  };
  const searchStreaming = (query: string) => streaming.search(query, { getConfig: () => config.get() });
  registerIpc(ipcMain, mainContext({ ...services, electron: { app, dialog, shell }, players, tv, drm, games, searchStreaming }));
  window.open();
  // Après la fenêtre : la découverte et le démarrage des plugins ne retardent pas l'affichage.
  // Code sensible des plugins inclus (P3-05) : extensions des vues web et moteurs de téléchargement, branchés une fois,
  // après le démarrage des plugins (en changer demande de redémarrer Mire).
  plugins
    .start()
    .then(() => {
      webLayer.addExtensions(plugins.local('webExtensions').map((c) => c.instance as WebExtension));
      downloads.addEngines(plugins.local('downloaders').map((c) => ({ pluginId: c.pluginId, engine: c.instance as PluginDownloader })));
    })
    .catch((err: Error) => console.error('Plugins :', err.message));

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
      const flushes = [scraper, downloads, usage, catalog, overrides, metadata].map((m) => () => m.flush());
      flushes.push(() => plugins.stop());
      return flushWithin(flushes, 2000);
    },
  };
}

runApp({ app, platform: PLATFORM, argv: process.argv, packaged: app.isPackaged, start });
