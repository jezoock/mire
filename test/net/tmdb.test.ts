// Client TMDB unique (P1-16) : jeton long dans l'en-tête, clé courte dans l'adresse, paramètres vides omis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdbClient, tmdbImageUrl, tmdbRequest } from '../../src/main/net/tmdb.ts';
import { HttpError } from '../../src/main/net/http.ts';
import { fakeFetch } from '../scrape/fake-fetch.ts';

const LONG = `eyJ${'a'.repeat(60)}`;

test('tmdbRequest : clé courte dans l’adresse, paramètres vides ou absents omis', () => {
  assert.deepEqual(tmdbRequest('/search/movie', { query: 'Le Destin', year: '', page: 1, region: null, x: undefined }, 'courte'), {
    url: 'https://api.themoviedb.org/3/search/movie?query=Le+Destin&page=1&api_key=courte',
    headers: {},
  });
});

test('tmdbRequest : jeton long (plus de 60 caractères) dans l’en-tête Authorization', () => {
  assert.deepEqual(tmdbRequest('/movie/1', {}, LONG), { url: 'https://api.themoviedb.org/3/movie/1', headers: { authorization: `Bearer ${LONG}` } });
  assert.equal(tmdbRequest('/movie/1', {}, 'a'.repeat(60)).url, `https://api.themoviedb.org/3/movie/1?api_key=${'a'.repeat(60)}`);
});

test('tmdbImageUrl', () => {
  assert.equal(tmdbImageUrl('/a.jpg', 'w342'), 'https://image.tmdb.org/t/p/w342/a.jpg');
});

test('client : clé relue à chaque requête (espaces retirés), JSON rendu, erreurs HttpError', async () => {
  let key = `  ${LONG} `;
  const fetch = fakeFetch({
    'https://api.themoviedb.org/3/movie/1': { json: { id: 1 } },
    'https://api.themoviedb.org/3/movie/2?api_key=courte': { status: 401, json: {} },
  });
  const client = createTmdbClient({ key: () => key, fetch });
  assert.equal(client.hasKey(), true);
  assert.deepEqual(await client.get('/movie/1'), { id: 1 });
  assert.equal(fetch.headers[0].authorization, `Bearer ${LONG}`);
  assert.equal(fetch.headers[0].accept, 'application/json');

  key = 'courte';
  await assert.rejects(client.get('/movie/2'), (err: HttpError) => err instanceof HttpError && err.kind === 'status' && err.status === 401);
  assert.equal(await client.get('/movie/3', {}, { notFoundAsNull: true }), null);
  key = '  ';
  assert.equal(client.hasKey(), false);
});
