// Contrat IPC : la table, le preload et les handlers du processus principal décrivent les mêmes méthodes,
// avec exactement les noms et les canaux de l'ancien preload (src/preload/preload.js avant P1-08).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IPC_EVENTS, IPC_METHODS, createApi, type IpcRendererLike } from '@mire/shared/ipc';
import { DOMAINS, createHandlers } from '../../src/main/ipc/handlers/index.ts';
import { checkImplementations, registerHandlers } from '../../src/main/ipc/register.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');

// Copie figée de l'ancien preload : méthode de window.api → canal ipcRenderer.invoke.
const ORIGINAL_METHODS: Record<string, string> = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  revealConfig: 'config:reveal',
  scanLibrary: 'library:scan',
  subtitles: 'media:subtitles',
  openMediaDialog: 'media:openDialog',
  fromPaths: 'media:fromPaths',
  takePendingFiles: 'app:pendingFiles',
  pickFolder: 'dialog:folder',
  pickFile: 'dialog:file',
  playExternal: 'player:external',
  tvChannels: 'tv:channels',
  webOpen: 'web:open',
  webShow: 'web:show',
  webHide: 'web:hide',
  webBounds: 'web:bounds',
  webNav: 'web:nav',
  webClose: 'web:close',
  webFocus: 'web:focus',
  webKey: 'web:key',
  webLearnSearch: 'web:learnSearch',
  webSessions: 'web:sessions',
  romSites: 'roms:sites',
  romDownload: 'roms:download',
  bookmarkAdd: 'bookmarks:add',
  bookmarkRemove: 'bookmarks:remove',
  bookmarkOpen: 'bookmarks:open',
  gameBookmarkAdd: 'gameBookmarks:add',
  gameBookmarkSetConsole: 'gameBookmarks:setConsole',
  gameBookmarkRemove: 'gameBookmarks:remove',
  gameBookmarkDownload: 'gameBookmarks:download',
  romListSource: 'roms:listSource',
  gameDelete: 'games:delete',
  gamesCleanup: 'games:cleanup',
  downloadsList: 'downloads:list',
  downloadsAddUrl: 'downloads:addUrl',
  downloadsAddTorrentFile: 'downloads:addTorrentFile',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsCancel: 'downloads:cancel',
  downloadsRemove: 'downloads:remove',
  downloadsClear: 'downloads:clear',
  downloadsReveal: 'downloads:reveal',
  downloadsRunInstaller: 'downloads:runInstaller',
  downloadsPickDir: 'downloads:pickDir',
  configExport: 'config:export',
  configImport: 'config:import',
  tvDetect: 'tv:detect',
  tvSetActive: 'tv:setActive',
  biosAdd: 'store:biosAdd',
  biosOpen: 'store:biosOpen',
  drmStatus: 'drm:status',
  adblockStatus: 'adblock:status',
  adblockSetEnabled: 'adblock:setEnabled',
  adblockToggleSite: 'adblock:toggleSite',
  adblockSetLists: 'adblock:setLists',
  adblockUpdate: 'adblock:update',
  searchStreaming: 'search:streaming',
  scanGameSources: 'games:scanSources',
  launchGamePath: 'games:launchPath',
  metaAll: 'meta:all',
  metaSet: 'meta:set',
  metaPickImage: 'meta:pickImage',
  metaReset: 'meta:reset',
  checkLocation: 'location:check',
  scrapeData: 'scrape:data',
  scrapeRun: 'scrape:run',
  scrapeOne: 'scrape:one',
  scrapeCandidates: 'scrape:candidates',
  pickImageFile: 'image:pick',
  scrapeCancel: 'scrape:cancel',
  scrapeForget: 'scrape:forget',
  scrapeClear: 'scrape:clear',
  storeCatalog: 'store:catalog',
  storeInstall: 'store:install',
  storeUninstall: 'store:uninstall',
  storeGame: 'store:game',
  storeImport: 'store:import',
  storePickRoot: 'store:pickRoot',
  launchGame: 'games:launch',
  addGame: 'games:add',
  listRoms: 'emu:roms',
  launchRom: 'emu:launch',
  toggleFullscreen: 'window:fullscreen',
  quit: 'app:quit',
};

// Copie figée de l'ancien preload : abonnement de window.api → canal ipcRenderer.on.
const ORIGINAL_EVENTS: Record<string, string> = {
  onTvDetected: 'tv-detected',
  onDownload: 'download',
  onDownloadFinished: 'download-finished',
  onDownloadAdded: 'download-added',
  onRomDownload: 'rom-download',
  onWebBlocked: 'web-blocked',
  onWebAdblocked: 'web-adblocked',
  onRomProgress: 'rom-progress',
  onScrapeProgress: 'scrape-progress',
  onStoreProgress: 'store-progress',
  onOpenFiles: 'open-files',
  onWebState: 'web-state',
  onWebSessions: 'web-sessions',
  onWebError: 'web-error',
  onWebClosed: 'web-closed',
  onWebFocus: 'web-focus',
  onMireFocus: 'web-mire-focus',
};

// Méthodes ajoutées après P1-08 (absentes de l'ancien preload).
const ADDED_METHODS: Record<string, string> = {
  gameSystems: 'games:systems', // P1-03 : référentiel des systèmes pour l'interface
};

// Méthode de l'ancien preload qui ne passe pas par l'IPC.
const LOCAL_METHODS = ['pathForFile'];

// Contexte factice : les fabriques de handlers ne font que créer des fonctions, sans rien appeler.
const fakeContext = () => new Proxy({}, { get: () => () => undefined }) as unknown as MainContext;

describe('contrat IPC : la table', () => {
  it('reprend les 85 méthodes et leurs canaux, sans en retirer, plus les méthodes ajoutées depuis', () => {
    assert.equal(Object.keys(ORIGINAL_METHODS).length, 85);
    assert.deepEqual({ ...IPC_METHODS }, { ...ORIGINAL_METHODS, ...ADDED_METHODS });
  });

  it('reprend les 17 événements et leurs canaux', () => {
    assert.equal(Object.keys(ORIGINAL_EVENTS).length, 17);
    assert.deepEqual({ ...IPC_EVENTS }, ORIGINAL_EVENTS);
  });

  it('n’emploie chaque canal qu’une fois', () => {
    const channels = Object.values(IPC_METHODS);
    assert.equal(new Set(channels).size, channels.length);
    const events = Object.values(IPC_EVENTS);
    assert.equal(new Set(events).size, events.length);
  });
});

describe('contrat IPC : window.api', () => {
  const calls: unknown[][] = [];
  const listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  const ipc: IpcRendererLike = {
    invoke: async (channel, ...args) => {
      calls.push([channel, ...args]);
      return 'réponse';
    },
    on: (channel, listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    removeListener: (channel, listener) => listeners.get(channel)?.delete(listener),
  };
  const api = createApi(ipc) as unknown as Record<string, (...args: unknown[]) => unknown>;

  it('a exactement les noms de l’ancien preload, plus les méthodes ajoutées', () => {
    const names = [...Object.keys(api), ...LOCAL_METHODS].sort();
    assert.deepEqual(names, [...Object.keys(ORIGINAL_METHODS), ...Object.keys(ADDED_METHODS), ...Object.keys(ORIGINAL_EVENTS), ...LOCAL_METHODS].sort());
  });

  it('le preload expose createApi et pathForFile, et rien d’autre', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
    assert.match(source, /\.\.\.createApi\(ipcRenderer\)/);
    assert.match(source, /pathForFile: \(file\) =>/);
    // Aucun appel générique sur un canal choisi par la page.
    assert.doesNotMatch(source, /ipcRenderer\.(invoke|send|sendSync|on)\(/);
  });

  it('transmet le canal et tous les arguments', async () => {
    assert.equal(await api.webOpen('netflix', 'https://www.netflix.com/', { site: 1 }), 'réponse');
    assert.equal(await api.getConfig(), 'réponse');
    assert.deepEqual(calls, [['web:open', 'netflix', 'https://www.netflix.com/', { site: 1 }], ['config:get']]);
  });

  it('remet le contenu de l’événement au rappel, et renvoie de quoi se désabonner', () => {
    const received: unknown[] = [];
    const off = api.onDownload((p: unknown) => received.push(p)) as () => void;
    for (const listener of listeners.get('download')!) listener({ sender: null }, { id: 'a' });
    off();
    assert.equal(listeners.get('download')!.size, 0);
    assert.deepEqual(received, [{ id: 'a' }]);
  });
});

describe('contrat IPC : processus principal', () => {
  it('chaque méthode de la table a un handler et un seul, et chaque handler est dans la table', () => {
    const owners = new Map<string, string[]>();
    for (const [domain, factory] of Object.entries(DOMAINS)) {
      for (const name of Object.keys(factory(fakeContext()))) owners.set(name, [...(owners.get(name) || []), domain]);
    }
    const duplicated = [...owners].filter(([, domains]) => domains.length > 1);
    assert.deepEqual(duplicated, []);
    assert.deepEqual([...owners.keys()].sort(), Object.keys(IPC_METHODS).sort());
    for (const fn of Object.values(createHandlers(fakeContext()))) assert.equal(typeof fn, 'function');
  });

  it('enregistre un handler par canal', () => {
    const registered: string[] = [];
    registerHandlers({ handle: (channel) => registered.push(channel) }, IPC_METHODS, createHandlers(fakeContext()));
    assert.deepEqual(registered.sort(), Object.values(IPC_METHODS).sort());
  });

  it('refuse une implémentation manquante ou hors table', () => {
    const table = { a: 'x:a', b: 'x:b' };
    assert.throws(() => checkImplementations(table, { a: () => 1 }), /manquante \(b\)/);
    assert.throws(() => checkImplementations(table, { a: () => 1, b: () => 2, c: () => 3 }), /hors table \(c\)/);
    assert.doesNotThrow(() => checkImplementations(table, { a: () => 1, b: () => 2 }));
  });

  it('transmet les arguments et renvoie { ok: false, error } quand un handler échoue, comme avant', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const errors: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      registerHandlers(
        { handle: (channel, fn) => handlers.set(channel, fn) },
        { add: 'calc:add', fail: 'calc:fail' },
        {
          add: async (a: number, b: number) => a + b,
          fail: () => {
            throw new Error('Panne.');
          },
        },
      );
      assert.equal(await handlers.get('calc:add')!({}, 2, 3), 5);
      assert.deepEqual(await handlers.get('calc:fail')!({}), { ok: false, error: 'Panne.' });
      assert.equal(errors[0][0], 'calc:fail');
    } finally {
      console.error = consoleError;
    }
  });

  it('chaque événement envoyé par le processus principal est dans la table, et inversement', () => {
    const sent = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(js|ts)$/.test(entry.name)) {
          const source = fs.readFileSync(file, 'utf8');
          for (const m of source.matchAll(/(?:toUi|webContents\.send)\('([^']+)'/g)) sent.add(m[1]);
        }
      }
    };
    walk(path.join(ROOT, 'src', 'main'));
    assert.deepEqual([...sent].sort(), Object.values(IPC_EVENTS).sort());
  });
});
