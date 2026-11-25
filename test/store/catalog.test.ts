// Catalogue de la boutique une fois les plugins RetroArch et DuckStation installés (P5-19a) : mêmes émulateurs, mêmes
// consoles et mêmes programmes qu'avant leur extraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allEmulators } from './emulator-fixtures.ts';

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const EMULATORS = allEmulators();
const ALL_SYSTEMS = EMULATORS.flatMap((e) => e.systems);
const RETROARCH_SYSTEMS = EMULATORS.find((e) => e.id === 'retroarch')!.systems;

const duplicates = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

test('catalogue : identifiants uniques', () => {
  assert.deepEqual(duplicates(EMULATORS.map((e) => e.id)), []);
  assert.deepEqual(duplicates(ALL_SYSTEMS.map((s) => s.id)), []);
});

test('catalogue : RetroArch propose ses dix consoles, chacune avec son cœur, comme avant P5-19a', () => {
  assert.deepEqual(
    RETROARCH_SYSTEMS.map((s) => [s.id, s.core, s.ext]),
    [
      ['nes', 'fceumm', ['.nes', '.fds', '.unf', '.zip']],
      ['snes', 'snes9x', ['.sfc', '.smc', '.zip']],
      ['gb', 'gambatte', ['.gb', '.zip']],
      ['gbc', 'gambatte', ['.gbc', '.zip']],
      ['gba', 'mgba', ['.gba', '.zip']],
      ['n64', 'mupen64plus_next', ['.n64', '.z64', '.v64', '.zip']],
      ['md', 'genesis_plus_gx', ['.md', '.gen', '.smd', '.bin', '.zip']],
      ['sms', 'genesis_plus_gx', ['.sms', '.zip']],
      ['gg', 'genesis_plus_gx', ['.gg', '.zip']],
      ['pce', 'mednafen_pce_fast', ['.pce', '.zip']],
    ],
  );
  const ra = EMULATORS.find((e) => e.id === 'retroarch')!;
  assert.deepEqual([ra.name, ra.site, ra.retroarch, ra.source, ra.args], ['RetroArch', 'https://www.retroarch.com', true, undefined, undefined]);
  for (const s of RETROARCH_SYSTEMS) assert.equal(s.args, undefined);
});

test('catalogue : DuckStation comme avant P5-19a (site, source, arguments, console)', () => {
  const duck = EMULATORS.find((e) => e.id === 'duckstation')!;
  assert.deepEqual(
    [duck.name, duck.site, duck.retroarch, duck.args],
    ['DuckStation', 'https://www.duckstation.org', undefined, ['-batch', '-fullscreen', '{rom}']],
  );
  assert.deepEqual(
    duck.systems.map((s) => [s.id, s.ext, s.core, s.args]),
    [['ps1', ['.cue', '.chd', '.m3u', '.pbp', '.iso'], undefined, undefined]],
  );
  assert.ok(duck.source && 'github' in duck.source && duck.source.github === 'stenzek/duckstation');
});

test('catalogue : chaque programme et chaque fichier reconnus comme avant P5-19a', () => {
  // Noms reconnus (ou refusés) par les expressions d'avant, pour chaque motif des données.
  const cases: [string, 'win32' | 'linux', string, boolean][] = [
    ['retroarch', 'win32', 'retroarch.exe', true],
    ['retroarch', 'win32', 'RetroArch.EXE', true],
    ['retroarch', 'win32', 'retroarch_debug.exe', false],
    ['retroarch', 'linux', 'RetroArch-Linux-x86_64.AppImage', true],
    ['retroarch', 'linux', 'retroarch-linux-x86_64.appimage', false],
    ['duckstation', 'win32', 'duckstation-qt-x64-ReleaseLTCG.exe', true],
    ['duckstation', 'win32', 'DUCKSTATION-QT-X64-RELEASELTCG.EXE', true],
    ['duckstation', 'win32', 'duckstation-qt-x64-ReleaseLTCGxexe', false],
    ['duckstation', 'linux', 'DuckStation-x64.AppImage', true],
    ['duckstation', 'linux', 'DuckStation-x64.AppImage.zsync', false],
    ['pcsx2', 'linux', 'pcsx2-v2.4-linux-appimage-x64-Qt.AppImage', true],
    ['cemu', 'win32', 'Cemu.exe', true],
  ];
  for (const [id, platform, name, expected] of cases) {
    assert.equal(EMULATORS.find((e) => e.id === id)!.exe[platform]!.test(name), expected, `${id} ${platform} ${name}`);
  }
  const files: [string, 'win32' | 'linux', string, boolean][] = [
    ['duckstation', 'win32', 'duckstation-windows-x64-release.zip', true],
    ['duckstation', 'win32', 'duckstation-windows-arm64-release.zip', false],
    ['duckstation', 'linux', 'DuckStation-x64.AppImage', true],
    ['pcsx2', 'win32', 'pcsx2-v2.4-windows-x64-Qt.7z', true],
    ['azahar', 'win32', 'azahar-windows-msvc-2122.1.zip', true],
    ['azahar', 'win32', 'azahar-windows-mingw-2122.1.zip', false],
  ];
  for (const [id, platform, name, expected] of files) {
    const src = EMULATORS.find((e) => e.id === id)!.source as unknown as Record<string, RegExp>;
    assert.equal(src[platform].test(name), expected, `${id} ${platform} ${name}`);
  }
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

test('catalogue : un programme à lancer pour chaque plateforme proposée par la source', () => {
  for (const e of EMULATORS) {
    assert.ok(e.exe, e.id);
    for (const platform of ['win32', 'linux'] as const) {
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
