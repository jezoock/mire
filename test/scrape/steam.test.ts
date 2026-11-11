// Fournisseur Steam (P1-16), avec des réponses enregistrées, sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steamProvider } from '../../src/main/scrape/providers/steam.ts';
import { loadRoutes } from './fake-fetch.ts';
import { imageSource, providerContext } from './helpers.ts';

const asset = (id: string | number, file: string) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/${file}`;

test('jeu cherché par son nom : meilleur titre, détails du magasin, description sans balises', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('steam'));
  const r = await steamProvider().scrape({ name: 'Hades', path: 'C:/Hades.exe' }, undefined, ctx('g:hades'));
  assert.equal(r?.title, 'Hades');
  assert.equal(r?.genre, 'Action, Aventure');
  assert.equal(r?.year, '2020');
  assert.match(String(r?.overview), /^Défiez le dieu des morts & frayez/);
  assert.equal(imageSource(r?.image), asset(1145360, 'library_600x900.jpg'));
  assert.equal(imageSource(r?.backdrop), asset(1145360, 'library_hero.jpg'));
});

test('raccourci steam:// : pas de recherche ; détails indisponibles → fiche réduite', async (t) => {
  const { ctx, fetch } = providerContext(t, loadRoutes('steam'));
  const r = await steamProvider().scrape({ name: 'Portal 2', path: 'steam://rungameid/620' }, undefined, ctx());
  assert.deepEqual(
    { ...r, image: imageSource(r?.image) },
    {
      title: 'Portal 2',
      image: 'https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg',
      backdrop: null,
      genre: '',
      year: '',
      overview: '',
      source: 'Steam',
    },
  );
  assert.ok(!fetch.calls.some((u) => u.includes('storesearch')));
});

test('introuvable ou sans image : null', async (t) => {
  const { ctx } = providerContext(t, {
    'https://store.steampowered.com/api/storesearch/?term=Rien&l=french&cc=FR': { json: { items: [] } },
  });
  assert.equal(await steamProvider().scrape({ name: 'Rien' }, undefined, ctx()), null);
  assert.equal(await steamProvider().scrape({ name: 'X', path: 'steam://rungameid/1' }, undefined, ctx()), null);
});

test('fiche choisie : l’identifiant du candidat', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('steam'));
  const r = await steamProvider().byId({ id: '1145360', title: 'Hades' }, { name: 'Mon jeu' }, ctx());
  assert.equal(r?.title, 'Hades');
});

test('collect : jeux de l’interface sinon de la configuration, un même nom une seule fois', async (t) => {
  const { ctx } = providerContext(t, {});
  const sp = steamProvider();
  assert.deepEqual(
    (await sp.collect({}, ctx())).map((g) => g.name),
    ['Hades', 'Portal 2'],
  );
  assert.deepEqual(await sp.collect({ pcGames: [{ name: 'Ys' }] }, ctx()), [{ name: 'Ys' }]);
  assert.equal(sp.key({ name: 'Hadès' }), 'g:hades');
});

test('candidates : image de bibliothèque et vignette de secours', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('steam'));
  const items = await steamProvider().candidates({ query: 'Hades' }, ctx());
  assert.deepEqual(items[0], {
    id: '1145360',
    title: 'Hades',
    year: '',
    sub: 'Steam',
    image: asset(1145360, 'library_600x900.jpg'),
    fallback: asset(1145360, 'capsule_231x87.jpg'),
  });
});
