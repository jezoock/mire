// Caractérisation (P1-16) : le moteur produit les mêmes fiches, résultats et échecs que l'ancien scraper.
// test/fixtures/scrape/golden.json a été produit par src/main/scraper.js (avant sa suppression) avec le même
// scénario (scenario.ts) et les mêmes réponses enregistrées. Images : nom du fichier → adresse d'origine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScraper } from '../../src/main/scrape/index.ts';
import { fakeFetch, loadRoutes } from './fake-fetch.ts';
import * as s from './scenario.ts';

const golden = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'scrape', 'golden.json'), 'utf8'));

test('mêmes fiches qu’avant : film, épisodes, album, ROM, jeu PC, marque-pages, choix et recherches', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-scrape-carac-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const fetch = fakeFetch(loadRoutes('tmdb', 'musicbrainz', 'libretro', 'steam'));
  const progress: unknown[] = [];
  const sc = createScraper({
    dataDir,
    getConfig: () => s.config as never,
    listRoms: s.listRoms as never,
    onProgress: (p) => progress.push(p),
    fetch,
    musicBrainz: { intervalMs: 0 },
  });

  const run = await sc.run({ videos: s.videos, albums: s.albums });
  const ones = [];
  for (const j of s.ones) ones.push(await sc.one(structuredClone(j) as never).catch((e: Error) => ({ rejected: e.message })));
  const searches = [];
  for (const j of s.searches) searches.push(await sc.candidates(structuredClone(j)).catch((e: Error) => ({ rejected: e.message })));
  await sc.flush();

  const items = Object.fromEntries(
    Object.entries(sc.data()).map(([k, v]) => {
      const { at, ...rest } = v as Record<string, any>;
      assert.equal(typeof at, 'number');
      for (const f of ['image', 'backdrop']) if (rest[f]) rest[f] = path.basename(rest[f]);
      return [k, rest];
    }),
  );
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'scrape', 'db.json'), 'utf8'));
  const imgDir = path.join(dataDir, 'scrape', 'img');
  const images = Object.fromEntries(
    fs
      .readdirSync(imgDir)
      .sort()
      .map((n) => [n, fs.readFileSync(path.join(imgDir, n), 'utf8')]),
  );

  assert.deepEqual(run, golden.run);
  assert.deepEqual(progress.at(-1), golden.progress);
  assert.deepEqual(ones, golden.ones);
  assert.deepEqual(searches, golden.searches);
  assert.deepEqual(items, golden.items);
  assert.deepEqual(Object.keys(db.misses).sort(), golden.misses);
  assert.deepEqual(images, golden.images);
});
