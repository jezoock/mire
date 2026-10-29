'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { substitute, isUrlTarget } = require('../../lib/args.js');

test.describe('substitute', () => {
  test('remplace les variables connues', () => {
    assert.deepEqual(substitute(['--title={title}', '{url}', '-f'], { url: 'http://x', title: 'Film' }), ['--title=Film', 'http://x', '-f']);
  });

  test('argument retiré quand sa variable est vide', () => {
    assert.deepEqual(substitute(['{url}', '--start={start}', '--title={title}'], { url: 'u', start: '', title: null }), ['u']);
    assert.deepEqual(substitute(['--start={start}'], { start: 0 }), ['--start=0']);
  });

  test('variable inconnue laissée telle quelle ; liste absente', () => {
    assert.deepEqual(substitute(['{autre}', 3], { rom: 'r' }), ['{autre}', '3']);
    assert.deepEqual(substitute(undefined, {}), []);
  });
});

test('isUrlTarget', () => {
  assert.equal(isUrlTarget('steam://rungameid/1'), true);
  assert.equal(isUrlTarget('https://exemple.fr'), true);
  assert.equal(isUrlTarget('com.epicgames.launcher://apps/x'), true);
  assert.equal(isUrlTarget('C:\\Jeux\\jeu.exe'), false);
  assert.equal(isUrlTarget('/usr/bin/jeu'), false);
});
