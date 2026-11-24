// Infos en ligne MusicBrainz (repris de test/scrape/musicbrainz.test.ts de Mire), avec des réponses enregistrées, sans
// réseau ni minuterie réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createMetadata, { coverUrl } from '../src/metadata.mjs';
import { fakeClock, fakeContext, loadRoutes } from './helpers.mjs';

const album = { dir: '/m/Daft Punk - Discovery (2001)', folder: 'Daft Punk - Discovery (2001)' };

function setup(extra = {}, options = {}) {
  const env = fakeContext({ routes: { ...loadRoutes('musicbrainz'), ...extra }, ...options });
  return { ...env, provider: createMetadata(env.ctx, fakeClock()) };
}

test('album « Artiste - Titre (année) » : score suffisant, première pochette disponible, genre le plus cité', async () => {
  const { provider, calls } = setup();
  assert.deepEqual(await provider.scrape(album, null), {
    title: 'Discovery',
    artist: 'Daft Punk',
    year: '2001',
    genre: 'Électronique',
    image: 'https://coverartarchive.org/release-group/rg-discovery/front-250',
    source: 'MusicBrainz',
  });
  // Le groupe au score trop faible n'est pas essayé ; celui sans pochette l'est (sans la télécharger).
  assert.ok(!calls.some((c) => c.url.includes('rg-faible')));
  assert.deepEqual(
    calls.filter((c) => c.url.includes('coverartarchive')).map((c) => [c.url, c.method]),
    [
      [coverUrl('rg-sans-image'), 'HEAD'],
      [coverUrl('rg-discovery'), 'HEAD'],
    ],
  );
});

test('genre en anglais : l’étiquette de MusicBrainz', async () => {
  const { provider } = setup({}, { locale: 'en-GB' });
  assert.equal((await provider.scrape(album)).genre, 'Electronic');
});

test('rien trouvé : null ; titre vide : null', async () => {
  const { provider } = setup();
  assert.equal(await provider.scrape({ dir: '/m/Inconnu', folder: 'Inconnu' }), null);
  assert.equal(await provider.scrape({ dir: '/m/x', folder: '(2001)' }), null);
});

test('correction : artiste et titre saisis', async () => {
  const { provider } = setup();
  const r = await provider.scrape({ dir: '/m/x', folder: 'x' }, { artist: 'Daft Punk', title: 'Discovery' });
  assert.equal(r.title, 'Discovery');
});

test('fiche choisie : détails de MusicBrainz, ou ceux du candidat si indisponibles ; pochette par adresse', async () => {
  const { provider } = setup();
  const r = await provider.byId({ id: 'rg-discovery', title: 'Discovery', sub: 'Daft Punk', year: '2001' }, {});
  assert.equal(r.artist, 'Daft Punk, Romanthony');
  assert.equal(r.genre, 'Nu-disco');
  assert.equal(r.image, coverUrl('rg-discovery'));
  assert.equal(r.picked, true);
  assert.deepEqual(await provider.byId({ id: 'rg-absent', title: 'Titre', sub: 'Artiste', year: '1999-01-01' }, {}), {
    title: 'Titre',
    artist: 'Artiste',
    year: '1999',
    genre: '',
    image: coverUrl('rg-absent'),
    source: 'MusicBrainz',
    picked: true,
  });
});

test('candidates : triés par titre, pochette par adresse', async () => {
  const { provider } = setup();
  const items = await provider.candidates({ query: 'Discovery', artist: 'Daft Punk' });
  assert.deepEqual(
    items.map((i) => i.id),
    ['rg-discovery', 'rg-sans-date', 'rg-live'],
  );
  assert.deepEqual(items[0], { id: 'rg-discovery', title: 'Discovery', year: '2001', sub: 'Daft Punk, Album', image: coverUrl('rg-discovery') });
});

test('MusicBrainz en panne ou injoignable : { failure } (texte du plugin), sans adresse ni journal', async () => {
  const url = 'https://musicbrainz.org/ws/2/release-group/?query=releasegroup%3A%22Panne%22&fmt=json&limit=5';
  for (const [reply, message] of [
    [{ status: 503, json: {} }, 'MusicBrainz a répondu avec le code 503.'],
    [{ unreachable: true }, 'MusicBrainz est injoignable. Vérifiez la connexion Internet.'],
    [{ text: 'pas du JSON' }, 'MusicBrainz est injoignable. Vérifiez la connexion Internet.'],
  ]) {
    const { provider, logs } = setup({ [url]: reply });
    const r = await provider.scrape({ dir: '/m/Panne', folder: 'Panne' });
    assert.deepEqual(r, { failure: message });
    assert.deepEqual(logs, []);
  }
});

test('collect et clé : les albums de l’interface, clé du cœur `a:<dossier>`', () => {
  const { provider } = setup();
  assert.deepEqual(provider.collect({ albums: [album] }), [album]);
  assert.deepEqual(provider.collect({}), []);
  assert.equal(provider.key(album), `a:${album.dir}`);
});
