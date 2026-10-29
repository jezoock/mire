'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultRomSites, GAME_FILE_RE } = require('../romsites');

const names = (system) => defaultRomSites(system).map((s) => s.name);

// Aucun système n'est couvert par les quatre sites : Homebrew Hub (GB, GBC, GBA, NES) et
// Universal-DB (DS, 3DS) n'ont aucune console en commun. Le maximum est de trois.
test('defaultRomSites : système couvert par trois sites, dans l’ordre', () => {
  assert.deepEqual(defaultRomSites('Nintendo - Game Boy'), [
    {
      name: 'Homebrew Hub',
      url: 'https://hh.gbdev.io/search?platform=GB&typetag=game',
      search: 'https://hh.gbdev.io/search?q={q}&platform=GB&typetag=game',
    },
    {
      name: 'PDRoms',
      url: 'https://pdroms.de/files/nintendo-game-boy-gb-gbc/',
      search: 'https://pdroms.de/?s={q}',
    },
    {
      name: 'itch.io',
      url: 'https://itch.io/search?q=game+boy+rom',
      search: 'https://itch.io/search?q={q}+game+boy',
    },
  ]);
});

test('defaultRomSites : Universal-DB et PDRoms pour la Nintendo DS', () => {
  assert.deepEqual(names('Nintendo - Nintendo DS'), ['Universal-DB', 'PDRoms']);
  assert.equal(defaultRomSites('Nintendo - Nintendo DS')[0].search, '');
});

test('defaultRomSites : système couvert par un seul site', () => {
  assert.deepEqual(defaultRomSites('Nintendo - Nintendo 3DS'), [{ name: 'Universal-DB', url: 'https://db.universal-team.net/3ds', search: '' }]);
  assert.deepEqual(names('Sega - Saturn'), ['PDRoms']);
});

test('defaultRomSites : système couvert par aucun site', () => {
  assert.deepEqual(defaultRomSites('Nintendo - Wii U'), []);
  assert.deepEqual(defaultRomSites(''), []);
  assert.deepEqual(defaultRomSites(undefined), []);
});

test('defaultRomSites : chaque appel rend une nouvelle liste', () => {
  const a = defaultRomSites('Nintendo - Game Boy');
  a.pop();
  assert.equal(defaultRomSites('Nintendo - Game Boy').length, 3);
});

test('GAME_FILE_RE : fichiers de jeux reconnus, sans tenir compte de la casse', () => {
  for (const name of ['jeu.zip', 'Jeu.7Z', 'disque.CUE', 'rom.gba', 'rom.a26', 'https://ex.org/a/jeu.3dsx']) {
    assert.match(name, GAME_FILE_RE);
  }
});

test('GAME_FILE_RE : autres fichiers refusés', () => {
  for (const name of ['page.html', 'jeu.zip.html', 'jeu.zip?dl=1', 'notice.pdf', 'zip', '']) {
    assert.doesNotMatch(name, GAME_FILE_RE);
  }
});
