// Fournisseur TMDB (P1-16), avec des réponses enregistrées (test/fixtures/scrape/tmdb.json), sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdbClient } from '../../src/main/net/tmdb.ts';
import { tmdbProvider } from '../../src/main/scrape/providers/tmdb.ts';
import { loadRoutes } from './fake-fetch.ts';
import { imageSource, providerContext } from './helpers.ts';
import { TMDB_KEY } from './scenario.ts';

const Q = `language=fr-FR&api_key=${TMDB_KEY}`;

function setup(t: Parameters<typeof providerContext>[0], extra = {}) {
  const env = providerContext(t, { ...loadRoutes('tmdb'), ...extra });
  let key = TMDB_KEY;
  const provider = tmdbProvider(createTmdbClient({ key: () => key, fetch: env.fetch }));
  return { ...env, provider, setKey: (k: string) => (key = k) };
}

test('film : recherche avec l’année, genres traduits (deux au plus), affiche et fond', async (t) => {
  const { provider, ctx } = setup(t);
  const r = await provider.scrape({ path: '/v/a.mkv', name: 'Le.Fabuleux.Destin.2001.1080p', dir: '/v' }, undefined, ctx('v:/v/a.mkv'));
  assert.equal(r?.title, "Le Fabuleux Destin d'Amélie Poulain");
  assert.equal(r?.year, '2001');
  assert.equal(r?.genre, 'Comédie, Romance');
  assert.equal(r?.series, false);
  assert.equal(imageSource(r?.image), 'https://image.tmdb.org/t/p/w342/amelie.jpg');
  assert.equal(imageSource(r?.backdrop), 'https://image.tmdb.org/t/p/w1280/amelie-fond.jpg');
});

test('film : sans résultat avec l’année, nouvel essai sans, puis recherche multiple', async (t) => {
  const { provider, ctx, fetch } = setup(t, {
    [`https://api.themoviedb.org/3/search/movie?query=Inconnu&year=1999&${Q}`]: { json: { results: [] } },
    [`https://api.themoviedb.org/3/search/movie?query=Inconnu&${Q}`]: { json: { results: [] } },
    [`https://api.themoviedb.org/3/search/multi?query=Inconnu&${Q}`]: {
      json: { results: [{ media_type: 'person' }, { media_type: 'tv', name: 'Inconnu', first_air_date: '2010-01-01', genre_ids: [80] }] },
    },
  });
  const r = await provider.scrape({ path: '/v/i', name: 'Inconnu (1999)' }, undefined, ctx());
  assert.deepEqual(r, { title: 'Inconnu', year: '2010', overview: '', genre: 'Crime', image: null, backdrop: null, series: true, source: 'TMDB' });
  assert.equal(fetch.calls.filter((u) => u.includes('/search/')).length, 3);
});

test('rien trouvé ou titre vide : null (échec noté par le moteur)', async (t) => {
  const { provider, ctx } = setup(t);
  assert.equal(await provider.scrape({ path: '/v/v', name: 'Vacances' }, undefined, ctx()), null);
  assert.equal(await provider.scrape({ path: '/v/s', name: 'S01E01', dir: '/Saison 1' }, undefined, ctx()), null);
});

test('série : une seule recherche et une seule image pour les épisodes traités ensemble', async (t) => {
  const { provider, ctx, fetch } = setup(t);
  const ep = (n: number) => ({ path: `/v/S01E0${n}`, name: `S01E0${n}`, dir: '/v/Le Bureau des légendes/Saison 1' });
  const [a, b] = await Promise.all([provider.scrape(ep(1), undefined, ctx('v:1')), provider.scrape(ep(2), undefined, ctx('v:2'))]);
  assert.equal(a?.series, true);
  assert.equal(a?.image, b?.image);
  assert.equal(fetch.calls.filter((u) => u.includes('/search/tv')).length, 1);
  assert.equal(fetch.calls.filter((u) => u.includes('bdl.jpg')).length, 1);
});

test('erreur de TMDB : message « hôte : code N », la recherche de série n’est pas gardée', async (t) => {
  const url = `https://api.themoviedb.org/3/search/tv?query=Panne&${Q}`;
  const { provider, ctx, fetch } = setup(t, { [url]: { status: 500, json: {} } });
  await assert.rejects(provider.scrape({ name: 'Panne S01E01' }, undefined, ctx()), { message: 'api.themoviedb.org : code 500' });
  await assert.rejects(provider.scrape({ name: 'Panne S01E02' }, undefined, ctx()));
  assert.equal(fetch.calls.filter((u) => u === url).length, 2);
});

test('correction (type, titre) et fiche choisie (images propres à l’élément, picked)', async (t) => {
  const { provider, ctx } = setup(t);
  const fixed = await provider.scrape({ path: '/v/x', name: 'x' }, { type: 'tv', title: 'Le Bureau des légendes', year: '' }, ctx());
  assert.equal(fixed?.title, 'Le Bureau des Légendes');
  const picked = await provider.byId({ id: 'movie:194' }, { path: '/v/c' }, ctx('v:/v/c'));
  assert.equal(picked?.picked, true);
  assert.equal(picked?.genre, 'Comédie, Romance');
  assert.equal(imageSource(picked?.image), 'https://image.tmdb.org/t/p/w342/amelie.jpg');
  assert.equal(await provider.byId({ id: 'tv:1' }, {}, ctx()), undefined);
});

test('jeton long : envoyé dans l’en-tête', async (t) => {
  const long = `eyJ${'b'.repeat(70)}`;
  const { provider, ctx, fetch, setKey } = setup(t, { 'https://api.themoviedb.org/3/movie/5?language=fr-FR': { json: { title: 'Cinq' } } });
  setKey(long);
  assert.equal((await provider.byId({ id: 'movie:5' }, {}, ctx()))?.title, 'Cinq');
  assert.equal(fetch.headers[0].authorization, `Bearer ${long}`);
});

test('requires : clé absente', (t) => {
  const { provider, ctx, setKey } = setup(t);
  assert.equal(provider.requires?.(ctx()), null);
  setKey(' ');
  assert.deepEqual(provider.requires?.(ctx()), {
    skipped: 'vidéos (clé TMDB absente)',
    error: 'Ajoutez une clé TMDB dans Réglages pour chercher les films et séries.',
  });
});

test('candidates : épisode → séries seulement ; sinon films et séries de la recherche multiple', async (t) => {
  const { provider, ctx } = setup(t, {
    [`https://api.themoviedb.org/3/search/multi?query=Dune&${Q}`]: {
      json: {
        results: [
          { media_type: 'person', name: 'Dune' },
          { media_type: 'movie', id: 1, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/d.jpg' },
          { media_type: 'movie', id: 2, title: 'Dune', original_title: 'Dune: Part One', release_date: '2021-09-15' },
        ],
      },
    },
  });
  assert.deepEqual(await provider.candidates({ item: { name: 'Dune' }, query: 'Dune', year: '2021' }, ctx()), [
    { id: 'movie:2', title: 'Dune', year: '2021', sub: 'Film, Dune: Part One', image: null },
    { id: 'movie:1', title: 'Dune', year: '1984', sub: 'Film', image: 'https://image.tmdb.org/t/p/w154/d.jpg' },
  ]);
  const tv = await provider.candidates({ item: { name: 'S01E03' }, query: 'Le Bureau des légendes' }, ctx());
  assert.equal(tv[0].id, 'tv:62014');
});
