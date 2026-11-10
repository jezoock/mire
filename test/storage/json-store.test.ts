// Stockage JSON atomique, dans des dossiers temporaires uniquement.
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonStore, writeFileAtomic, readJsonFile, flushWithin } from '../../src/main/storage/json-store.ts';

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

// Renommage asynchrone retenu jusqu'à `release()` : permet d'observer une écriture en cours.
function holdRenames() {
  const real = fsp.rename;
  let inFlight = 0;
  let maxInFlight = 0;
  const waiting: Array<() => void> = [];
  const spy = mock.method(fsp, 'rename', async (from: string, to: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((resolve) => waiting.push(resolve));
    await real(from, to);
    inFlight--;
  });
  return {
    spy,
    maxInFlight: () => maxInFlight,
    started: async () => {
      while (!waiting.length) await wait(2);
    },
    release: () => waiting.splice(0).forEach((resolve) => resolve()),
  };
}

describe('écritures différées (asynchrones)', () => {
  it('regroupe les écritures rapprochées en une seule, avec la dernière valeur', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 30 });
    const spy = mock.method(fsp, 'rename');
    store.set({ v: 1 });
    store.set({ v: 2 });
    store.get().v = 3;
    store.save();
    assert.equal(fs.existsSync(file), false, 'rien n’est écrit avant le délai');
    await wait(80);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":3}');
  });

  it('ne bloque pas : rien n’est écrit pendant l’appel lui-même', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 1 });
    const sync = mock.method(fs, 'renameSync');
    store.set({ v: 1 });
    await store.flush();
    assert.equal(sync.mock.callCount(), 0, 'aucune écriture synchrone');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  });

  it('deux écritures rapprochées : une seule en cours, puis la dernière valeur sur le disque', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 5 });
    const hold = holdRenames();
    store.set({ v: 1 });
    await hold.started(); // première écriture en cours, bloquée au renommage
    store.set({ v: 2 });
    await wait(30); // le délai de la seconde est écoulé pendant la première
    assert.equal(hold.spy.mock.callCount(), 1, 'la seconde attend la fin de la première');
    hold.release();
    await hold.started();
    hold.release();
    await store.flush();
    assert.equal(hold.maxInFlight(), 1);
    assert.equal(hold.spy.mock.callCount(), 2);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":2}');
  });

  it('pas de réécriture si rien n’a changé pendant l’écriture', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 5 });
    const spy = mock.method(fsp, 'rename');
    store.set({ v: 1 });
    await wait(20);
    await store.flush();
    assert.equal(spy.mock.callCount(), 1);
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
    const spy = mock.method(fsp, 'rename');
    await store.flush();
    assert.equal(spy.mock.callCount(), 0, 'rien en attente : aucune écriture');
    store.set({ v: 1 });
    await store.flush();
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
    await store.flush();
    assert.equal(spy.mock.callCount(), 1);
  });

  it('flush attend l’écriture en cours', async () => {
    const file = fresh();
    const store = createJsonStore(file, { defaults: { v: 0 }, debounceMs: 1 });
    const hold = holdRenames();
    store.set({ v: 1 });
    await hold.started();
    let flushed = false;
    const done = store.flush().then(() => {
      flushed = true;
    });
    await wait(20);
    assert.equal(flushed, false, 'flush ne se résout pas avant la fin de l’écriture');
    hold.release();
    await done;
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  });

  it('une écriture qui échoue va dans le journal (onError) sans bloquer les suivantes', async () => {
    const file = fresh();
    const onError = mock.fn();
    const store = createJsonStore(file, { defaults: {}, debounceMs: 5, onError });
    const real = fsp.rename;
    let calls = 0;
    mock.method(fsp, 'rename', async (from: string, to: string) => {
      if (++calls === 1) throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
      await real(from, to);
    });
    store.set({ v: 1 });
    await wait(30);
    assert.equal(onError.mock.callCount(), 1);
    assert.equal(onError.mock.calls[0].arguments[1], file);
    assert.deepEqual(leftovers(file), [], 'le fichier temporaire est retiré');
    store.set({ v: 2 });
    await store.flush();
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":2}');
  });

  it('renommage refusé un instant (Windows, antivirus) : nouvel essai', async () => {
    const file = fresh();
    const real = fsp.rename;
    let calls = 0;
    mock.method(fsp, 'rename', async (from: string, to: string) => {
      if (++calls === 1) throw Object.assign(new Error('occupé'), { code: 'EPERM' });
      await real(from, to);
    });
    const store = createJsonStore(file, { defaults: {}, debounceMs: 1 });
    store.set({ v: 1 });
    await store.flush();
    assert.equal(calls, 2);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1}');
  });
});

describe('flushWithin (fermeture de l’application)', () => {
  it('se résout dès que toutes les écritures sont faites', async () => {
    const order: string[] = [];
    const ok = await flushWithin(
      [
        async () => {
          await wait(5);
          order.push('a');
        },
        async () => {
          order.push('b');
        },
      ],
      2000,
    );
    assert.equal(ok, true);
    assert.deepEqual(order.sort(), ['a', 'b']);
  });

  it('une écriture en échec n’empêche pas de quitter', async () => {
    assert.equal(await flushWithin([() => Promise.reject(new Error('panne'))], 2000), true);
  });

  it('respecte le délai de 2 s quand une écriture ne finit pas (horloge simulée)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let settled: boolean | null = null;
    const result = flushWithin([() => new Promise<void>(() => {})], 2000).then((ok) => {
      settled = ok;
    });
    await Promise.resolve();
    mock.timers.tick(1999);
    await Promise.resolve();
    assert.equal(settled, null, 'toujours en attente à 1,999 s');
    mock.timers.tick(1);
    await result;
    assert.equal(settled, false);
  });
});
