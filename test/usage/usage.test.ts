// Données d'usage (P1-09) : règles reprises de l'ancien renderer (« Reprendre », reprise, volume, recherches),
// service et fichier usage.json, fusion de l'import « compléter », reprise du localStorage.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsageService, mergeLegacy, mergeUsage, normalizeUsage, resumeAfter } from '../../src/main/usage/index.ts';
import { addQuery, addRecent, emptyUsage } from '../../src/main/usage/rules.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-usage-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const item = (p: string, extra: Record<string, unknown> = {}) => ({ path: p, name: path.basename(p), kind: 'video', ...extra });
const entry = (p: string) => ({
  path: p,
  name: path.basename(p),
  kind: 'video',
  ext: null,
  cover: null,
  fanart: null,
  native: null,
  folder: null,
  dir: null,
  remote: null,
});

describe('usage : « Reprendre »', () => {
  it('ajoute en tête, sans doublon, en ne gardant que les champs utiles', () => {
    let list = addRecent([], item('/v/a.mkv', { ext: 'mkv', native: true, secret: 'x' }));
    list = addRecent(list, item('/v/b.mkv'));
    list = addRecent(list, item('/v/a.mkv'));
    assert.deepEqual(
      list.map((x) => x.path),
      ['/v/a.mkv', '/v/b.mkv'],
    );
    assert.deepEqual(list[1], entry('/v/b.mkv'));
    assert.equal('secret' in list[0], false);
  });

  it('en garde 18 au plus, les plus récents', () => {
    let list: ReturnType<typeof addRecent> = [];
    for (let i = 0; i < 25; i++) list = addRecent(list, item(`/v/${i}.mkv`));
    assert.equal(list.length, 18);
    assert.equal(list[0].path, '/v/24.mkv');
    assert.equal(list[17].path, '/v/7.mkv');
  });

  it('ignore une entrée sans chemin', () => {
    assert.deepEqual(addRecent([], { name: 'x' }), []);
    assert.deepEqual(addRecent([], null), []);
  });
});

describe('usage : positions de reprise', () => {
  it('gardée entre 30 s et la fin moins 90 s (en secondes entières), effacée sinon', () => {
    let r = resumeAfter({}, '/v/a.mkv', 125.7, 1000);
    assert.deepEqual(r, { '/v/a.mkv': 125 });
    assert.deepEqual(resumeAfter(r, '/v/a.mkv', 30, 1000), {});
    assert.deepEqual(resumeAfter(r, '/v/a.mkv', 910, 1000), {});
    assert.deepEqual(resumeAfter(r, '/v/a.mkv', 909, 1000), { '/v/a.mkv': 909 });
    r = resumeAfter(r, '/v/b.mkv', 31, 1000);
    assert.deepEqual(r, { '/v/a.mkv': 125, '/v/b.mkv': 31 });
  });

  it('ne change rien pour une vidéo de moins de 5 min ou de durée inconnue', () => {
    const r = { '/v/a.mkv': 100 };
    assert.equal(resumeAfter(r, '/v/a.mkv', 10, 299), r);
    assert.equal(resumeAfter(r, '/v/a.mkv', 10, NaN), r);
    assert.equal(resumeAfter(r, '/v/a.mkv', 10, Infinity), r);
  });
});

describe('usage : recherches récentes', () => {
  it('en tête, sans doublon (accents et casse ignorés), 10 au plus', () => {
    let list = addQuery([], 'Été');
    list = addQuery(list, 'matrix');
    list = addQuery(list, 'ete');
    assert.deepEqual(list, ['ete', 'matrix']);
    for (let i = 0; i < 12; i++) list = addQuery(list, `q${i}`);
    assert.equal(list.length, 10);
    assert.equal(list[0], 'q11');
    assert.deepEqual(addQuery(['a'], ''), ['a']);
  });
});

describe('usage : lecture tolérante', () => {
  it('complète et assainit un contenu quelconque', () => {
    assert.deepEqual(normalizeUsage(null), emptyUsage());
    assert.deepEqual(normalizeUsage({ volume: 'x', recent: 'x', queries: [1, 'a', 'A'], resume: { '/a': '12', '/b': 'x', '/c': -1 } }), {
      recent: [],
      resume: { '/a': 12 },
      volume: 0.9,
      queries: ['a'],
    });
    assert.equal(normalizeUsage({ volume: 3 }).volume, 1);
    assert.equal(normalizeUsage({ volume: 0 }).volume, 0);
  });

  it('garde l’ordre et les 18 premiers de « Reprendre »', () => {
    const recent = Array.from({ length: 20 }, (_, i) => item(`/v/${i}.mkv`));
    recent.push(item('/v/0.mkv'));
    const out = normalizeUsage({ recent }).recent.map((x) => x.path);
    assert.equal(out.length, 18);
    assert.equal(out[0], '/v/0.mkv');
    assert.equal(out[17], '/v/17.mkv');
  });
});

describe('usage : fusion de l’import « compléter »', () => {
  it('ajoute ce qui manque sans doublon et garde l’existant', () => {
    const base = normalizeUsage({ recent: [item('/a'), item('/b')], resume: { '/a': 100 }, volume: 0.4, queries: ['Été'] });
    const extra = normalizeUsage({ recent: [item('/c'), item('/a')], resume: { '/a': 500, '/c': 200 }, volume: 1, queries: ['ete', 'dune'] });
    assert.deepEqual(mergeUsage(base, extra), {
      recent: [entry('/a'), entry('/b'), entry('/c')],
      resume: { '/a': 100, '/c': 200 },
      volume: 0.4,
      queries: ['Été', 'dune'],
    });
  });

  it('respecte les bornes', () => {
    const many = (prefix: string) => Array.from({ length: 15 }, (_, i) => item(`/${prefix}${i}`));
    const merged = mergeUsage(normalizeUsage({ recent: many('a') }), normalizeUsage({ recent: many('b') }));
    assert.equal(merged.recent.length, 18);
    assert.equal(merged.recent[15].path, '/b0');
  });

  it('reprise du localStorage : comme « compléter », mais avec le volume réglé alors', () => {
    const legacy = { recent: [item('/a')], resume: { '/a': '321' }, volume: '0.35', queries: ['dune'] };
    assert.deepEqual(mergeLegacy(emptyUsage(), legacy), { recent: [entry('/a')], resume: { '/a': 321 }, volume: 0.35, queries: ['dune'] });
    assert.equal(mergeLegacy({ ...emptyUsage(), volume: 0.5 }, { volume: null }).volume, 0.5);
  });
});

describe('usage : service et fichier usage.json', () => {
  const file = () => path.join(tmp, 'usage.json');
  const read = () => JSON.parse(fs.readFileSync(file(), 'utf8'));

  it('fichier absent : valeurs par défaut, sans rien écrire', () => {
    const usage = createUsageService({ file: file() });
    assert.deepEqual(usage.load(), emptyUsage());
    assert.deepEqual(usage.snapshot(), { recent: [], volume: 0.9, queries: [] });
    assert.equal(fs.existsSync(file()), false);
  });

  it('enregistre chaque donnée, puis la relit', async () => {
    const usage = createUsageService({ file: file(), debounceMs: 5 });
    usage.load();
    usage.addRecent(item('/v/a.mkv'));
    usage.addRecent(item('/v/b.mkv'));
    usage.removeRecent('/v/b.mkv');
    assert.equal(usage.saveResume('/v/a.mkv', 400, 3600), true);
    usage.saveResume('/v/b.mkv', 400, 3600);
    usage.clearResume('/v/b.mkv');
    assert.equal(usage.setVolume(0.42), 0.42);
    usage.addQuery('dune');
    usage.addQuery('matrix');
    usage.clearQueries();
    usage.addQuery('alien');
    await usage.flush();
    assert.deepEqual(read(), { recent: [entry('/v/a.mkv')], resume: { '/v/a.mkv': 400 }, volume: 0.42, queries: ['alien'] });
    const again = createUsageService({ file: file() });
    again.load();
    assert.equal(again.resume('/v/a.mkv'), 400);
    assert.equal(again.resume('/v/inconnue.mkv'), 0);
    assert.deepEqual(again.snapshot(), { recent: [entry('/v/a.mkv')], volume: 0.42, queries: ['alien'] });
  });

  it('groupe les écritures : une position envoyée souvent ne donne qu’une écriture', async () => {
    const usage = createUsageService({ file: file(), debounceMs: 30 });
    usage.load();
    const writes: string[] = [];
    const original = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
      writes.push(String(to));
      return original(from, to);
    };
    try {
      for (let t = 40; t < 100; t += 5) usage.saveResume('/v/a.mkv', t, 3600);
      for (let v = 0; v <= 10; v++) usage.setVolume(v / 10);
      assert.equal(fs.existsSync(file()), false);
      await usage.flush();
    } finally {
      fs.promises.rename = original;
    }
    assert.equal(writes.length, 1);
    assert.deepEqual(read().resume, { '/v/a.mkv': 95 });
    assert.equal(read().volume, 1);
  });

  it('fichier illisible : signalé, puis valeurs par défaut', () => {
    fs.writeFileSync(file(), '{');
    const messages: string[] = [];
    const usage = createUsageService({ file: file(), log: (m) => messages.push(m) });
    assert.deepEqual(usage.load(), emptyUsage());
    assert.match(messages[0], /illisibles/);
  });

  it('remplace, complète, reprend le localStorage', () => {
    const usage = createUsageService({ file: file(), debounceMs: 5 });
    usage.load();
    usage.addRecent(item('/a'));
    usage.merge({ recent: [item('/b'), item('/a')], resume: { '/b': 99 } });
    assert.deepEqual(
      usage.get().recent.map((x) => x.path),
      ['/a', '/b'],
    );
    usage.replace({ recent: [item('/c')] });
    assert.deepEqual(usage.get(), { ...emptyUsage(), recent: [entry('/c')] });
    usage.migrate({ volume: '0.3', resume: { '/c': '120' } });
    assert.deepEqual(usage.get(), { recent: [entry('/c')], resume: { '/c': 120 }, volume: 0.3, queries: [] });
    usage.migrate('n’importe quoi');
    assert.equal(usage.get().volume, 0.3);
    return usage.flush();
  });
});
