// Infos en ligne libretro (repris de test/scrape/libretro.test.ts de Mire) : jaquettes, captures, genres et années,
// avec des réponses enregistrées, sans réseau. Mire n'envoie d'un jeu que son nom, sa console et son système.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createMetadata, { bestMatch, CACHE_TTL_MS, romKey, thumbUrl } from '../src/metadata.mjs';
import { fakeContext, loadRoutes, memoryStorage } from './helpers.mjs';

const SNES = 'Nintendo - Super Nintendo Entertainment System';
const GB = 'Nintendo - Game Boy';
const smw = { name: 'Super Mario World (Europe)', displayName: 'Super Mario World', emu: 'snes', system: SNES };

function setup(routes = loadRoutes('libretro'), options = {}) {
  const env = fakeContext({ routes, ...options });
  return { ...env, provider: createMetadata(env.ctx, options.clock) };
}

test('jeu reconnu : jaquette de la région préférée, capture en fond, genre traduit et année, images par adresse', async () => {
  const { provider } = setup();
  assert.deepEqual(await provider.scrape(smw, null), {
    title: 'Super Mario World',
    image: thumbUrl(SNES, 'Named_Boxarts', 'Super Mario World (Europe)'),
    backdrop: thumbUrl(SNES, 'Named_Snaps', 'Super Mario World (Europe)'),
    genre: 'Plateformes',
    year: '1992',
    source: 'libretro',
  });
});

test('genre en anglais : la valeur de libretro', async () => {
  const { provider } = setup(undefined, { locale: 'en' });
  assert.equal((await provider.scrape(smw)).genre, 'Platform');
});

test('jaquette choisie : sans capture, l’écran titre sert de fond', async () => {
  const { provider } = setup();
  const r = await provider.byId({ id: 'Super Mario World (USA)' }, { name: 'x', emu: 'snes', system: SNES });
  assert.equal(r.image, thumbUrl(SNES, 'Named_Boxarts', 'Super Mario World (USA)'));
  assert.equal(r.backdrop, thumbUrl(SNES, 'Named_Titles', 'Super Mario World (USA)'));
  assert.equal(r.year, '1992'); // faits de la clé « super mario world »
});

test('système inconnu : { failure } avec le message habituel', async () => {
  const { provider } = setup();
  assert.deepEqual(await provider.scrape({ name: 'x', emu: 'inconnue', system: '' }), {
    failure: 'Système de la console inconnu : ajoutez « system » dans sa configuration.',
  });
  assert.deepEqual(await provider.candidates({ item: { emu: 'inconnue' }, query: 'x' }), {
    failure: 'Système de la console inconnu : indiquez-le avec « Modifier la console ».',
  });
});

test('liste par l’API GitHub quand le serveur libretro ne la donne pas, puis gardée dans le stockage du plugin', async () => {
  const repo = 'Nintendo_-_Game_Boy';
  const routes = {
    'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/.index': { text: '<html>erreur</html>' },
    [`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`]: {
      json: { tree: [{ path: 'Named_Boxarts/Tetris (World).png' }, { path: 'Named_Snaps/Tetris (World).png' }, { path: 'README.md' }] },
    },
  };
  const storage = memoryStorage();
  const { provider, calls } = setup(routes, { storage });
  const r = await provider.scrape({ name: 'Tetris', emu: 'gb', system: GB });
  assert.equal(r.image, thumbUrl(GB, 'Named_Boxarts', 'Tetris (World)'));
  assert.equal(calls[1].headers.accept, 'application/vnd.github+json');
  assert.deepEqual(storage.values.get(`index:${repo}`).value, ['Tetris (World)']);
  // Nouvelle instance (redémarrage) : la liste vient du stockage.
  const again = setup(routes, { storage });
  const items = await again.provider.candidates({ item: { system: GB }, query: 'tetris' });
  assert.deepEqual(
    items.map((i) => i.id),
    ['Tetris (World)'],
  );
  assert.equal(again.calls.filter((c) => c.url.includes('.index') || c.url.includes('api.github.com')).length, 0);
});

test('stockage : une liste de plus de 30 jours est relue en ligne ; un stockage plein n’empêche rien', async () => {
  let time = 1_000_000;
  const clock = { now: () => time };
  const storage = memoryStorage();
  const first = setup(undefined, { storage, clock });
  await first.provider.candidates({ item: { system: SNES }, query: 'mario' });
  time += CACHE_TTL_MS + 1;
  const later = setup(undefined, { storage, clock });
  await later.provider.candidates({ item: { system: SNES }, query: 'mario' });
  assert.equal(later.calls.filter((c) => c.url.endsWith('/.index')).length, 1);
  const full = setup(undefined, { storage: memoryStorage({ full: true }) });
  assert.equal((await full.provider.scrape(smw)).title, 'Super Mario World');
});

test('sans liste : noms devinés avec les régions courantes (vérifiés sans téléchargement) ; rien trouvé → null', async () => {
  const found = thumbUrl(GB, 'Named_Boxarts', 'Zelda (France)');
  const { provider, calls } = setup({ [found]: { image: 'image/png' } });
  const r = await provider.scrape({ name: 'Zelda', emu: 'gb', system: GB });
  assert.equal(r.image, found);
  assert.deepEqual(
    calls.filter((c) => c.url.includes('Named_Boxarts/Zelda')).map((c) => [decodeURIComponent(c.url.split('/').pop()), c.method]),
    [
      ['Zelda.png', 'HEAD'],
      ['Zelda (Europe).png', 'HEAD'],
      ['Zelda (France).png', 'HEAD'],
    ],
  );
  assert.equal(await provider.scrape({ name: 'Nul', emu: 'gb', system: GB }), null);
  assert.deepEqual(await provider.candidates({ item: { system: GB }, query: 'x' }), {
    failure: 'La liste des jaquettes de ce système est indisponible pour le moment.',
  });
});

test('serveurs injoignables : rien trouvé, sans erreur ni journal', async () => {
  const routes = new Proxy({}, { get: () => ({ unreachable: true }) });
  const { provider, logs } = setup(routes);
  assert.equal(await provider.scrape(smw), null);
  assert.deepEqual(logs, []);
});

// Repris de test/scrape/parse.test.js de Mire.
test('romKey : retire régions et marqueurs, normalise accents et « & » ; nom fait d’étiquettes → clé vide', () => {
  assert.equal(romKey('Super Mario World (Europe) (En,Fr) [!]'), 'super mario world');
  assert.equal(romKey('Pokémon Rouge & Bleu'), 'pokemon rouge and bleu');
  assert.equal(romKey('(USA) [!]'), '');
  assert.equal(romKey(''), '');
});

test('bestMatch : exacte (région préférée), approchée au-dessus de 0,82, rejet en dessous, liste vide ou nom sans clé', () => {
  const list = ['Super Mario World (USA)', 'Super Mario World (Japan)', 'Super Mario World (Europe)', 'Zelda (France)'];
  assert.equal(bestMatch(list, 'Super Mario World'), 'Super Mario World (Europe)');
  assert.equal(bestMatch(list, 'Super Mario World (Japan) [!]'), 'Super Mario World (Europe)');
  assert.equal(bestMatch(['Tetris (USA)', 'Tetris (France)'], 'Tetris'), 'Tetris (France)');
  assert.equal(bestMatch(['Super Mario Worlds (USA)', 'Zelda (USA)'], 'Super Mario World'), 'Super Mario Worlds (USA)');
  assert.equal(bestMatch(['Super Mario Kart (USA)'], 'Super Mario World'), null);
  assert.equal(bestMatch([], 'Tetris'), null);
  assert.equal(bestMatch(['Tetris (USA)'], '(Europe)'), null);
});
