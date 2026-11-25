import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = 'mire.emulator.duckstation';
const dir = new URL('../', import.meta.url);
const lire = (rel) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));
// Motif simple de Mire : `*` et `?` seulement, sans séparateur de dossier.
const motifSimple = (m) => typeof m === 'string' && m.length > 0 && m.length <= 100 && !/[/\\:<>"|]/.test(m);
const segmentSur = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64 && s !== '.' && s !== '..' && !/[<>:"/\\|?*]/.test(s);
const BASES = ['emulators', 'install', 'documents', 'appData', 'xdgConfig', 'xdgData'];

describe(ID, () => {
  const manifeste = lire('mire-plugin.json');
  const emu = lire('apps/duckstation.json');
  const fr = lire('i18n/fr.json');
  const en = lire('i18n/en.json');

  it('est un plugin de données sans permission, en 1.0.0, avec un émulateur', () => {
    assert.equal(manifeste.id, ID);
    assert.equal(manifeste.version, '1.0.0');
    assert.equal(manifeste.level, 'data');
    assert.equal(manifeste.permissions, undefined);
    assert.equal(manifeste.main, undefined);
    assert.deepEqual(manifeste.contributes.apps, [{ id: 'duckstation', file: 'apps/duckstation.json' }]);
    assert.equal(emu.kind, 'emulator');
  });

  it('se télécharge depuis la dernière version GitHub officielle, en https:', () => {
    assert.equal(new URL(emu.site).protocol, 'https:');
    assert.equal(emu.source.github, 'stenzek/duckstation');
    assert.deepEqual(Object.keys(emu.source.files).sort(), ['linux', 'windows']);
    for (const m of [...Object.values(emu.source.files), ...Object.values(emu.program)]) assert.ok(motifSimple(m), m);
  });

  it('lance le jeu avec {rom}, une seule fois, sans autre variable', () => {
    assert.equal(emu.args.filter((a) => a.includes('{rom}')).length, 1);
    for (const a of emu.args) assert.ok(!/[{}]/.test(a.replaceAll('{rom}', '')), a);
  });

  it('gère la PlayStation, rangée dans son dossier', () => {
    assert.deepEqual(emu.consoles, [
      { id: 'ps1', libretro: 'Sony - PlayStation', folder: 'PlayStation', extensions: ['.cue', '.chd', '.m3u', '.pbp', '.iso'] },
    ]);
  });

  it('décrit le dossier des BIOS (Mire n’en fournit aucun)', () => {
    for (const sys of ['windows', 'linux']) {
      const [base, ...rest] = emu.bios[sys];
      assert.ok(BASES.includes(base), base);
      assert.ok(rest.every(segmentSur), sys);
    }
    assert.ok(emu.bios.portable.markers.every(segmentSur) && emu.bios.portable.dir.every(segmentSur));
  });

  it('a un nom, une présentation et un rappel des BIOS en français et en anglais, sans HTML', () => {
    for (const c of [fr, en]) {
      const t = c.messages.apps.duckstation;
      for (const k of ['name', 'description', 'bios']) assert.ok(typeof t[k] === 'string' && t[k] && !/[<>]/.test(t[k]), k);
      assert.ok(c.messages.plugin.name && c.messages.plugin.description);
    }
  });
});
