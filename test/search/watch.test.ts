// « Où regarder » (P5-15) : réponse d'un plugin factice lue, vérifiée et rapprochée des sites configurés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebSite } from '@mire/shared';
import { createWatchSearch, readWatch, sourceForProvider, WATCH_LIMITS } from '../../src/main/search/watch.ts';

const site = (id: string, name: string, providers?: string[]): WebSite => ({
  id,
  name,
  url: `https://${id}.example`,
  mode: 'integrated',
  search: '',
  providers,
});

test('sourceForProvider : nom du site ou noms alternatifs, « =nom » exact, accents et casse ignorés', () => {
  const sites = [site('netflix', 'Netflix'), site('canal', 'myCANAL', ['Canal+', '=canal plus series']), site('vide', '', ['  '])];
  assert.equal(sourceForProvider('Netflix basic with Ads', sites)?.id, 'netflix');
  assert.equal(sourceForProvider('Canal+ Séries', sites)?.id, 'canal');
  assert.equal(sourceForProvider('Canal Plus Séries', sites)?.id, 'canal');
  assert.equal(sourceForProvider('Canal Plus Séries Kids', sites), null);
  assert.equal(sourceForProvider('Netflixer', sites), null);
  assert.equal(sourceForProvider('Disney Plus', sites), null);
});

test('réponse d’un plugin : titres vérifiés, services rapprochés des sites (en tête), affiche https seulement', () => {
  const sites = [site('canal', 'myCANAL', ['canal+']), site('disney', 'Disney+', ['=disney plus'])];
  const r = readWatch(
    'mire.tmdb',
    {
      ok: true,
      attribution: ' Catalogue : TMDB. ',
      results: [
        {
          key: 'movie-1',
          title: 'Amélie',
          year: '2001',
          type: 'movie',
          poster: 'https://image.tmdb.org/t/p/w342/amelie.jpg',
          providers: [{ name: 'Netflix' }, { name: 'Canal+' }, { name: 'Netflix' }, { name: 'Disney Plus' }, { nom: 'x' }, 'y'],
        },
        { key: 'tv-2', title: '<b>Le Bureau</b>', type: 'tv', poster: 'javascript:alert(1)', providers: 'aucun' },
        { key: 'sans-titre' },
        'pas un titre',
      ],
    },
    sites,
  );
  assert.deepEqual(r, {
    ok: true,
    plugin: 'mire.tmdb',
    attribution: 'Catalogue : TMDB.',
    results: [
      {
        key: 'movie-1',
        title: 'Amélie',
        year: '2001',
        type: 'movie',
        poster: 'https://image.tmdb.org/t/p/w342/amelie.jpg',
        providers: [
          { name: 'Canal+', webId: 'canal' },
          { name: 'Disney Plus', webId: 'disney' },
          { name: 'Netflix', webId: null },
        ],
      },
      // Le titre est du texte : l'interface ne l'interprète jamais comme du HTML.
      { key: 'tv-2', title: '<b>Le Bureau</b>', year: '', type: 'tv', poster: null, providers: [] },
    ],
  });
});

test('réponse d’un plugin : réglage à remplir, échec, forme inconnue, bornes', () => {
  assert.deepEqual(readWatch('p', { ok: false, message: 'Ajoutez une clé.', setup: 'token' }, []), {
    ok: false,
    plugin: 'p',
    error: 'Ajoutez une clé.',
    setup: 'token',
  });
  assert.deepEqual(readWatch('p', { ok: false, message: 'Panne.', setup: '../x' }, []), { ok: false, plugin: 'p', error: 'Panne.' });
  assert.equal(readWatch('p', { results: [] }, []), null);
  assert.equal(readWatch('p', null, []), null);
  const many = Array.from({ length: WATCH_LIMITS.results + 10 }, (_, i) => ({ key: `k${i}`, title: 'x'.repeat(1000) }));
  const r = readWatch('p', { ok: true, results: many }, []);
  assert.ok(r?.ok);
  assert.equal(r.results.length, WATCH_LIMITS.results);
  assert.equal(r.results[0].title.length, WATCH_LIMITS.text);
});

test('recherche : la première réponse qui a la forme attendue ; aucun plugin : « noprovider » ; vide : sans appel', async () => {
  const asked: string[] = [];
  const watch = createWatchSearch({
    search: async (q) => {
      asked.push(q);
      return [
        { pluginId: 'org.autre', id: 'radios', result: [{ station: 'x' }] },
        { pluginId: 'mire.tmdb', id: 'ouregarder', result: { ok: true, results: [{ key: 'movie-3', title: 'Dune', providers: [{ name: 'Netflix' }] }] } },
      ];
    },
    sites: () => [site('netflix', 'Netflix')],
  });
  const r = await watch('  dune ');
  assert.deepEqual(asked, ['dune']);
  assert.ok(r.ok);
  assert.deepEqual(r.results[0].providers, [{ name: 'Netflix', webId: 'netflix' }]);
  assert.deepEqual(await watch('   '), { ok: true, plugin: '', results: [], attribution: '' });
  assert.deepEqual(await watch(42), { ok: true, plugin: '', results: [], attribution: '' });
  assert.equal(asked.length, 1);
  const none = createWatchSearch({ search: async () => [], sites: () => [] });
  assert.deepEqual(await none('dune'), { ok: false, reason: 'noprovider' });
});
