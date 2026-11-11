'use strict';
// Les fichiers de données écrits par le stockage atomique sont identiques (octet pour octet) à ceux d'avant :
// même indentation, même ordre des clés, UTF-8, pas de saut de ligne final. Dossiers temporaires uniquement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const { createJsonStore } = require('../../src/main/storage/json-store.ts');
const { createScraper } = require('../../src/main/scrape/index.ts');
const { createDownloads } = require('../../src/main/downloads/index.ts');
const { createStore } = require('../../src/main/store/index.ts');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-fichiers-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshDir = () => fs.mkdirSync(path.join(root, `donnees-${++n}`), { recursive: true });
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};
const read = (file) => fs.readFileSync(file, 'utf8');

test('scrape/db.json : JSON compact, comme JSON.stringify(db)', async () => {
  const dataDir = freshDir();
  const file = path.join(dataDir, 'scrape', 'db.json');
  const db = {
    items: { 'movie:amelie': { title: 'Le Fabuleux Destin d’Amélie Poulain', year: '2001', rev: 3, at: 1 }, 'tv:x': { title: '🎬', rev: 3, at: 2 } },
    misses: { 'movie:inconnu': 5 },
    extra: true,
  };
  write(file, JSON.stringify(db));
  const scraper = createScraper({ dataDir, getConfig: () => ({}), listRoms: () => [], onProgress: () => {} });
  scraper.forget('movie:inconnu');
  await scraper.flush();
  delete db.misses['movie:inconnu'];
  assert.equal(read(file), JSON.stringify(db));
});

test('telechargements.json : indentation 1, installers toujours présent', async () => {
  const dataDir = freshDir();
  const file = path.join(dataDir, 'telechargements.json');
  const previous = { id: 'aaa', kind: 'http', createdAt: 1, name: 'Démo.zip', state: 'done', installers: ['setup.exe'] };
  write(file, JSON.stringify({ items: [previous] }, null, 1));
  const downloads = createDownloads({
    dataDir,
    getConfig: () => ({ emulators: [] }),
    getSession: () => ({}),
    defaultDir: path.join(dataDir, 'Téléchargements'),
    onChange: () => {},
    onFinished: () => {},
  });
  await downloads.start();
  downloads.addPending('https://exemple.fr/Jeu%20d%C3%A9mo.zip', { name: 'Jeu démo' });
  await downloads.flush();
  // Ce qu'écrivait l'ancien code, à partir des mêmes fiches.
  const list = [...downloads.list()].reverse().map(({ installers, ...rest }) => ({ ...rest, installers: installers || [] }));
  assert.equal(list.length, 2);
  assert.equal(read(file), JSON.stringify({ items: list }, null, 1));
});

test('emulators/installed.json : indentation 2', async () => {
  const dataDir = freshDir();
  const file = path.join(dataDir, 'emulators', 'installed.json');
  const meta = { retroarch: { version: '1.19', exe: '/opt/retroarch', systems: ['snes'], at: 1 }, duckstation: { version: 'v0.1', exe: '/opt/duck', at: 2 } };
  write(file, JSON.stringify(meta, null, 2));
  let config = { emulators: [] };
  const store = createStore({
    dataDir,
    defaultRomsRoot: path.join(dataDir, 'ROMs'),
    getConfig: () => config,
    saveConfig: (next) => {
      config = next;
      return next;
    },
    onProgress: () => {},
    extract: async () => {},
  });
  await store.uninstall('duckstation');
  delete meta.duckstation;
  assert.equal(read(file), JSON.stringify(meta, null, 2));
});

// meta.json (index.js) et adblock/listes.json (adblock.js) chargent Electron : on vérifie les mêmes réglages
// du stockage que dans ces modules contre l'expression d'écriture d'avant.
test('meta/meta.json : indentation 2 ; adblock/listes.json : JSON compact', () => {
  const dataDir = freshDir();
  const userMeta = { '/films/Amélie.mkv': { title: 'Amélie', genre: 'Comédie' } };
  const meta = createJsonStore(path.join(dataDir, 'meta', 'meta.json'), { defaults: {}, space: 2 });
  meta.set(userMeta);
  assert.equal(read(meta.file), JSON.stringify(userMeta, null, 2));

  const info = { updated: 1700000000000, loaded: ['https://a/liste.txt'], failed: [], engine: '2.20.1' };
  const lists = createJsonStore(path.join(dataDir, 'adblock', 'listes.json'), { defaults: { updated: 0, loaded: [], failed: [] } });
  lists.set(info);
  assert.equal(read(lists.file), JSON.stringify(info));
});
