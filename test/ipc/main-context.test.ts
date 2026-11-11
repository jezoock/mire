// Contexte des handlers IPC assemblé à partir des services (remplace l'objet ipcContext de l'ancien index.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingFiles } from '../../src/main/app/lifecycle.ts';
import { mainContext, type MainServices } from '../../src/main/ipc/main-context.ts';
import { locationError } from '../../src/main/library/index.ts';

function services() {
  let win: unknown = null;
  let meta: Record<string, unknown> = { a: { title: 'A' } };
  const fn = (name: string) => () => name;
  const s = {
    electron: { app: { quit() {} } },
    config: { name: 'config' },
    usage: { name: 'usage' },
    i18n: { name: 'i18n' },
    access: { name: 'access' },
    window: { get: () => win, themeBackground: fn('theme') },
    pending: createPendingFiles(['a.mkv']),
    meta: { all: () => meta, save: fn('save'), set: fn('set'), pickImage: fn('pickImage') },
    files: { config: '/data/config.json', metaDir: '/data/meta' },
    library: { scan: fn('scan'), findSubtitles: fn('subs'), itemFromPath: fn('item') },
    dialogs: { openMedia: fn('openMedia'), pickFolder: fn('pickFolder'), pickFile: fn('pickFile') },
    web: { name: 'web' },
    scraper: { name: 'scraper' },
    store: { name: 'store' },
    downloads: { name: 'downloads' },
    adblock: { name: 'adblock' },
    players: { playExternal: fn('play') },
    tv: { detect: fn('detect'), channels: fn('channels') },
    drm: { status: fn('drm') },
    searchStreaming: fn('search'),
    games: { name: 'games' },
  };
  return {
    s: s as unknown as MainServices,
    setWindow: (w: unknown) => (win = w),
    setMeta: (m: Record<string, unknown>) => (meta = m),
  };
}

describe('mainContext', () => {
  it('fenêtre, fichiers en attente et infos manuelles : lus au moment de l’appel', () => {
    const { s, setWindow, setMeta } = services();
    const ctx = mainContext(s);
    assert.equal(ctx.mainWindow, null);
    setWindow('fenêtre');
    assert.equal(ctx.mainWindow, 'fenêtre');
    assert.deepEqual(ctx.pendingFiles, ['a.mkv']);
    ctx.pendingFiles = [];
    assert.deepEqual(s.pending.get(), []);
    setMeta({ b: {} });
    assert.deepEqual(ctx.userMeta, { b: {} });
  });

  it('chaque fonction du contexte vient du service qui la porte', () => {
    const ctx = mainContext(services().s);
    const calls = {
      themeBackground: 'theme',
      scanLibrary: 'scan',
      findSubtitles: 'subs',
      itemFromPath: 'item',
      openMediaDialog: 'openMedia',
      pickFolder: 'pickFolder',
      pickFile: 'pickFile',
      saveMeta: 'save',
      setMeta: 'set',
      pickMetaImage: 'pickImage',
      playExternal: 'play',
      detectTvService: 'detect',
      fetchChannels: 'channels',
      drmStatus: 'drm',
      searchStreaming: 'search',
    } as const;
    for (const [key, expected] of Object.entries(calls)) assert.equal((ctx as any)[key](), expected, key);
    assert.equal(ctx.configPath(), '/data/config.json');
    assert.equal(ctx.metaDir(), '/data/meta');
    assert.equal(ctx.locationError, locationError);
    for (const key of ['config', 'usage', 'i18n', 'access', 'web', 'scraper', 'store', 'downloads', 'adblock', 'games']) {
      assert.deepEqual((ctx as any)[key], { name: key }, key);
    }
  });
});
