'use strict';
// Bloqueur de publicités en extension de vue web (P1-13) : rien n'est téléchargé tant qu'il est désactivé ; une fois
// activé, il bloque, compte, respecte les sites autorisés et annule les redirections publicitaires.
const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let createAdblock;
before(() => {
  // Hors d'Electron, le paquet « electron » ne sert qu'à trouver (voire télécharger) le moteur : on le remplace.
  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: {} };
  ({ createAdblock } = require('../../src/main/web/adblock.ts'));
});

const pages = (id) => ({ 7: 'https://site.example/', 8: 'https://autorise.example/' })[id];
const LIST = ['||regie.example^', 'example.com##.pub'].join('\n');

function setup({ enabled = false, allowlist = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-adblock-'));
  let config = { adblock: { enabled, allowlist, customLists: [] } };
  const fetched = [];
  const counted = [];
  const cosmetic = [];
  const adblock = createAdblock({
    dataDir,
    getConfig: () => config,
    saveConfig: (next) => (config = next),
    onCount: (id, n) => counted.push([id, n]),
    fetchText: async (url) => (fetched.push(url), LIST),
    fetch: async () => {
      throw new Error('hors ligne');
    },
    contentsFromId: (id) => (pages(id) ? { getURL: () => pages(id), isDestroyed: () => false, insertCSS: async () => {} } : null),
    cosmetics: (ses, blocker) => ({ blocker, enable: () => cosmetic.push('on'), disable: () => cosmetic.push('off') }),
  });
  adblock.attach({});
  return { adblock, dataDir, fetched, counted, cosmetic, config: () => config };
}

const request = (adblock, details) => new Promise((resolve) => resolve(adblock.webRequest.onBeforeRequest(details)));

describe('bloqueur en extension de vue web', () => {
  test('ne télécharge aucune liste au démarrage ni ne bloque', async () => {
    const t = setup();
    assert.equal(await t.adblock.start(), false);
    assert.deepEqual(t.fetched, []);
    assert.equal(t.adblock.status().ready, false);
    assert.deepEqual(await request(t.adblock, { url: 'https://regie.example/x.js', resourceType: 'script', webContentsId: 7 }), {});
    assert.equal(t.adblock.beforePageScript('https://site.example/'), '');
    assert.equal(t.adblock.guardNavigation('https://regie.example/', 'https://site.example/'), false);
    assert.equal(t.adblock.activeOn('https://site.example/'), false);
    assert.deepEqual(t.cosmetic, []);
    assert.equal(fs.existsSync(path.join(t.dataDir, 'adblock')), false);
  });

  test('activé : listes téléchargées, puis blocage, compteur et sites autorisés', async () => {
    const t = setup({ allowlist: ['autorise.example'] });
    await t.adblock.start();
    const st = await t.adblock.setEnabled(true);
    assert.equal(st.enabled, true);
    assert.equal(st.ready, true);
    assert.ok(t.fetched.length > 0);
    assert.deepEqual(t.cosmetic, ['on']);

    assert.deepEqual(await request(t.adblock, { url: 'https://regie.example/x.js', resourceType: 'script', webContentsId: 7 }), { cancel: true });
    assert.equal(t.adblock.blockedCount(7), 1);
    assert.deepEqual(t.counted, [[7, 1]]);
    assert.deepEqual(await request(t.adblock, { url: 'https://cdn.example/x.js', resourceType: 'script', webContentsId: 7 }), {});
    // Site autorisé : rien n'est bloqué ni compté.
    assert.deepEqual(await request(t.adblock, { url: 'https://regie.example/y.js', resourceType: 'script', webContentsId: 8 }), {});
    assert.equal(t.adblock.blockedCount(8), 0);
    assert.equal(t.adblock.activeOn(pages(8)), false);
    t.adblock.resetPage(7);
    assert.equal(t.adblock.blockedCount(7), 0);

    // Redirection publicitaire vers une régie, mais pas une navigation dans le même site.
    assert.equal(t.adblock.guardNavigation('https://regie.example/clic', 'https://site.example/'), true);
    assert.equal(t.adblock.guardNavigation('https://site.example/2', 'https://site.example/'), false);
    assert.equal(t.adblock.guardNavigation('https://regie.example/clic', 'https://autorise.example/'), false);

    // Désactivé de nouveau : plus rien n'est bloqué, le masquage est retiré.
    await t.adblock.setEnabled(false);
    assert.deepEqual(t.cosmetic, ['on', 'off']);
    assert.deepEqual(await request(t.adblock, { url: 'https://regie.example/x.js', resourceType: 'script', webContentsId: 7 }), {});
  });

  test('moteur en cache : activé au démarrage, rien n’est retéléchargé', async () => {
    const first = setup({ enabled: true });
    await first.adblock.start();
    assert.ok(first.fetched.length > 0);
    const again = createAdblock({
      dataDir: first.dataDir,
      getConfig: first.config,
      saveConfig: () => {},
      onCount: () => {},
      fetchText: async () => {
        throw new Error('ne doit pas télécharger');
      },
      contentsFromId: () => null,
      cosmetics: (ses, blocker) => ({ blocker, enable() {}, disable() {} }),
    });
    again.attach({});
    assert.equal(await again.start(), true);
    assert.equal(again.status().ready, true);
  });
});
