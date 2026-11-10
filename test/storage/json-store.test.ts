// Stockage JSON atomique, dans des dossiers temporaires uniquement.
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJsonStore, writeFileAtomic, readJsonFile } from '../../src/main/storage/json-store.ts';

let root = '';
let n = 0;
const fresh = () => path.join(root, `essai-${++n}`, 'donnees.json');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const leftovers = (file: string) => fs.readdirSync(path.dirname(file)).filter((f) => f !== path.basename(file));

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-stockage-'));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => mock.restoreAll());

describe('lecture tolérante', () => {
  it('fichier absent : valeurs par défaut, sans onCorrupt', () => {
    const onCorrupt = mock.fn();
    const store = createJsonStore(fresh(), { defaults: { items: {}, misses: {} }, onCorrupt });
    assert.deepEqual(store.load(), { items: {}, misses: {} });
    assert.equal(onCorrupt.mock.callCount(), 0);
  });

  it('fichier corrompu : onCorrupt appelé avec l’erreur et le fichier, puis valeurs par défaut', () => {
    const file = fresh();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"items": {"a": 1');
    const onCorrupt = mock.fn();
    const store = createJsonStore(file, { defaults: { items: {} }, onCorrupt });
    assert.deepEqual(store.load(), { items: {} });
    assert.equal(onCorrupt.mock.callCount(), 1);
    const [err, where] = onCorrupt.mock.calls[0].arguments;
    assert.ok(err instanceof Error);
    assert.equal(where, file);
    // Le fichier abîmé n'est pas touché par la lecture.
    assert.equal(fs.readFileSync(file, 'utf8'), '{"items": {"a": 1');
  });

  it('contenu qui n’est pas un objet (tableau, nombre) : traité comme corrompu', () => {
    for (const text of ['[1, 2]', '42', '"texte"']) {
      const file = fresh();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const onCorrupt = mock.fn();
      assert.deepEqual(createJsonStore(file, { defaults: { a: 1 }, onCorrupt }).load(), { a: 1 });
      assert.equal(onCorrupt.mock.callCount(), 1, text);
    }
  });

  it('`null` : valeurs par défaut, sans onCorrupt', () => {
    const file = fresh();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'null');
    const onCorrupt = mock.fn();
    assert.deepEqual(createJsonStore(file, { defaults: {}, onCorrupt }).load(), {});
    assert.equal(onCorrupt.mock.callCount(), 0);
  });

  it('les clés lues complètent les valeurs par défaut', () => {
    const file = fresh();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ items: { a: { title: 'A' } } }));
    assert.deepEqual(createJsonStore(file, { defaults: { items: {}, misses: {} } }).load(), { items: { a: { title: 'A' } }, misses: {} });
  });

  it('les valeurs par défaut ne sont jamais partagées entre deux lectures', () => {
    const store = createJsonStore(fresh(), { defaults: { items: {} as Record<string, number> } });
    store.load().items.x = 1;
    assert.deepEqual(store.load(), { items: {} });
  });
});

describe('écriture atomique', () => {
  it('écrit le JSON sans saut de ligne final et crée le dossier', () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: {}, space: 2 });
    store.set({ titre: 'Amélie', émoji: '🎬' });
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ titre: 'Amélie', émoji: '🎬' }, null, 2));
    assert.deepEqual(leftovers(file), []);
  });

  it('écriture interrompue en plein milieu : le fichier précédent reste lisible et entier', () => {
    const file = fresh();
    const store = createJsonStore<{ v: number; long?: string }>(file, { defaults: { v: 0 } });
    store.set({ v: 1 });
    // Coupure simulée : seule une partie du nouveau contenu arrive sur le disque.
    mock.method(fs, 'writeFileSync', (fd: number, text: string) => {
      fs.writeSync(fd, text.slice(0, 3));
      throw Object.assign(new Error('coupure'), { code: 'EIO' });
    });
    assert.throws(() => store.set({ v: 2, long: 'x'.repeat(1000) }), /coupure/);
    mock.restoreAll();
    assert.deepEqual(readJsonFile(file), { v: 1 });
    assert.deepEqual(createJsonStore(file, { defaults: {} }).load(), { v: 1 });
    assert.deepEqual(leftovers(file), [], 'le fichier temporaire est retiré');
  });

  it('arrêt brutal avant le renommage : le fichier précédent reste lisible, le temporaire est ignoré', () => {
    const file = fresh();
    writeFileAtomic(file, JSON.stringify({ v: 1 }));
    // Reste d'une écriture tuée avant le renommage.
    fs.writeFileSync(`${file}.1234.tmp`, '{"v": 2, "tronq');
    mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('arrêt'), { code: 'EIO' });
    });
    assert.throws(() => writeFileAtomic(file, JSON.stringify({ v: 3 })), /arrêt/);
    mock.restoreAll();
    assert.deepEqual(readJsonFile(file), { v: 1 });
  });

  it('renommage refusé un instant (Windows, antivirus) : nouvel essai', () => {
    const file = fresh();
    const real = fs.renameSync;
    let calls = 0;
    mock.method(fs, 'renameSync', (from: string, to: string) => {
      if (++calls === 1) throw Object.assign(new Error('occupé'), { code: 'EBUSY' });
      real(from, to);
    });
    writeFileAtomic(file, '{"v":1}');
    assert.equal(calls, 2);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  });
});

describe('écritures différées', () => {
  it('regroupe les écritures rapprochées en une seule, avec la dernière valeur', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 30 });
    const spy = mock.method(fs, 'renameSync');
    store.set({ v: 1 });
    store.set({ v: 2 });
    store.get().v = 3;
    store.save();
    assert.equal(fs.existsSync(file), false, 'rien n’est écrit avant le délai');
    await wait(80);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":3}');
  });

  it('la valeur est relevée au moment de l’écriture (toJSON)', async () => {
    const file = fresh();
    const list: number[] = [];
    const store = createJsonStore<object>(file, { defaults: {}, debounceMs: 20, space: 1 });
    store.set({ toJSON: () => ({ items: list }) });
    list.push(1, 2);
    await wait(60);
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ items: [1, 2] }, null, 1));
  });

  it('flush écrit tout de suite ce qui attend, une seule fois', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 1000 });
    const spy = mock.method(fs, 'renameSync');
    store.flush();
    assert.equal(spy.mock.callCount(), 0, 'rien en attente : aucune écriture');
    store.set({ v: 1 });
    store.flush();
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
    store.flush();
    await wait(20);
    assert.equal(spy.mock.callCount(), 1);
  });

  it('écriture différée en échec : onError, sans exception', async () => {
    const file = fresh();
    const onError = mock.fn();
    const store = createJsonStore(file, { defaults: {}, debounceMs: 10, onError });
    mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
    });
    store.set({ v: 1 });
    await wait(40);
    assert.equal(onError.mock.callCount(), 1);
    assert.equal(onError.mock.calls[0].arguments[1], file);
  });
});
