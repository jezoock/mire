'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const { createScraper, guessSystem, parseVideo } = require('../scraper');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-scraper-'));
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const { cleanTitle, romKey, bestMatch, rankByTitle, ...internes } = createScraper({
  dataDir,
  getConfig: () => ({}),
  listRoms: () => [],
  onProgress: () => {},
})._test;

test('_test expose les mêmes fonctions que les exports du module', () => {
  assert.equal(internes.parseVideo, parseVideo);
  assert.equal(internes.guessSystem, guessSystem);
});

test('parseVideo : film avec année entre parenthèses', () => {
  assert.deepEqual(parseVideo({ name: 'Amélie (2001)' }), { type: 'movie', title: 'Amélie', year: '2001' });
});

test('parseVideo : nom « scène » avec points et étiquettes techniques', () => {
  assert.deepEqual(parseVideo({ name: 'Le.Fabuleux.Destin.2001.1080p.BluRay.x264' }), {
    type: 'movie',
    title: 'Le Fabuleux Destin',
    year: '2001',
  });
});

test('parseVideo : une année dans le titre est gardée, seule la dernière compte', () => {
  assert.deepEqual(parseVideo({ name: 'Blade Runner 2049 (2017)' }), {
    type: 'movie',
    title: 'Blade Runner 2049',
    year: '2017',
  });
});

test('parseVideo : film sans année', () => {
  assert.deepEqual(parseVideo({ name: 'Mon film de vacances' }), {
    type: 'movie',
    title: 'Mon film de vacances',
    year: '',
  });
});

test('parseVideo : titre fait uniquement d’une année', { todo: 'bogue : le titre devient « 1 » (voir la PR P0-02)' }, () => {
  assert.deepEqual(parseVideo({ name: '1917' }), { type: 'movie', title: '1917', year: '' });
});

test('parseVideo : épisode S01E03 seul dans « Série/Saison 1 »', () => {
  assert.deepEqual(parseVideo({ name: 'S01E03', dir: '/Vidéos/Le Bureau des légendes/Saison 1' }), {
    type: 'tv',
    title: 'Le Bureau des légendes',
    year: '',
  });
});

test('parseVideo : épisode avec le titre de la série dans le nom', () => {
  assert.deepEqual(parseVideo({ name: 'Lost.S02E05.720p.WEB-DL', dir: '/Vidéos' }), {
    type: 'tv',
    title: 'Lost',
    year: '',
  });
});

test('parseVideo : notation 1x03', () => {
  assert.deepEqual(parseVideo({ name: 'Kaamelott 1x03', dir: '/Vidéos' }), { type: 'tv', title: 'Kaamelott', year: '' });
});

test('parseVideo : épisode 1x03 seul dans un dossier non générique (chemin Windows)', () => {
  assert.deepEqual(parseVideo({ name: '1x03', dir: 'C:\\Vidéos\\Kaamelott' }), {
    type: 'tv',
    title: 'Kaamelott',
    year: '',
  });
});

test('parseVideo : dossier générique sans dossier parent → titre vide', () => {
  assert.deepEqual(parseVideo({ name: 'S01E03', dir: '/Saison 1' }), { type: 'tv', title: '', year: '' });
  assert.deepEqual(parseVideo({ name: 'S01E03' }), { type: 'tv', title: '', year: '' });
});

test('cleanTitle : retire crochets, séparateurs et étiquettes techniques', () => {
  assert.equal(cleanTitle('[Team] Mon_Film.MULTi.1080p.x265'), 'Mon Film');
  assert.equal(cleanTitle('Un  titre   espacé'), 'Un titre espacé');
});

test('cleanTitle : cas limites (vide, parenthèses vides, tiret final)', () => {
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle('Titre ( )'), 'Titre');
  assert.equal(cleanTitle('Titre -'), 'Titre');
});

test('romKey : retire régions et marqueurs, normalise accents et « & »', () => {
  assert.equal(romKey('Super Mario World (Europe) (En,Fr) [!]'), 'super mario world');
  assert.equal(romKey('Pokémon Rouge & Bleu'), 'pokemon rouge and bleu');
});

test('romKey : nom fait uniquement d’étiquettes → clé vide', () => {
  assert.equal(romKey('(USA) [!]'), '');
  assert.equal(romKey(''), '');
});

test('bestMatch : correspondance exacte, la région préférée l’emporte', () => {
  const list = ['Super Mario World (USA)', 'Super Mario World (Japan)', 'Super Mario World (Europe)', 'Zelda (France)'];
  assert.equal(bestMatch(list, 'Super Mario World'), 'Super Mario World (Europe)');
  assert.equal(bestMatch(list, 'Super Mario World (Japan) [!]'), 'Super Mario World (Europe)');
  assert.equal(bestMatch(['Tetris (USA)', 'Tetris (France)'], 'Tetris'), 'Tetris (France)');
});

test('bestMatch : correspondance approchée au-dessus de 0,82', () => {
  assert.equal(bestMatch(['Super Mario Worlds (USA)', 'Zelda (USA)'], 'Super Mario World'), 'Super Mario Worlds (USA)');
});

test('bestMatch : rejet en dessous de 0,82', () => {
  assert.equal(bestMatch(['Super Mario Kart (USA)'], 'Super Mario World'), null);
});

test('bestMatch : liste vide ou nom sans clé', () => {
  assert.equal(bestMatch([], 'Tetris'), null);
  assert.equal(bestMatch(['Tetris (USA)'], '(Europe)'), null);
});

test('guessSystem : le système choisi par l’utilisateur l’emporte', () => {
  assert.equal(guessSystem({ system: 'Sega - Saturn', name: 'DuckStation', path: '' }), 'Sega - Saturn');
});

test('guessSystem : d’après le nom ou le programme', () => {
  assert.equal(guessSystem({ name: 'Émulateur', path: 'C:/Jeux/duckstation-qt.exe' }), 'Sony - PlayStation');
  assert.equal(guessSystem({ name: 'PlayStation 2', path: '' }), 'Sony - PlayStation 2');
  assert.equal(guessSystem({ name: 'Wii U', path: '' }), 'Nintendo - Wii U');
  assert.equal(guessSystem({ name: 'Wii', path: '' }), 'Nintendo - Wii');
});

test('guessSystem : d’après les extensions (sans tenir compte de la casse)', () => {
  assert.equal(guessSystem({ name: 'Ma console', path: '/emu', extensions: ['.GBA'] }), 'Nintendo - Game Boy Advance');
  assert.equal(guessSystem({ name: 'Ma console', path: '/emu', extensions: ['.zip', '.gbc'] }), 'Nintendo - Game Boy Color');
});

test('guessSystem : rien de reconnaissable → chaîne vide', () => {
  assert.equal(guessSystem({ name: 'Ma console', path: '/emu', extensions: ['.xyz'] }), '');
  assert.equal(guessSystem({ name: 'Ma console', path: '/emu' }), '');
});

test('rankByTitle : « Replaced » donne REPLACED avant « The Farmer Was Replaced »', () => {
  const list = [{ t: 'The Farmer Was Replaced' }, { t: 'REPLACED' }, { t: 'Replaced Deluxe' }, { t: 'Autre' }];
  const ranked = rankByTitle(list, 'Replaced', (x) => x.t).map((x) => x.t);
  assert.deepEqual(ranked, ['REPLACED', 'Replaced Deluxe', 'The Farmer Was Replaced', 'Autre']);
});

test('rankByTitle : l’année départage les homonymes, l’ordre d’origine sinon', () => {
  const list = [
    { t: 'Dune', y: '1984-12-14' },
    { t: 'Dune', y: '2021-09-15' },
  ];
  const getTitle = (x) => x.t;
  const getYear = (x) => x.y;
  assert.deepEqual(
    rankByTitle(list, 'Dune', getTitle, getYear, 2021).map((x) => x.y),
    ['2021-09-15', '1984-12-14'],
  );
  assert.deepEqual(
    rankByTitle(list, 'Dune', getTitle).map((x) => x.y),
    ['1984-12-14', '2021-09-15'],
  );
});

test('rankByTitle : liste vide', () => {
  assert.deepEqual(
    rankByTitle([], 'Replaced', (x) => x),
    [],
  );
});
