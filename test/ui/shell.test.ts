// Coquille (P4-07) : règles sans DOM de mire-rail et mire-padbar (packages/ui/src/utils/shell.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAIL_CLOSE_DELAY,
  badgeText,
  isCarousel,
  isLongGlyph,
  menuPosition,
  railStaysOpen,
  readProp,
  scrollBehavior,
} from '../../packages/ui/src/utils/shell.ts';

describe('coquille : menu et aide de la manette', () => {
  it('position du menu : les quatre réglages, gauche sinon ; carrousel en haut et en bas', () => {
    assert.deepEqual(['left', 'right', 'top', 'bottom'].map(menuPosition), ['left', 'right', 'top', 'bottom']);
    for (const bad of [undefined, '', 'center', 3]) assert.equal(menuPosition(bad), 'left');
    assert.deepEqual((['left', 'right', 'top', 'bottom'] as const).map(isCarousel), [false, false, true, true]);
  });

  it('badge : un nombre positif, rien sinon', () => {
    assert.equal(badgeText(3), '3');
    assert.equal(badgeText(12.7), '12');
    for (const none of [0, -1, NaN, Infinity, '4', undefined]) assert.equal(badgeText(none), '');
  });

  it('le menu rétractable reste ouvert sous la souris ou avec le focus, et se ferme plus vite quand le focus part', () => {
    assert.equal(railStaysOpen({ hover: false, focusInside: false }), false);
    assert.equal(railStaysOpen({ hover: true, focusInside: false }), true);
    assert.equal(railStaysOpen({ hover: false, focusInside: true }), true);
    assert.ok(RAIL_CLOSE_DELAY.blur < RAIL_CLOSE_DELAY.leave);
  });

  it('propriétés reçues en JSON ou telles quelles', () => {
    assert.deepEqual(readProp('[1,2]', []), [1, 2]);
    assert.deepEqual(readProp([3], []), [3]);
    assert.deepEqual(readProp('', ['x']), ['x']);
    assert.deepEqual(readProp('{abîmé', {}), {});
    assert.deepEqual(readProp(null, { a: 1 }), { a: 1 });
  });

  it('un libellé de bouton long prend une pastille allongée', () => {
    assert.equal(isLongGlyph('A'), false);
    assert.equal(isLongGlyph('LB'), false);
    assert.equal(isLongGlyph('Affichage'), true);
  });

  it('défilement : en douceur pour un déplacement isolé, immédiat quand la touche reste enfoncée', () => {
    assert.equal(scrollBehavior({ reducedMotion: false, sinceLast: 1000 }), 'smooth');
    assert.equal(scrollBehavior({ reducedMotion: false, sinceLast: 60 }), 'auto');
    assert.equal(scrollBehavior({ reducedMotion: true, sinceLast: 1000 }), 'auto');
  });
});
