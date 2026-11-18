// Versions et plages (engines.mire) : satisfies écrit à la main, règles de npm.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, satisfies } from '../../src/main/plugins/semver.ts';

describe('satisfies', () => {
  const cases: [string, string, boolean][] = [
    ['1.0.0', '^1.0.0', true],
    ['1.9.3', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.9.0', '^1.0.0', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.4', '^0.0.3', false],
    ['0.5.0', '^0.x', true],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '~1', true],
    ['1.5.0', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['2.1.0', '1.x || 2.x', true],
    ['3.0.0', '1.x || 2.x', false],
    ['7.1.2', '*', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.0', '1.2', true],
    ['1.3.0', '1.2', false],
    ['2.0.0', '>1', true],
    ['1.9.9', '>1', false],
    ['1.9.9', '<=1', true],
    ['2.0.0', '<=1', false],
    ['1.0.0', '>1.0.0', false],
    ['1.0.1', '>1.0.0', true],
    // Pré-publications : seulement avec un comparateur du même trio.
    ['2.0.0-beta.1', '^1.0.0', false],
    ['2.0.0-beta.1', '>=1.0.0', false],
    ['2.0.0-beta.2', '>=2.0.0-beta.1', true],
    ['2.0.0-beta.1', '^2.0.0-beta.1', true],
    ['2.0.0-beta.1', '>1', false],
    // Mal écrit : rien ne convient.
    ['1.0', '^1.0.0', false],
    ['1.0.0', 'pas une plage', false],
  ];
  for (const [v, r, ok] of cases) it(`${v} ${ok ? '∈' : '∉'} ${r}`, () => assert.equal(satisfies(v, r), ok));
});

describe('compareVersions', () => {
  it('ordonne les versions et les pré-publications', () => {
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ];
    const sorted = [...order].reverse().sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!));
    assert.deepEqual(sorted, order);
  });
});
