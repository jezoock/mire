// Gestionnaire de téléchargements (P1-19) : transitions d'état au redémarrage, post-traitement, fichiers compagnons
// d'un index de disque et commande « télécharger dans le cache puis prévenir ». Chromium est remplacé par une
// fausse session : aucun accès au réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDownloads } from '../../src/main/downloads/index.ts';
import type { DownloadRecord } from '../../src/main/downloads/index.ts';
import { companionsOf, finishDownload, findInstallers } from '../../src/main/downloads/finish.ts';
import { dataPaths } from '../../src/main/storage/paths.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-downloads-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshDir = () => {
  const dir = path.join(root, `essai-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Faux `DownloadItem` d'Electron : le test décide de la fin du téléchargement.
class FakeItem extends EventEmitter {
  url: string;
  savePath = '';
  paused = false;
  received = 0;
  constructor(url: string) {
    super();
    this.url = url;
  }
  getURL() {
    return this.url;
  }
  getURLChain() {
    return [this.url];
  }
  getFilename() {
    return decodeURIComponent(path.posix.basename(new URL(this.url).pathname));
  }
  getMimeType() {
    return 'application/octet-stream';
  }
  setSavePath(file: string) {
    this.savePath = file;
  }
  getTotalBytes() {
    return 100;
  }
  getReceivedBytes() {
    return this.received;
  }
  isPaused() {
    return this.paused;
  }
  canResume() {
    return true;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  cancel() {
    this.emit('done', {}, 'cancelled');
  }
  complete(content = 'contenu') {
    fs.writeFileSync(this.savePath, content);
    this.received = Buffer.byteLength(content);
    this.emit('done', {}, 'completed');
  }
}

async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface SetupOptions {
  emulators?: Array<Record<string, unknown>>;
  /** La session ne démarre rien : le téléchargement est demandé mais n'arrive jamais. */
  silent?: boolean;
  extract?: (archive: string, dest: string) => Promise<void>;
}

function setup({ emulators = [], extract = async () => {}, silent = false }: SetupOptions = {}) {
  const dataDir = freshDir();
  const transfers: FakeItem[] = [];
  const requested: string[] = [];
  const finished: DownloadRecord[] = [];
  const session = {
    downloadURL(url: string) {
      requested.push(url);
      if (silent) return;
      const item = new FakeItem(url);
      transfers.push(item);
      downloads.handleWebDownload(item);
    },
    fetch: () => Promise.reject(new Error('pas de réseau dans les tests')),
  };
  const downloads = createDownloads({
    dataDir,
    getConfig: () => ({ emulators: emulators as never[] }),
    getSession: () => session,
    extract,
    shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
    defaultDir: path.join(dataDir, 'Téléchargements'),
    onChange: () => {},
    onFinished: (it) => finished.push(it),
  });
  const transfer = (url: string) => transfers.find((t) => t.url === url)!;
  return { dataDir, downloads, transfers, transfer, finished, requested };
}

test('redémarrage : HTTP actif ou en pause → interrompu, torrent en extraction → terminé', async () => {
  const { dataDir, downloads } = setup();
  const base = { createdAt: 1, dir: '/x', console: null, consoleName: '', received: 5, total: 10, speed: 42, error: '', installers: [] };
  const fiches = [
    { ...base, id: 'h1', kind: 'http', name: 'a', source: 'https://a.test/a', state: 'downloading' },
    { ...base, id: 'h2', kind: 'http', name: 'b', source: 'https://a.test/b', state: 'paused' },
    { ...base, id: 'h3', kind: 'http', name: 'c', source: 'https://a.test/c', state: 'waiting' },
    { ...base, id: 'h4', kind: 'http', name: 'd', source: 'https://a.test/d', state: 'pending' },
    { ...base, id: 'h5', kind: 'http', name: 'e', source: 'https://a.test/e', state: 'done' },
    { ...base, id: 't1', kind: 'torrent', name: 'f', source: 'magnet:?xt=urn:btih:abc', state: 'extracting' },
    { ...base, id: 't2', kind: 'torrent', name: 'g', source: 'magnet:?xt=urn:btih:def', state: 'paused' },
  ];
  fs.writeFileSync(dataPaths(dataDir).downloads, JSON.stringify({ items: fiches }));
  await downloads.start();
  const state = Object.fromEntries(downloads.list().map((it) => [it.id, [it.state, it.speed]]));
  assert.deepEqual(state, {
    h1: ['interrupted', 0],
    h2: ['interrupted', 0],
    h3: ['interrupted', 0],
    h4: ['pending', 42],
    h5: ['done', 42],
    t1: ['done', 42],
    t2: ['paused', 42],
  });
  await downloads.stop();
});

test('post-traitement : archive décompressée pour la console, puis supprimée', async () => {
  const romsDir = path.join(freshDir(), 'snes');
  const extracted: string[] = [];
  const extract = async (archive: string, dest: string) => {
    extracted.push(archive);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'jeu.sfc'), 'rom');
  };
  const { downloads, transfer, finished } = setup({ emulators: [{ id: 'snes', name: 'Super Nintendo', romsDir, extensions: ['.sfc'] }], extract });
  await downloads.start();
  assert.deepEqual(downloads.addUrl('https://roms.test/jeu.zip', { console: 'snes' }), { ok: true });
  const t = transfer('https://roms.test/jeu.zip');
  assert.equal(t.savePath, path.join(romsDir, 'jeu.zip'));
  t.complete();
  await until(() => finished.length === 1);
  const [it] = downloads.list();
  assert.equal(it.state, 'done');
  assert.equal(it.extracted, true);
  assert.equal(it.consoleName, 'Super Nintendo');
  assert.deepEqual(extracted, [path.join(romsDir, 'jeu.zip')]);
  assert.equal(fs.existsSync(path.join(romsDir, 'jeu.zip')), false, 'archive temporaire supprimée');
  assert.equal(fs.readFileSync(path.join(romsDir, 'jeu', 'jeu.sfc'), 'utf8'), 'rom');
  await downloads.stop();
  await downloads.flush();
});

test('post-traitement : une archive lue par l’émulateur reste telle quelle ; un échec garde l’archive', async () => {
  const dir = freshDir();
  const it = (file: string) =>
    ({
      id: 'x',
      kind: 'http',
      createdAt: 1,
      name: path.basename(file),
      source: 'https://a.test/x',
      dir,
      console: 'c',
      consoleName: 'C',
      state: 'downloading',
      received: 0,
      total: 0,
      speed: 0,
      error: '',
      installers: [],
      file,
      companionsQueued: true,
    }) as DownloadRecord;
  const zip = path.join(dir, 'lisible.zip');
  fs.writeFileSync(zip, 'z');
  const done: DownloadRecord[] = [];
  const deps = {
    extract: async () => {
      throw new Error('archive abîmée');
    },
    update: (r: DownloadRecord, patch = {}) => Object.assign(r, patch),
    readableExtensions: () => ['.ZIP'],
    addUrl: () => assert.fail('aucun fichier compagnon attendu'),
    onFinished: (r: DownloadRecord) => done.push(r),
  };
  const ok = it(zip);
  await finishDownload(ok, [zip], deps);
  assert.equal(ok.state, 'done');
  assert.ok(fs.existsSync(zip));

  const bad = path.join(dir, 'abime.7z');
  fs.writeFileSync(bad, 'z');
  const ko = it(bad);
  await finishDownload(ko, [bad], { ...deps, readableExtensions: () => [] });
  assert.equal(ko.state, 'error');
  assert.match(ko.error, /n'a pas pu être décompressée \(archive abîmée\)/);
  assert.ok(fs.existsSync(bad), 'l’archive reste quand la décompression échoue');
  assert.deepEqual(done, [ok]);
});

test('programmes d’installation : du plus proche de la racine au plus profond', async () => {
  const dir = path.join(freshDir(), 'Logiciel');
  fs.mkdirSync(path.join(dir, 'sous'), { recursive: true });
  for (const f of ['sous/setup-composant.exe', 'setup.exe', 'lisez-moi.txt']) fs.writeFileSync(path.join(dir, f), '');
  assert.deepEqual(await findInstallers([dir], 'win32'), [path.join(dir, 'setup.exe'), path.join(dir, 'sous', 'setup-composant.exe')]);
  assert.deepEqual(await findInstallers([dir], 'linux'), []);
});

test('index de disque : le .cue téléchargé seul fait venir ses pistes .bin, rangées à côté de lui', async () => {
  const romsDir = path.join(freshDir(), 'psx');
  const { downloads, transfer, transfers, finished } = setup({ emulators: [{ id: 'psx', name: 'PlayStation', romsDir, extensions: ['.cue'] }] });
  await downloads.start();
  downloads.addUrl('https://jeux.test/psx/Jeu.cue', { console: 'psx' });
  transfer('https://jeux.test/psx/Jeu.cue').complete('FILE "Jeu-1.bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Jeu-2.bin" BINARY\n  TRACK 02 AUDIO\n');
  await until(() => finished.length === 1);
  const cue = downloads.list().find((d) => d.name === 'Jeu.cue')!;
  assert.equal(cue.companions, 2);
  assert.deepEqual(
    transfers.slice(1).map((t) => [t.url, t.savePath]),
    [
      ['https://jeux.test/psx/Jeu-1.bin', path.join(romsDir, 'Jeu-1.bin')],
      ['https://jeux.test/psx/Jeu-2.bin', path.join(romsDir, 'Jeu-2.bin')],
    ],
  );
  for (const t of transfers.slice(1)) t.complete('piste');
  await until(() => finished.length === 3);
  const bins = downloads.list().filter((d) => d.name.endsWith('.bin'));
  assert.deepEqual(
    bins.map((d) => [d.state, d.group, d.companionsQueued, d.console]),
    [
      ['done', 'Jeu', true, 'psx'],
      ['done', 'Jeu', true, 'psx'],
    ],
  );
  // Les pistes arrivées, rien ne manque plus : pas de nouvelle demande.
  assert.deepEqual(companionsOf(cue), []);
  assert.equal(transfers.length, 3);
  await downloads.stop();
  await downloads.flush();
});

test('index de disque : un fichier cité sur un autre site n’est pas demandé', () => {
  const dir = freshDir();
  const file = path.join(dir, 'Jeu.m3u');
  fs.writeFileSync(file, 'Jeu (Disque 1).cue\nhttps://ailleurs.test/Jeu (Disque 2).cue\n');
  const it = {
    id: 'x',
    kind: 'http',
    createdAt: 1,
    name: 'Jeu.m3u',
    source: 'https://jeux.test/a/Jeu.m3u',
    dir,
    console: 'psx',
    consoleName: '',
    state: 'done',
    received: 0,
    total: 0,
    speed: 0,
    error: '',
    installers: [],
    file,
  } as DownloadRecord;
  const list = companionsOf(it);
  assert.deepEqual(
    list.map((c) => [c.url, c.ctx.saveAs, c.ctx.group, c.ctx.companionsQueued]),
    [['https://jeux.test/a/Jeu%20(Disque%201).cue', path.join(dir, 'Jeu (Disque 1).cue'), 'Jeu', false]],
  );
});

test('cache : télécharge, prévient à la fin, sans post-traitement ni annonce ; visible dans la liste', async () => {
  const cacheDir = path.join(freshDir(), 'cache');
  const { downloads, transfer, finished } = setup({ emulators: [{ id: 'snes', name: 'SNES', romsDir: path.join(cacheDir, 'x'), extensions: [] }] });
  await downloads.start();
  const target = path.join(cacheDir, 'snes', 'Jeu.zip');
  const progress: number[] = [];
  const pending = downloads.fetchToCache('https://roms.test/Jeu.zip', target, { onProgress: (r) => progress.push(r) });
  const t = transfer('https://roms.test/Jeu.zip');
  assert.equal(t.savePath, target);
  const [it] = downloads.list();
  assert.deepEqual([it.state, it.cache, it.console], ['downloading', true, null]);
  t.received = 40;
  t.emit('updated', {}, 'progressing');
  assert.deepEqual(progress, [40]);
  t.complete('rom');
  const r = await pending;
  assert.deepEqual(r, { ok: true, file: target, id: it.id });
  assert.equal(fs.readFileSync(target, 'utf8'), 'rom', 'archive gardée telle quelle');
  assert.deepEqual(finished, [], 'pas d’annonce « téléchargé » pour une copie dans le cache');
  assert.deepEqual([it.state, it.installers], ['done', []]);

  // Déjà dans le cache : rien n'est retéléchargé.
  assert.deepEqual(await downloads.fetchToCache('https://roms.test/Jeu.zip', target), { ok: true, file: target, cached: true });
  assert.equal(downloads.list().length, 1);
  await downloads.stop();
  await downloads.flush();
});

test('cache : annulation et échec préviennent aussi ; adresse invalide refusée', async () => {
  const dir = freshDir();
  const { downloads, transfer } = setup();
  await downloads.start();
  const cancelled = downloads.fetchToCache('https://roms.test/a.bin', path.join(dir, 'a.bin'));
  const id = downloads.list()[0].id;
  await downloads.cancel(id);
  assert.deepEqual(await cancelled, { ok: false, cancelled: true, error: 'Téléchargement annulé.', id });

  const failed = downloads.fetchToCache('https://roms.test/b.bin', path.join(dir, 'b.bin'));
  transfer('https://roms.test/b.bin').emit('done', {}, 'interrupted');
  const r = await failed;
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /interrompu/);

  assert.deepEqual(await downloads.fetchToCache('ftp://roms.test/c.bin', path.join(dir, 'c.bin')), {
    ok: false,
    error: 'Adresse invalide : elle doit commencer par http:// ou https://.',
  });
  await downloads.stop();
  await downloads.flush();
});

test('cache : un téléchargement qui ne démarre pas est abandonné avec une erreur, puis annulé s’il démarre tard', async () => {
  const dir = freshDir();
  const { downloads, requested } = setup({ silent: true });
  await downloads.start();
  const target = path.join(dir, 'lent.bin');
  const r = await downloads.fetchToCache('https://lent.test/lent.bin', target, { startTimeout: 30 });
  assert.deepEqual(requested, ['https://lent.test/lent.bin']);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /n’a pas démarré/);
  // Il démarre finalement : personne n'attend plus le fichier, il est annulé.
  const late = new FakeItem('https://lent.test/lent.bin');
  downloads.handleWebDownload(late);
  await until(() => downloads.list().some((d) => d.state === 'cancelled'));
  assert.equal(downloads.list().length, 1);
  await downloads.stop();
  await downloads.flush();
});

test('cache : deux demandes de la même copie en même temps se raccrochent au même téléchargement', async () => {
  const dir = freshDir();
  const { downloads, transfers } = setup();
  await downloads.start();
  const target = path.join(dir, 'Jeu.sfc');
  const a: number[] = [];
  const b: number[] = [];
  const first = downloads.fetchToCache('https://roms.test/Jeu.sfc', target, { onProgress: (r) => a.push(r) });
  const second = downloads.fetchToCache('https://roms.test/Jeu.sfc', target, { onProgress: (r) => b.push(r) });
  assert.equal(transfers.length, 1, 'un seul téléchargement');
  const t = transfers[0];
  t.received = 10;
  t.emit('updated', {}, 'progressing');
  t.complete('rom');
  const [r1, r2] = await Promise.all([first, second]);
  assert.deepEqual(r1, r2);
  assert.equal(r1.ok, true);
  assert.deepEqual(a, b, 'les deux demandes suivent l’avancement');
  assert.equal(a[0], 10);
  await downloads.stop();
  await downloads.flush();
});

test('deux demandes pour la même adresse vers deux fichiers : chacune garde son contexte', async () => {
  const dir = freshDir();
  const { downloads, transfers } = setup();
  await downloads.start();
  const p1 = downloads.fetchToCache('https://roms.test/x.bin', path.join(dir, 'a', 'x.bin'));
  const p2 = downloads.fetchToCache('https://roms.test/x.bin', path.join(dir, 'b', 'x.bin'));
  assert.deepEqual(
    transfers.map((t) => t.savePath),
    [path.join(dir, 'a', 'x.bin'), path.join(dir, 'b', 'x.bin')],
  );
  for (const t of transfers) t.complete('x');
  assert.deepEqual([(await p1).ok, (await p2).ok], [true, true]);
  await downloads.stop();
  await downloads.flush();
});

test('marque-page : fiche en attente, puis lancée à la demande', async () => {
  const { downloads, transfer } = setup();
  await downloads.start();
  const r = downloads.addPending('https://a.test/Jeu%20d%C3%A9mo.zip');
  assert.equal(r.ok, true);
  const [it] = downloads.list();
  assert.deepEqual([it.kind, it.state, it.name], ['http', 'pending', 'Jeu démo.zip']);
  assert.equal(downloads.addPending('magnet:?xt=urn:btih:abc&dn=Film').ok, true);
  const magnet = downloads.list().find((d) => d.source.startsWith('magnet:'))!;
  assert.deepEqual([magnet.kind, magnet.name, magnet.torrentFile], ['torrent', 'Film', null]);
  await downloads.resume(it.id);
  const t = transfer('https://a.test/Jeu%20d%C3%A9mo.zip');
  assert.ok(t, 'la reprise demande le fichier à la session');
  assert.equal(downloads.list().find((d) => d.id === it.id)!.state, 'downloading');
  await downloads.pause(it.id);
  assert.equal(t.paused, true);
  assert.equal(downloads.list().find((d) => d.id === it.id)!.state, 'paused');
  await downloads.stop();
  await downloads.flush();
});
