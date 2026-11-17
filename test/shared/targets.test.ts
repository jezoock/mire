// Notation des cibles (@mire/shared) : pages, listes et écrans du cœur.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCREENS, formatTarget, isTarget, PAGE_ID_RE, parseTarget } from '@mire/shared';

describe('cibles', () => {
  it('lit une page, une liste et un écran du cœur', () => {
    assert.deepEqual(parseTarget('movies'), { kind: 'page', id: 'movies' });
    assert.deepEqual(parseTarget('list:favoris-2'), { kind: 'list', id: 'favoris-2' });
    assert.deepEqual(parseTarget('screen:search'), { kind: 'screen', screen: 'search' });
  });

  it('refuse ce qui n’est pas une cible', () => {
    for (const v of [
      '',
      'Movies',
      'a b',
      'list:',
      'list:A',
      'list:a:b',
      'screen:',
      'screen:player',
      'screen:Search',
      'web:netflix',
      'x:y',
      3,
      null,
      undefined,
      {},
    ]) {
      assert.equal(parseTarget(v), null, String(v));
      assert.equal(isTarget(v), false, String(v));
    }
  });

  it('les écrans du cœur : liste fermée, avec au moins la recherche', () => {
    assert.ok(CORE_SCREENS.includes('search'));
    for (const screen of CORE_SCREENS) assert.deepEqual(parseTarget(`screen:${screen}`), { kind: 'screen', screen });
  });

  it('écrit une cible, et la relit à l’identique', () => {
    for (const t of [
      { kind: 'page', id: 'tv' },
      { kind: 'list', id: 'a1' },
      { kind: 'screen', screen: 'explorer' },
    ] as const) {
      assert.deepEqual(parseTarget(formatTarget(t)), t);
    }
    assert.equal(formatTarget({ kind: 'list', id: 'a1' }), 'list:a1');
    assert.equal(formatTarget({ kind: 'screen', screen: 'search' }), 'screen:search');
  });

  it('refuse d’écrire une cible invalide (une page ne peut pas se faire passer pour une liste ou un écran)', () => {
    assert.throws(() => formatTarget({ kind: 'page', id: 'list:a' }), RangeError);
    assert.throws(() => formatTarget({ kind: 'page', id: 'screen:search' }), RangeError);
    assert.throws(() => formatTarget({ kind: 'list', id: 'A' }), RangeError);
    assert.throws(() => formatTarget({ kind: 'screen', screen: 'player' as never }), RangeError);
  });

  it('un identifiant de page n’a jamais de « : »', () => {
    assert.equal(PAGE_ID_RE.test('list:a'), false);
    assert.equal(PAGE_ID_RE.test('a:b'), false);
    assert.doesNotMatch(PAGE_ID_RE.source, /:/);
  });
});
