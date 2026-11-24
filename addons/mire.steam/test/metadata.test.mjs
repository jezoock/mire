// Infos en ligne Steam (repris de test/scrape/steam.test.ts de Mire), avec des réponses enregistrées, sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createMetadata, { assets } from '../src/metadata.mjs';
import { fakeContext, loadRoutes } from './helpers.mjs';

const asset = (id, file) => assets(id, file)[0];

function setup(extra = {}, options = {}) {
  const env = fakeContext({ routes: { ...loadRoutes('steam'), ...extra }, ...options });
  return { ...env, provider: createMetadata(env.ctx) };
}

test('jeu cherché par son nom : meilleur titre, détails du magasin, description sans balises, images par adresse', async () => {
  const { provider, calls } = setup();
  const r = await provider.scrape({ name: 'Hades', path: 'C:/Hades.exe' }, null);
  assert.equal(r.title, 'Hades');
  assert.equal(r.genre, 'Action, Aventure');
  assert.equal(r.year, '2020');
  assert.match(r.overview, /^Défiez le dieu des morts & frayez/);
  assert.equal(r.image, asset(1145360, 'library_600x900.jpg'));
  assert.equal(r.backdrop, asset(1145360, 'library_hero.jpg'));
  assert.equal(r.source, 'Steam');
  // Les images sont seulement vérifiées (Mire les copie lui-même).
  assert.ok(calls.filter((c) => c.url.includes('steamstatic')).every((c) => c.method === 'HEAD'));
});

test('raccourci steam:// : pas de recherche ; détails indisponibles → fiche réduite, image de secours', async () => {
  const { provider, calls } = setup();
  assert.deepEqual(await provider.scrape({ name: 'Portal 2', path: 'steam://rungameid/620' }), {
    title: 'Portal 2',
    image: 'https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg',
    backdrop: null,
    genre: '',
    year: '',
    overview: '',
    source: 'Steam',
  });
  assert.ok(!calls.some((c) => c.url.includes('storesearch')));
});

test('introuvable ou sans image : null', async () => {
  const { provider } = setup({ 'https://store.steampowered.com/api/storesearch/?term=Rien&l=french&cc=FR': { json: { items: [] } } });
  assert.equal(await provider.scrape({ name: 'Rien' }), null);
  assert.equal(await provider.scrape({ name: 'X', path: 'steam://rungameid/1' }), null);
});

test('fiche choisie : l’identifiant du candidat', async () => {
  const { provider } = setup();
  const r = await provider.byId({ id: '1145360', title: 'Hades' }, { name: 'Mon jeu' });
  assert.equal(r.title, 'Hades');
});

test('collect : jeux envoyés par Mire, un même nom une seule fois ; clé du cœur `g:<nom>`', () => {
  const { provider } = setup();
  assert.deepEqual(provider.collect({ pcGames: [{ name: 'Ys' }, { name: 'ys' }, { name: 'Hadès' }] }), [{ name: 'Ys' }, { name: 'Hadès' }]);
  assert.deepEqual(provider.collect({}), []);
  assert.equal(provider.key({ name: 'Hadès' }), 'g:hades');
});

test('candidates : image de bibliothèque et vignette de secours', async () => {
  const { provider } = setup();
  const items = await provider.candidates({ query: 'Hades' });
  assert.deepEqual(items[0], {
    id: '1145360',
    title: 'Hades',
    year: '',
    sub: 'Steam',
    image: asset(1145360, 'library_600x900.jpg'),
    fallback: asset(1145360, 'capsule_231x87.jpg'),
  });
});

test('langue : réglage du plugin, sinon celle de Mire (anglais → magasin américain)', async () => {
  const term = 'https://store.steampowered.com/api/storesearch/?term=Ys';
  for (const [options, query] of [
    [{ locale: 'en' }, 'l=english&cc=US'],
    [{ locale: 'fr', settings: { language: 'de-AT' } }, 'l=german&cc=AT'],
    [{ locale: 'fr-BE' }, 'l=french&cc=BE'],
  ]) {
    const { provider, calls } = setup({}, options);
    await provider.candidates({ query: 'Ys' });
    assert.equal(calls[0].url, `${term}&${query}`);
  }
});

test('magasin en panne ou injoignable : { failure } (texte du plugin), sans adresse ni journal', async () => {
  const url = 'https://store.steampowered.com/api/storesearch/?term=Panne&l=french&cc=FR';
  for (const [reply, message] of [
    [{ status: 500, json: {} }, 'Le magasin Steam a répondu avec le code 500.'],
    [{ unreachable: true }, 'Le magasin Steam est injoignable. Vérifiez la connexion Internet.'],
  ]) {
    const { provider, logs } = setup({ [url]: reply });
    assert.deepEqual(await provider.scrape({ name: 'Panne' }), { failure: message });
    assert.deepEqual(await provider.candidates({ query: 'Panne' }), { failure: message });
    assert.deepEqual(logs, []);
  }
});
