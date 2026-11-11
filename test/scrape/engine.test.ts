// Moteur de récupération d'infos (P1-16) : base db.json, révision, nouvel essai après 14 jours, concurrence par
// fournisseur, annulation, progression, API utilisée par les autres modules (one avec clé, copy, forget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScrapeEngine, MISS_RETRY_MS, REV } from '../../src/main/scrape/engine.ts';
import { ScrapeRefusal } from '../../src/main/scrape/refusal.ts';
import type { MetadataProvider, ScrapeOutcome, ScrapeProgress, ScrapeItem } from '../../src/main/scrape/types.ts';

const DAY = 24 * 3600 * 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-scrape-moteur-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface FakeOptions {
  id?: string;
  kind?: string;
  group?: 'videos' | 'music' | 'games';
  concurrency?: number;
  delay?: number;
  /** Résultat selon le nom de l'élément ; par défaut une fiche à son nom. */
  result?: (item: ScrapeItem) => ScrapeOutcome | Error;
  requires?: MetadataProvider['requires'];
}

// Fournisseur factice : note les éléments traités et le nombre maximal de récupérations simultanées.
function fakeProvider(o: FakeOptions = {}) {
  const log = { scraped: [] as string[], max: 0, active: 0 };
  const provider: MetadataProvider = {
    id: o.id || 'faux',
    kinds: [(o.kind || 'video') as never],
    group: o.group || 'videos',
    concurrency: o.concurrency ?? 2,
    requires: o.requires,
    key: (item) => `v:${item.path}`,
    collect: (opts) => opts.videos || [],
    async scrape(item) {
      log.active += 1;
      log.max = Math.max(log.max, log.active);
      await wait(o.delay ?? 5);
      log.active -= 1;
      log.scraped.push(item.path);
      const r = o.result ? o.result(item) : { title: `Titre ${item.path}`, image: null, source: 'Faux' };
      if (r instanceof Error) throw r;
      return r;
    },
    async byId(pick) {
      return { title: `Choix ${pick.id}`, image: null, source: 'Faux', picked: true };
    },
    async candidates({ query }) {
      return [{ id: '1', title: query, year: '', sub: '', image: null }];
    },
  };
  return { provider, log };
}

function engine(dataDir: string, providers: MetadataProvider[], extra: { now?: () => number; progress?: ScrapeProgress[] } = {}) {
  return createScrapeEngine({
    dataDir,
    getConfig: () => ({ search: { tmdbToken: '', language: 'fr-FR', region: 'FR' }, games: [], emulators: [] }),
    listRoms: async () => ({ ok: true, roms: [] }),
    onProgress: (p) => extra.progress?.push(p),
    providers,
    now: extra.now,
  });
}

const videos = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `/v/${i}` }));

test('concurrence : jamais plus de récupérations simultanées que le fournisseur n’en accepte', async (t) => {
  const a = fakeProvider({ id: 'a', concurrency: 3 });
  const b = fakeProvider({ id: 'b', kind: 'album', group: 'music', concurrency: 1 });
  b.provider.collect = (opts) => opts.albums || [];
  const progress: ScrapeProgress[] = [];
  const sc = engine(tempDir(t), [a.provider, b.provider], { progress });
  const r = await sc.run({ videos: videos(10), albums: videos(4).map((v) => ({ path: `/a${v.path}` })) });
  assert.deepEqual(r, { ok: true, total: 14, found: 14, missing: 0, skipped: [], cancelled: false });
  assert.equal(a.log.max, 3);
  assert.equal(b.log.max, 1);
  // Les fournisseurs passent l'un après l'autre.
  assert.equal(a.log.scraped.length, 10);
  assert.deepEqual(progress[0], { running: true, done: 0, total: 14 });
  assert.deepEqual(
    progress.slice(1, -1).map((p) => p.done),
    Array.from({ length: 14 }, (_, i) => i + 1),
  );
  assert.deepEqual(progress.at(-1), { running: false, done: 14, total: 14, found: 14, missing: 0, skipped: [], cancelled: false });
});

test('une seule récupération groupée à la fois', async (t) => {
  const { provider } = fakeProvider({ delay: 20 });
  const sc = engine(tempDir(t), [provider]);
  const first = sc.run({ videos: videos(2) });
  assert.equal(sc.running(), true);
  assert.deepEqual(await sc.run({ videos: videos(2) }), { ok: false, error: 'Une récupération est déjà en cours.' });
  await first;
  assert.equal(sc.running(), false);
});

test('annulation : les récupérations en attente ne sont pas lancées, ni les fournisseurs suivants', async (t) => {
  const a = fakeProvider({ id: 'a', concurrency: 2, delay: 20 });
  const b = fakeProvider({ id: 'b', kind: 'album', group: 'music' });
  b.provider.collect = () => [{ path: '/a/1' }];
  const progress: ScrapeProgress[] = [];
  const sc = engine(tempDir(t), [a.provider, b.provider], { progress });
  const running = sc.run({ videos: videos(10) });
  await wait(5);
  assert.equal(sc.cancel(), true);
  const r = await running;
  assert.equal(r.cancelled, true);
  assert.equal(r.total, 11);
  assert.equal(a.log.scraped.length, 2); // les deux en cours se terminent
  assert.equal(b.log.scraped.length, 0);
  assert.equal(progress.at(-1)?.cancelled, true);
  assert.equal(progress.at(-1)?.done, 2);
});

test('échec : noté, pas réessayé avant 14 jours, réessayé après ; force réessaie tout de suite', async (t) => {
  let clock = 1_000_000;
  const { provider, log } = fakeProvider({ result: () => null });
  const dir = tempDir(t);
  const sc = engine(dir, [provider], { now: () => clock });
  assert.deepEqual(await sc.run({ videos: videos(1) }), { ok: true, total: 1, found: 0, missing: 1, skipped: [], cancelled: false });
  await sc.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scrape', 'db.json'), 'utf8')), { items: {}, misses: { 'v:/v/0': 1_000_000 } });

  clock += 13 * DAY;
  assert.equal((await sc.run({ videos: videos(1) })).total, 0);
  assert.equal((await sc.run({ videos: videos(1), force: true })).total, 1);
  clock += MISS_RETRY_MS + 1;
  assert.equal((await sc.run({ videos: videos(1) })).total, 1);
  assert.equal(log.scraped.length, 3);
});

test('erreur d’un fournisseur : comptée comme manquante, sans échec noté', async (t) => {
  const { provider } = fakeProvider({ result: () => new Error('hors ligne') });
  const sc = engine(tempDir(t), [provider]);
  assert.equal((await sc.run({ videos: videos(2) })).missing, 2);
  assert.equal((await sc.run({ videos: videos(2) })).total, 2);
});

test('rien d’enregistré (undefined) : ni fiche ni échec', async (t) => {
  const { provider } = fakeProvider({ result: () => undefined });
  const sc = engine(tempDir(t), [provider]);
  assert.deepEqual(await sc.one({ kind: 'video', item: { path: '/v/0' } }), { ok: false });
  assert.deepEqual(sc.data(), {});
  assert.equal((await sc.run({ videos: videos(1) })).total, 1);
});

test('révision : une fiche d’une révision plus ancienne est récupérée de nouveau, pas celle de la révision courante', async (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'scrape'), { recursive: true });
  const old = { title: 'Ancienne', image: null, source: 'TMDB', rev: REV - 1, at: 1 };
  const current = { title: 'Actuelle', image: '/img/x.jpg', source: 'TMDB', rev: REV, at: 2 };
  fs.writeFileSync(path.join(dir, 'scrape', 'db.json'), JSON.stringify({ items: { 'v:/v/0': old, 'v:/v/1': current }, misses: {} }));
  const { provider, log } = fakeProvider();
  const sc = engine(dir, [provider], { now: () => 5 });
  // Les fiches existantes sont relues telles quelles.
  assert.deepEqual(sc.data()['v:/v/1'], current);
  await sc.run({ videos: videos(2) });
  assert.deepEqual(log.scraped, ['/v/0']);
  assert.deepEqual(sc.data()['v:/v/0'], { title: 'Titre /v/0', image: null, source: 'Faux', rev: REV, at: 5 });
});

test('fournisseur sans sa clé : famille sautée par run, recherche refusée', async (t) => {
  const requires = () => ({ skipped: 'vidéos (clé absente)', error: 'Ajoutez une clé.' });
  const { provider, log } = fakeProvider({ requires });
  const sc = engine(tempDir(t), [provider]);
  assert.deepEqual(await sc.run({ videos: videos(2) }), { ok: true, total: 0, found: 0, missing: 0, skipped: ['vidéos (clé absente)'], cancelled: false });
  assert.deepEqual(await sc.candidates({ kind: 'video', query: 'x' }), { ok: false, error: 'Ajoutez une clé.' });
  assert.equal(log.scraped.length, 0);
});

test('familles demandées seulement', async (t) => {
  const { provider } = fakeProvider();
  const sc = engine(tempDir(t), [provider]);
  assert.equal((await sc.run({ kinds: ['music'], videos: videos(2) })).total, 0);
});

test('one : clé imposée (marque-page b:<id>), choix de l’utilisateur, type inconnu, refus', async (t) => {
  const { provider } = fakeProvider();
  const sc = engine(tempDir(t), [provider]);
  assert.deepEqual(await sc.one({ kind: 'video', item: { path: '/v/0' }, key: 'b:42' }), { ok: true });
  assert.equal(sc.data()['b:42'].title, 'Titre /v/0');
  assert.equal(sc.data()['v:/v/0'], undefined);
  assert.deepEqual(await sc.one({ kind: 'video', item: { path: '/v/1' }, override: { pick: { id: '7' } } }), { ok: true });
  assert.equal(sc.data()['v:/v/1'].picked, true);
  assert.deepEqual(await sc.one({ kind: 'livre', item: {} }), { ok: false });

  provider.scrape = async () => {
    throw new ScrapeRefusal('Système inconnu.');
  };
  assert.deepEqual(await sc.one({ kind: 'video', item: { path: '/v/2' } }), { ok: false, error: 'Système inconnu.' });
  provider.scrape = async () => {
    throw new Error('hors ligne');
  };
  await assert.rejects(sc.one({ kind: 'video', item: { path: '/v/2' } }), /hors ligne/);
});

test('candidates : titre vide, type inconnu, refus, liste', async (t) => {
  const { provider } = fakeProvider();
  const sc = engine(tempDir(t), [provider]);
  assert.deepEqual(await sc.candidates({ kind: 'video', query: '  ' }), { ok: false, error: 'Indiquez un titre à chercher.' });
  assert.deepEqual(await sc.candidates({ kind: 'livre', query: 'x' }), { ok: false, error: 'Type inconnu.' });
  assert.deepEqual(await sc.candidates({ kind: 'video', query: ' Dune ' }), { ok: true, items: [{ id: '1', title: 'Dune', year: '', sub: '', image: null }] });
  provider.candidates = async () => {
    throw new ScrapeRefusal('Liste indisponible.');
  };
  assert.deepEqual(await sc.candidates({ kind: 'video', query: 'x' }), { ok: false, error: 'Liste indisponible.' });
});

test('copy, forget, clear', async (t) => {
  const dir = tempDir(t);
  const { provider } = fakeProvider();
  const sc = engine(dir, [provider]);
  await sc.one({ kind: 'video', item: { path: '/v/0' }, key: 'b:1' });
  assert.equal(sc.copy('b:1', 'r:/jeu.sfc'), true);
  assert.deepEqual(sc.data()['r:/jeu.sfc'], sc.data()['b:1']);
  // Ni fiche absente, ni écrasement d'une fiche existante.
  assert.equal(sc.copy('b:absent', 'r:/autre'), false);
  assert.equal(sc.copy('b:1', 'r:/jeu.sfc'), false);
  assert.equal(sc.forget('b:1'), true);
  assert.equal(sc.data()['b:1'], undefined);

  fs.writeFileSync(path.join(sc.imgDir, 'x.jpg'), 'x');
  assert.equal(await sc.clear(), true);
  assert.deepEqual(sc.data(), {});
  assert.deepEqual(fs.readdirSync(sc.imgDir), []);
  await sc.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scrape', 'db.json'), 'utf8')), { items: {}, misses: {} });
});
