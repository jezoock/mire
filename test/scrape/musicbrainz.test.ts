// Fournisseur MusicBrainz (P1-16), avec des réponses enregistrées, sans réseau ; débit limité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicBrainzProvider } from '../../src/main/scrape/providers/musicbrainz.ts';
import { loadRoutes } from './fake-fetch.ts';
import { imageSource, providerContext } from './helpers.ts';

const album = { dir: '/m/Daft Punk - Discovery (2001)', folder: 'Daft Punk - Discovery (2001)' };

test('album « Artiste - Titre (année) » : score suffisant, première pochette disponible, genre le plus cité', async (t) => {
  const { ctx, fetch } = providerContext(t, loadRoutes('musicbrainz'));
  const r = await musicBrainzProvider({ intervalMs: 0 }).scrape(album, undefined, ctx('a:x'));
  assert.equal(r?.title, 'Discovery');
  assert.equal(r?.artist, 'Daft Punk');
  assert.equal(r?.year, '2001');
  assert.equal(r?.genre, 'Électronique');
  assert.equal(imageSource(r?.image), 'https://coverartarchive.org/release-group/rg-discovery/front-250');
  // Le groupe au score trop faible n'est pas essayé ; celui sans pochette l'est.
  assert.ok(!fetch.calls.some((u) => u.includes('rg-faible')));
  assert.ok(fetch.calls.some((u) => u.includes('rg-sans-image/front-250')));
});

test('rien trouvé : null ; titre vide : null ; annulation : undefined', async (t) => {
  const { ctx, state } = providerContext(t, loadRoutes('musicbrainz'));
  const mb = musicBrainzProvider({ intervalMs: 0 });
  assert.equal(await mb.scrape({ dir: '/m/Inconnu', folder: 'Inconnu' }, undefined, ctx()), null);
  assert.equal(await mb.scrape({ dir: '/m/x', folder: '(2001)' }, undefined, ctx()), null);
  state.cancel = true;
  assert.equal(await mb.scrape(album, undefined, ctx()), undefined);
});

test('correction : artiste et titre saisis', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('musicbrainz'));
  const r = await musicBrainzProvider({ intervalMs: 0 }).scrape({ dir: '/m/x', folder: 'x' }, { artist: 'Daft Punk', title: 'Discovery' }, ctx());
  assert.equal(r?.title, 'Discovery');
});

test('fiche choisie : détails de MusicBrainz, ou ceux du candidat si indisponibles', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('musicbrainz'));
  const mb = musicBrainzProvider({ intervalMs: 0 });
  const r = await mb.byId({ id: 'rg-discovery', title: 'Discovery', sub: 'Daft Punk', year: '2001' }, {}, ctx('a:c'));
  assert.equal(r?.artist, 'Daft Punk, Romanthony');
  assert.equal(r?.genre, 'Nu-disco');
  assert.equal(r?.picked, true);
  assert.deepEqual(await mb.byId({ id: 'rg-absent', title: 'Titre', sub: 'Artiste', year: '1999-01-01' }, {}, ctx('a:d')), {
    title: 'Titre',
    artist: 'Artiste',
    year: '1999',
    genre: '',
    image: null,
    source: 'MusicBrainz',
    picked: true,
  });
});

test('candidates : douze au plus, triés par titre', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('musicbrainz'));
  const items = await musicBrainzProvider({ intervalMs: 0 }).candidates({ query: 'Discovery', artist: 'Daft Punk' }, ctx());
  assert.deepEqual(
    items.map((i) => i.id),
    ['rg-discovery', 'rg-sans-date', 'rg-live'],
  );
});

test('débit limité : les requêtes vers MusicBrainz sont espacées, même lancées ensemble', async (t) => {
  const { ctx, fetch } = providerContext(t, loadRoutes('musicbrainz'));
  const times: number[] = [];
  const spy = ctx().io;
  const mb = musicBrainzProvider({ intervalMs: 60 });
  const base = ctx();
  const job = { ...base, io: { ...spy, getJson: (url: string) => (times.push(Date.now()), spy.getJson(url)) } };
  await Promise.all([1, 2, 3].map(() => mb.candidates({ query: 'Discovery', artist: 'Daft Punk' }, job)));
  assert.equal(fetch.calls.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 55, `écart ${times[i] - times[i - 1]} ms`);
});
