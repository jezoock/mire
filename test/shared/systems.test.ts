// Référentiel des systèmes : mêmes identifiants qu'avant P1-03, et guessSystem identique à l'ancienne version
// de scraper.js (ses tables sont recopiées ici comme référence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS, guessSystem, systemById, type SystemHint } from '@mire/shared';

// Liste LIBRETRO_SYSTEMS de src/renderer/app.js, dans son ordre.
const LIBRETRO_SYSTEMS = [
  'Nintendo - Nintendo Entertainment System',
  'Nintendo - Super Nintendo Entertainment System',
  'Nintendo - Game Boy',
  'Nintendo - Game Boy Color',
  'Nintendo - Game Boy Advance',
  'Nintendo - Nintendo 64',
  'Nintendo - Nintendo DS',
  'Nintendo - Nintendo 3DS',
  'Nintendo - GameCube',
  'Nintendo - Wii',
  'Nintendo - Wii U',
  'Sega - Mega Drive - Genesis',
  'Sega - Master System - Mark III',
  'Sega - Game Gear',
  'Sega - Saturn',
  'Sega - Dreamcast',
  'Sony - PlayStation',
  'Sony - PlayStation 2',
  'Sony - PlayStation Portable',
  'NEC - PC Engine - TurboGrafx 16',
  'Atari - 2600',
  'SNK - Neo Geo Pocket Color',
];

// Tables de scraper.js avant P1-03.
const SYSTEM_GUESS: [RegExp, string][] = [
  [/\.(nes|fds|unf)$/, 'Nintendo - Nintendo Entertainment System'],
  [/\.(sfc|smc)$/, 'Nintendo - Super Nintendo Entertainment System'],
  [/\.gbc$/, 'Nintendo - Game Boy Color'],
  [/\.gb$/, 'Nintendo - Game Boy'],
  [/\.gba$/, 'Nintendo - Game Boy Advance'],
  [/\.(n64|z64|v64)$/, 'Nintendo - Nintendo 64'],
  [/\.nds$/, 'Nintendo - Nintendo DS'],
  [/\.(3ds|cci|cxi)$/, 'Nintendo - Nintendo 3DS'],
  [/\.(md|gen|smd)$/, 'Sega - Mega Drive - Genesis'],
  [/\.sms$/, 'Sega - Master System - Mark III'],
  [/\.gg$/, 'Sega - Game Gear'],
  [/\.pce$/, 'NEC - PC Engine - TurboGrafx 16'],
  [/\.a26$/, 'Atari - 2600'],
];
const NAME_GUESS: [RegExp, string][] = [
  [/duckstation|playstation(?!\s*[2p])|\bps1\b|psx/i, 'Sony - PlayStation'],
  [/pcsx2|playstation\s*2|\bps2\b/i, 'Sony - PlayStation 2'],
  [/ppsspp|\bpsp\b/i, 'Sony - PlayStation Portable'],
  [/gamecube|\bgc\b/i, 'Nintendo - GameCube'],
  [/\bwii\s*u\b|cemu/i, 'Nintendo - Wii U'],
  [/\bwii\b/i, 'Nintendo - Wii'],
  [/dolphin/i, 'Nintendo - GameCube'],
  [/dreamcast|flycast/i, 'Sega - Dreamcast'],
  [/saturn/i, 'Sega - Saturn'],
  [/super\s*nintendo|snes/i, 'Nintendo - Super Nintendo Entertainment System'],
  [/mega\s*drive|genesis/i, 'Sega - Mega Drive - Genesis'],
  [/nintendo\s*64|\bn64\b/i, 'Nintendo - Nintendo 64'],
  [/game\s*boy\s*advance|\bgba\b/i, 'Nintendo - Game Boy Advance'],
  [/game\s*boy\s*color|\bgbc\b/i, 'Nintendo - Game Boy Color'],
  [/game\s*boy|\bgb\b/i, 'Nintendo - Game Boy'],
  [/\bnes\b|famicom/i, 'Nintendo - Nintendo Entertainment System'],
];
function oldGuessSystem(emu: SystemHint): string {
  if (emu.system) return emu.system;
  for (const [re, sys] of NAME_GUESS) if (re.test(`${emu.name} ${emu.path}`)) return sys;
  for (const ext of emu.extensions || []) {
    for (const [re, sys] of SYSTEM_GUESS) if (re.test(String(ext).toLowerCase())) return sys;
  }
  return '';
}

test('SYSTEMS : les identifiants libretro de l’interface, dans le même ordre', () => {
  assert.deepEqual(
    SYSTEMS.map((s) => s.id),
    LIBRETRO_SYSTEMS,
  );
  for (const s of SYSTEMS) assert.ok(s.name, s.id);
  assert.equal(systemById('Sega - Saturn')?.name, 'Saturn');
  assert.equal(systemById('Inconnu'), undefined);
});

test('SYSTEMS : extensions en minuscules, propres à un seul système', () => {
  const all = SYSTEMS.flatMap((s) => s.extensions);
  assert.equal(new Set(all).size, all.length);
  for (const e of all) assert.match(e, /^\.[a-z0-9]+$/);
});

test('SYSTEMS : chaque expression a une priorité distincte', () => {
  const priorities = SYSTEMS.flatMap((s) => s.aliases.map((a) => a.priority));
  assert.equal(new Set(priorities).size, priorities.length);
  assert.equal(priorities.length, NAME_GUESS.length);
});

test('guessSystem : même résultat que l’ancienne version de scraper.js', () => {
  const labels = [
    'DuckStation',
    'PlayStation',
    'PlayStation 2',
    'PlayStation Portable',
    'PCSX2',
    'PPSSPP',
    'GameCube',
    'Dolphin',
    'Wii (Dolphin)',
    'Dolphin GameCube Wii',
    'Wii U',
    'Cemu',
    'Wii',
    'Flycast',
    'Dreamcast',
    'Saturn Dolphin',
    'SNES',
    'Super Nintendo',
    'Mega Drive',
    'Genesis Plus GX',
    'Nintendo 64',
    'N64',
    'Game Boy Advance',
    'Game Boy Color',
    'Game Boy',
    'GBA / GB',
    'NES',
    'Famicom',
    'Atari',
    'Ma console',
  ];
  const paths = ['', 'C:/Jeux/emu.exe', '/opt/dolphin/dolphin-emu', 'C:/RetroArch/retroarch.exe'];
  const extensions = [
    undefined,
    [],
    ['.nes'],
    ['.FDS'],
    ['.zip', '.gbc'],
    ['.gb'],
    ['.sgb'],
    ['.GBA'],
    ['.z64'],
    ['.cxi'],
    ['.smd'],
    ['.sms'],
    ['.gg'],
    ['.pce'],
    ['.a26'],
    ['.xyz'],
    ['gb'],
    [42],
  ];
  for (const name of labels) {
    for (const path of paths) {
      for (const ext of extensions) {
        const emu = { name, path, extensions: ext };
        assert.equal(guessSystem(emu), oldGuessSystem(emu), JSON.stringify(emu));
      }
    }
  }
  for (const ext of extensions) {
    const emu = { name: 'Ma console', path: '/emu', extensions: ext };
    assert.equal(guessSystem(emu), oldGuessSystem(emu), JSON.stringify(emu));
  }
  assert.equal(guessSystem({ system: 'Sega - Saturn', name: 'PCSX2' }), 'Sega - Saturn');
});
