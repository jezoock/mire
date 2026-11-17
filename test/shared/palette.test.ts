// Palettes : choix de la palette d'un réglage (« Automatique » compris) et lecture des métadonnées (palette.json).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_PALETTES, DEFAULT_PALETTE, isPaletteId, parsePaletteMeta, resolvePalette } from '@mire/shared';

describe('resolvePalette', () => {
  it('« auto » suit le mode du système', () => {
    assert.equal(resolvePalette('auto', true), AUTO_PALETTES.dark);
    assert.equal(resolvePalette('auto', false), AUTO_PALETTES.light);
    assert.deepEqual(AUTO_PALETTES, { light: 'jour', dark: 'ecran' });
  });

  it('un identifiant est gardé tel quel, quel que soit le mode', () => {
    assert.equal(resolvePalette('minuit', false), 'minuit');
    assert.equal(resolvePalette('palette-de-plugin', true), 'palette-de-plugin');
  });

  it('réglage absent ou invalide : la palette par défaut', () => {
    for (const s of [undefined, null, '', '../ecran', 'Jour', 'a b']) assert.equal(resolvePalette(s, false), DEFAULT_PALETTE);
    assert.equal(DEFAULT_PALETTE, 'ecran');
  });

  it('identifiants admis : minuscules, chiffres, tirets', () => {
    assert.ok(isPaletteId('contraste'));
    assert.ok(isPaletteId('nuit-2'));
    for (const id of ['', '-a', 'a-', 'a--b', 'A', 'a/b', 3]) assert.equal(isPaletteId(id), false, String(id));
  });
});

describe('parsePaletteMeta', () => {
  it('lit le nom, la couleur de fond et le mode', () => {
    assert.deepEqual(parsePaletteMeta({ name: 'palettes.jour', background: '#F1EFE8', scheme: 'light', autre: 1 }), {
      name: 'palettes.jour',
      background: '#F1EFE8',
      scheme: 'light',
    });
  });

  it('refuse un contenu incomplet ou invalide', () => {
    const ok = { name: 'palettes.x', background: '#000000', scheme: 'dark' };
    for (const bad of [null, 'x', [], { ...ok, name: '' }, { ...ok, background: 'black' }, { ...ok, background: '#000' }, { ...ok, scheme: 'gris' }]) {
      assert.equal(parsePaletteMeta(bad), null, JSON.stringify(bad));
    }
  });
});
