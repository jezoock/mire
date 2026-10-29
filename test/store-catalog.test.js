'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const { EMULATORS, FREE_GAMES } = require('../store');

// RETROARCH_SYSTEMS n'est pas exporté : c'est la liste des systèmes de l'émulateur RetroArch.
const RETROARCH_SYSTEMS = EMULATORS.find((e) => e.id === 'retroarch').systems;
const ALL_SYSTEMS = EMULATORS.flatMap((e) => e.systems);

const duplicates = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

test('catalogue : identifiants uniques', () => {
  assert.deepEqual(duplicates(EMULATORS.map((e) => e.id)), []);
  assert.deepEqual(duplicates(ALL_SYSTEMS.map((s) => s.id)), []);
  assert.deepEqual(duplicates(FREE_GAMES.map((g) => g.id)), []);
});

test('catalogue : chaque système a un nom libretro et des extensions valides', () => {
  assert.ok(RETROARCH_SYSTEMS.length > 0);
  for (const s of ALL_SYSTEMS) {
    assert.equal(typeof s.libretro, 'string', s.id);
    assert.ok(s.libretro.length > 0, s.id);
    assert.ok(s.ext.length > 0, s.id);
    for (const ext of s.ext) assert.match(ext, /^\.[a-z0-9]+$/, `${s.id} : ${ext}`);
  }
});

test('catalogue : chaque jeu libre vise un système RetroArch et un fichier qu’il sait ouvrir', () => {
  for (const g of FREE_GAMES) {
    const system = RETROARCH_SYSTEMS.find((s) => s.id === g.system);
    assert.ok(system, `${g.id} : système ${g.system} inconnu`);
    assert.ok(system.ext.includes(g.file.slice(g.file.lastIndexOf('.')).toLowerCase()), g.id);
    assert.match(g.url, /^https:\/\//, g.id);
  }
});

test('catalogue : un programme à lancer pour chaque plateforme proposée par la source', () => {
  for (const e of EMULATORS) {
    assert.ok(e.exe, e.id);
    for (const platform of ['win32', 'linux']) {
      if (e.source?.[platform]) assert.ok(e.exe[platform] instanceof RegExp, `${e.id} : ${platform}`);
    }
  }
});
