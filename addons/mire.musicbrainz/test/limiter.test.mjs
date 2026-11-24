// Débit limité (règle de MusicBrainz : une requête par seconde). Horloge simulée : le résultat ne dépend ni de la
// charge de la machine ni de la précision des minuteries (le test du cœur qu'il remplace échouait parfois).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createMetadata from '../src/metadata.mjs';
import { createLimiter, INTERVAL_MS } from '../src/client.mjs';
import { fakeClock, fakeContext, loadRoutes } from './helpers.mjs';

test('requêtes lancées ensemble : espacées de l’intervalle, dans l’ordre', async () => {
  const clock = fakeClock();
  const limit = createLimiter(60, clock);
  const times = [];
  await Promise.all([1, 2, 3].map((n) => limit(async () => times.push([n, clock.now()]))));
  const start = times[0][1];
  assert.deepEqual(
    times.map(([n, x]) => [n, x - start]),
    [
      [1, 0],
      [2, 60],
      [3, 120],
    ],
  );
});

test('requête en échec : les suivantes partent quand même, toujours espacées', async () => {
  const clock = fakeClock();
  const limit = createLimiter(100, clock);
  const failed = limit(async () => {
    throw new Error('panne');
  });
  await assert.rejects(failed, /panne/);
  assert.equal(await limit(async () => clock.now()), clock.now());
  assert.equal(clock.now(), 1_000_100);
});

test('après une pause plus longue que l’intervalle : pas d’attente', async () => {
  const clock = fakeClock();
  const limit = createLimiter(100, clock);
  await limit(async () => {});
  await clock.sleep(500);
  const before = clock.now();
  await limit(async () => {});
  assert.equal(clock.now(), before);
});

test('le plugin espace ses requêtes à MusicBrainz (une par seconde et un peu plus), pas celles des pochettes', async () => {
  const clock = fakeClock();
  const { ctx, calls } = fakeContext({ routes: loadRoutes('musicbrainz') });
  const request = ctx.http.request;
  const times = [];
  ctx.http.request = (url, o) => (url.startsWith('https://musicbrainz.org/') && times.push(clock.now()), request(url, o));
  const provider = createMetadata(ctx, clock);
  await Promise.all([1, 2, 3].map(() => provider.candidates({ query: 'Discovery', artist: 'Daft Punk' })));
  assert.equal(calls.length, 3);
  assert.deepEqual(
    times.map((x) => x - times[0]),
    [0, INTERVAL_MS, 2 * INTERVAL_MS],
  );
});
