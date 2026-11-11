// Recherche « où regarder » (P1-17), avec un client TMDB simulé : aucun accès réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config, WebSite } from '@mire/shared';
import { HttpError } from '../../src/main/net/http.ts';
import { createTmdbClient, type TmdbClient, type TmdbParams } from '../../src/main/net/tmdb.ts';
import { sourceForProvider, streamingSearchProvider, type SearchContext } from '../../src/main/search/streaming.ts';
import { fakeFetch } from '../scrape/fake-fetch.ts';

type Reply = unknown | HttpError | ((params: TmdbParams) => unknown);

/** Client TMDB simulé : réponses par route ; une route absente répond 404. Note chaque appel. */
function fakeTmdb(routes: Record<string, Reply>, key = 'cle') {
  const calls: { pathname: string; params: TmdbParams; timeout?: number }[] = [];
  const client: TmdbClient = {
    hasKey: () => !!key.trim(),
    async get(pathname, params = {}, opts = {}) {
      calls.push({ pathname, params, timeout: opts.timeout });
      const reply = routes[pathname];
      if (reply === undefined) throw new HttpError('status', `https://api.themoviedb.org/3${pathname}`, 'code 404', { status: 404 });
      if (reply instanceof HttpError) throw reply;
      return typeof reply === 'function' ? reply(params) : reply;
    },
  };
  return { client, calls };
}

const site = (id: string, name: string, providers?: string[]): WebSite => ({
  id,
  name,
  url: `https://${id}.example`,
  mode: 'integrated',
  search: '',
  providers,
});

function context(web: WebSite[] = [], search: Partial<Config['search']> = {}): SearchContext {
  return { getConfig: () => ({ search: { tmdbToken: 'cle', region: 'FR', language: 'fr-FR', ...search }, web }) };
}

const offer = (id: number, name: string) => ({ provider_id: id, provider_name: name });

test('sourceForProvider : nom du site ou noms alternatifs, « =nom » exact, accents et casse ignorés', () => {
  const sites = [site('netflix', 'Netflix'), site('canal', 'myCANAL', ['Canal+', '=canal plus series']), site('vide', '', ['  '])];
  assert.equal(sourceForProvider('Netflix basic with Ads', sites)?.id, 'netflix');
  assert.equal(sourceForProvider('Canal+ Séries', sites)?.id, 'canal');
  assert.equal(sourceForProvider('Canal Plus Séries', sites)?.id, 'canal');
  assert.equal(sourceForProvider('Canal Plus Séries Kids', sites), null);
  assert.equal(sourceForProvider('Netflixer', sites), null);
  assert.equal(sourceForProvider('Disney Plus', sites), null);
});

test('recherche : films et séries (12 au plus), offres de la région, sites configurés en tête, doublons ignorés', async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, media_type: 'movie', title: `Film ${i}` }));
  const { client, calls } = fakeTmdb({
    '/search/multi': {
      results: [
        { id: 1, media_type: 'movie', title: 'Amélie', release_date: '2001-04-25', poster_path: '/amelie.jpg' },
        { id: 7, media_type: 'person', name: 'Audrey Tautou' },
        { id: 2, media_type: 'tv', name: 'Le Bureau', first_air_date: '2015-04-27' },
        ...many,
      ],
    },
    '/movie/1/watch/providers': {
      results: {
        FR: {
          flatrate: [offer(8, 'Netflix'), offer(381, 'Canal+')],
          free: [offer(8, 'Netflix'), offer(35, 'Rakuten TV')],
          ads: [offer(381, 'Canal+'), offer(300, 'Pluto TV'), offer(337, 'Disney Plus')],
          buy: [offer(2, 'Apple TV')],
        },
        BE: { flatrate: [offer(9, 'Prime Video')] },
      },
    },
    '/tv/2/watch/providers': { results: { BE: { flatrate: [offer(381, 'Canal+')] } } },
  });
  const r = await streamingSearchProvider(client).search(
    '  amélie ',
    context([site('canal', 'myCANAL', ['canal+']), site('disney', 'Disney+', ['=disney plus'])]),
  );
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.equal(r.results.length, 12);
  assert.deepEqual(r.results[0], {
    key: 'movie-1',
    title: 'Amélie',
    year: '2001',
    type: 'movie',
    poster: 'https://image.tmdb.org/t/p/w342/amelie.jpg',
    providers: [
      { name: 'Canal+', webId: 'canal' },
      { name: 'Disney Plus', webId: 'disney' },
      { name: 'Netflix', webId: null },
      { name: 'Rakuten TV', webId: null },
      { name: 'Pluto TV', webId: null },
    ],
  });
  assert.deepEqual(r.results[1], { key: 'tv-2', title: 'Le Bureau', year: '2015', type: 'tv', poster: null, providers: [] });
  // Les titres sans offres (route absente : 404) sont gardés, sans services.
  assert.deepEqual(r.results[2], { key: 'movie-100', title: 'Film 0', year: '', type: 'movie', poster: null, providers: [] });
  assert.deepEqual(calls[0], { pathname: '/search/multi', params: { query: 'amélie', language: 'fr-FR', include_adult: 'false', page: '1' }, timeout: 9000 });
  assert.equal(calls.length, 13);
  assert.ok(calls.every((c) => c.timeout === 9000));
});

test('recherche : langue et région des réglages (région en majuscules)', async () => {
  const { client, calls } = fakeTmdb({
    '/search/multi': { results: [{ id: 3, media_type: 'movie', title: 'Dune' }] },
    '/movie/3/watch/providers': { results: { BE: { flatrate: [offer(9, 'Prime Video')] }, FR: { flatrate: [offer(8, 'Netflix')] } } },
  });
  const r = await streamingSearchProvider(client).search('dune', context([], { language: 'nl-BE', region: 'be' }));
  assert.equal(calls[0].params.language, 'nl-BE');
  assert.deepEqual(r.ok && r.results[0].providers, [{ name: 'Prime Video', webId: null }]);
});

test('recherche vide : aucun résultat, sans appel ; sans clé : « nokey »', async () => {
  const { client, calls } = fakeTmdb({});
  assert.deepEqual(await streamingSearchProvider(client).search('   ', context()), { ok: true, results: [] });
  const sansCle = fakeTmdb({}, ' ');
  assert.deepEqual(await streamingSearchProvider(sansCle.client).search('dune', context()), { ok: false, reason: 'nokey' });
  assert.equal(calls.length + sansCle.calls.length, 0);
});

test('erreurs : TMDB injoignable, clé refusée (401), autre code', async () => {
  const url = 'https://api.themoviedb.org/3/search/multi';
  const cases: [HttpError, string][] = [
    [new HttpError('unreachable', url, 'x'), 'Le catalogue TMDB est injoignable. Vérifiez la connexion Internet.'],
    [new HttpError('timeout', url, 'x'), 'Le catalogue TMDB est injoignable. Vérifiez la connexion Internet.'],
    [new HttpError('status', url, 'x', { status: 401 }), 'Clé TMDB refusée. Vérifiez-la dans Réglages.'],
    [new HttpError('status', url, 'x', { status: 503 }), 'TMDB a répondu avec le code 503.'],
  ];
  for (const [err, message] of cases) {
    const { client } = fakeTmdb({ '/search/multi': err });
    await assert.rejects(streamingSearchProvider(client).search('dune', context()), { message });
  }
});

test('erreur sur les offres d’un titre : titre gardé, sans services', async () => {
  const { client } = fakeTmdb({
    '/search/multi': { results: [{ id: 4, media_type: 'tv', name: 'Kaamelott', first_air_date: '2005-01-03' }] },
    '/tv/4/watch/providers': new HttpError('timeout', 'https://api.themoviedb.org/3/tv/4/watch/providers', 'x'),
  });
  const r = await streamingSearchProvider(client).search('kaamelott', context());
  assert.deepEqual(r, { ok: true, results: [{ key: 'tv-4', title: 'Kaamelott', year: '2005', type: 'tv', poster: null, providers: [] }] });
});

test('avec le client TMDB réel (faux fetch) : mêmes adresses qu’avant', async () => {
  const fetch = fakeFetch({
    'https://api.themoviedb.org/3/search/multi?query=dune&language=fr-FR&include_adult=false&page=1&api_key=cle': {
      json: { results: [{ id: 3, media_type: 'movie', title: 'Dune' }] },
    },
    'https://api.themoviedb.org/3/movie/3/watch/providers?api_key=cle': { json: { results: { FR: { flatrate: [offer(8, 'Netflix')] } } } },
  });
  const client = createTmdbClient({ key: () => ' cle ', fetch });
  const r = await streamingSearchProvider(client).search('dune', context([site('netflix', 'Netflix')]));
  assert.deepEqual(fetch.missing, []);
  assert.deepEqual(r.ok && r.results[0].providers, [{ name: 'Netflix', webId: 'netflix' }]);
});
