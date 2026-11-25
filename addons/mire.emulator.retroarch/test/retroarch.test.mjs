import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = 'mire.emulator.retroarch';
const dir = new URL('../', import.meta.url);
const lire = (rel) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));
const motifSimple = (m) => typeof m === 'string' && m.length > 0 && m.length <= 100 && !/[/\\:<>"|]/.test(m);
const segmentSur = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64 && s !== '.' && s !== '..' && !/[<>:"/\\|?*]/.test(s);
const BASES = ['emulators', 'install', 'documents', 'appData', 'xdgConfig', 'xdgData'];

describe(ID, () => {
  const manifeste = lire('mire-plugin.json');
  const emu = lire('apps/retroarch.json');
  const fr = lire('i18n/fr.json');
  const en = lire('i18n/en.json');

  it('est un plugin de données sans permission, en 1.0.0, avec un émulateur', () => {
    assert.equal(manifeste.id, ID);
    assert.equal(manifeste.version, '1.0.0');
    assert.equal(manifeste.level, 'data');
    assert.equal(manifeste.permissions, undefined);
    assert.equal(manifeste.main, undefined);
    assert.deepEqual(manifeste.contributes.apps, [{ id: 'retroarch', file: 'apps/retroarch.json' }]);
    assert.equal(emu.kind, 'emulator');
  });

  it('s’installe par l’installateur RetroArch de Mire (buildbot de libretro), sans arguments à lui', () => {
    assert.equal(new URL(emu.site).protocol, 'https:');
    assert.deepEqual(emu.source, { buildbot: 'retroarch' });
    assert.equal(emu.args, undefined);
    assert.deepEqual(Object.keys(emu.program).sort(), ['linux', 'windows']);
    for (const m of Object.values(emu.program)) assert.ok(motifSimple(m), m);
  });

  it('propose les dix consoles d’avant, chacune avec son cœur, son dossier et ses extensions', () => {
    assert.deepEqual(
      emu.consoles.map((c) => [c.id, c.core, c.folder]),
      [
        ['nes', 'fceumm', 'NES'],
        ['snes', 'snes9x', 'Super Nintendo'],
        ['gb', 'gambatte', 'Game Boy'],
        ['gbc', 'gambatte', 'Game Boy Color'],
        ['gba', 'mgba', 'Game Boy Advance'],
        ['n64', 'mupen64plus_next', 'Nintendo 64'],
        ['md', 'genesis_plus_gx', 'Mega Drive'],
        ['sms', 'genesis_plus_gx', 'Master System'],
        ['gg', 'genesis_plus_gx', 'Game Gear'],
        ['pce', 'mednafen_pce_fast', 'PC Engine'],
      ],
    );
    for (const c of emu.consoles) {
      assert.ok(typeof c.libretro === 'string' && c.libretro.includes(' - '), c.id);
      assert.ok(segmentSur(c.folder), c.id);
      assert.ok(c.extensions.length > 0 && c.extensions.every((e) => /^\.[a-z0-9]{1,8}$/.test(e)), c.id);
      assert.equal(c.args, undefined, c.id);
    }
  });

  it('décrit le dossier des BIOS (Mire n’en fournit aucun)', () => {
    for (const sys of ['windows', 'linux']) {
      const [base, ...rest] = emu.bios[sys];
      assert.ok(BASES.includes(base), base);
      assert.ok(rest.every(segmentSur), sys);
    }
  });

  it('a un nom, une présentation et un rappel des BIOS en français et en anglais, sans HTML', () => {
    for (const c of [fr, en]) {
      const t = c.messages.apps.retroarch;
      for (const k of ['name', 'description', 'bios']) assert.ok(typeof t[k] === 'string' && t[k] && !/[<>]/.test(t[k]), k);
      assert.ok(c.messages.plugin.name && c.messages.plugin.description);
    }
  });
});
