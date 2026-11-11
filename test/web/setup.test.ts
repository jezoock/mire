// Assemblage des vues web (reprise de setupWebSession / adblockReady de l'ancien index.js) : extensions branchées
// sur la session dans l'ordre (bloqueur, puis connexion Google), Widevine lancé, premier site en attente du bloqueur.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { createWebLayer as CreateWebLayer } from '../../src/main/web/setup.ts';

let createWebLayer: typeof CreateWebLayer;
before(async () => {
  // Hors d'Electron, le paquet « electron » ne sert qu'à trouver le moteur : on le remplace (comme adblock.test.js).
  const require = createRequire(import.meta.url);
  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: {} } as never;
  ({ createWebLayer } = await import('../../src/main/web/setup.ts'));
});

function fakeSession() {
  const calls: string[] = [];
  const session = {
    calls,
    on: (event: string) => void calls.push(`on:${event}`),
    setPermissionRequestHandler: () => void calls.push('permissions'),
    registerPreloadScript: (s: { filePath?: string }) => void calls.push(`preload:${s.filePath ?? 'moteur'}`),
    unregisterPreloadScript: () => {},
    webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {}, onHeadersReceived() {} },
  };
  return session;
}

function setup({ widevine = Promise.resolve() }: { widevine?: Promise<unknown> } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-web-'));
  const session = fakeSession();
  const config = { adblock: { enabled: false, allowlist: [], customLists: [] } };
  let started = 0;
  const layer = createWebLayer({
    window: () => null,
    createView: () => {
      throw new Error('aucune vue dans ce test');
    },
    config: { get: () => config as never, update: () => config as never, replace: () => config as never },
    defaultRomSites: () => [],
    guessSystem: () => '',
    downloads: () => null,
    openInBrowser: async () => ({ ok: true }),
    toUi: () => {},
    components: {
      whenReady: () => {
        started++;
        return widevine;
      },
      status: () => ({}),
      WIDEVINE_CDM_ID: 'widevine',
    } as never,
    dataDir,
    session: () => session as never,
    ipcMain: { on: () => {} },
    preloadPath: '/dist/preload/web-preload.js',
    google: { nativeUserAgent: 'Electron', contentsFromId: () => null },
    drmTimeoutMs: 5,
    adblockTimeoutMs: 5,
  });
  return { layer, session, started: () => started };
}

describe('createWebLayer', () => {
  it('avant le démarrage : ni bloqueur ni Widevine', () => {
    const { layer, session, started } = setup();
    assert.equal(layer.adblock(), null);
    assert.deepEqual(session.calls, []);
    assert.equal(started(), 0);
  });

  it('démarrage : session préparée, extensions branchées, Widevine lancé ; bloqueur désactivé : rien à attendre', async () => {
    const { layer, session, started } = setup();
    const adblock = layer.start();
    assert.equal(layer.adblock(), adblock);
    assert.equal(started(), 1);
    assert.deepEqual(session.calls, ['on:will-download', 'permissions', 'preload:/dist/preload/web-preload.js']);
    assert.equal(adblock.status().enabled, false);
    assert.equal(adblock.status().ready, false);
  });
});
