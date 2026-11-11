'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const { EMULATORS, FREE_GAMES, RETROARCH_SYSTEMS } = require('../src/main/store/catalog/index.ts');
const ALL_SYSTEMS = EMULATORS.flatMap((e) => e.systems);

const duplicates = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

test('catalogue : identifiants uniques', () => {
  assert.deepEqual(duplicates(EMULATORS.map((e) => e.id)), []);
  assert.deepEqual(duplicates(ALL_SYSTEMS.map((s) => s.id)), []);
  assert.deepEqual(duplicates(FREE_GAMES.map((g) => g.id)), []);
});

test('catalogue : RetroArch propose exactement les systèmes RetroArch', () => {
  assert.deepEqual(EMULATORS.find((e) => e.id === 'retroarch').systems, RETROARCH_SYSTEMS);
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

// Nom, dossier et système libretro de chaque console de la boutique, tels qu'ils étaient écrits avant P1-03.
test('catalogue : consoles reprises du référentiel des systèmes sans changement', () => {
  const before = {
    nes: ['NES', 'Nintendo - Nintendo Entertainment System'],
    snes: ['Super Nintendo', 'Nintendo - Super Nintendo Entertainment System'],
    gb: ['Game Boy', 'Nintendo - Game Boy'],
    gbc: ['Game Boy Color', 'Nintendo - Game Boy Color'],
    gba: ['Game Boy Advance', 'Nintendo - Game Boy Advance'],
    n64: ['Nintendo 64', 'Nintendo - Nintendo 64'],
    md: ['Mega Drive', 'Sega - Mega Drive - Genesis'],
    sms: ['Master System', 'Sega - Master System - Mark III'],
    gg: ['Game Gear', 'Sega - Game Gear'],
    pce: ['PC Engine', 'NEC - PC Engine - TurboGrafx 16'],
    ps1: ['PlayStation', 'Sony - PlayStation'],
    ps2: ['PlayStation 2', 'Sony - PlayStation 2'],
    psp: ['PSP', 'Sony - PlayStation Portable'],
    gc: ['GameCube', 'Nintendo - GameCube'],
    wii: ['Wii', 'Nintendo - Wii'],
    nds: ['Nintendo DS', 'Nintendo - Nintendo DS'],
    '3ds': ['Nintendo 3DS', 'Nintendo - Nintendo 3DS'],
    wiiu: ['Wii U', 'Nintendo - Wii U'],
  };
  const now = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, [s.name, s.libretro]]));
  assert.deepEqual(now, before);
  for (const s of ALL_SYSTEMS) assert.equal(s.folder, s.name);
});
