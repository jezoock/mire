'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeText, srtToVtt, foldText, providerMatches, episodeNumbers, cleanRomName, similarity } = require('../../lib/text.js');

test.describe('decodeText', () => {
  test('UTF-8, marque d’ordre retirée', () => {
    assert.equal(decodeText(Buffer.from('\uFEFFÉté', 'utf8')), 'Été');
  });

  test('Windows-1252 quand le texte n’est pas de l’UTF-8 valide', () => {
    assert.equal(decodeText(Buffer.from([0xc9, 0x74, 0xe9])), 'Été');
  });

  // Node 22 décode les octets 0x80 à 0x9F comme des caractères de contrôle ; le Node d'Electron les décode bien.
  const brokenRuntime = new TextDecoder('windows-1252').decode(Buffer.from([0x80])) !== '€';
  test('Windows-1252 : €, apostrophe typographique, œ', { skip: brokenRuntime && 'TextDecoder windows-1252 incomplet dans ce Node' }, () => {
    assert.equal(decodeText(Buffer.from([0x80, 0x20, 0x92, 0x9c])), '€ ’œ');
  });
});

test('srtToVtt', () => {
  const srt = '1\r\n00:00:01,500 --> 00:00:03,250\r\nBonjour, 1,5 fois\r\n';
  assert.equal(srtToVtt(srt), 'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.250\nBonjour, 1,5 fois\n');
});

test('foldText', () => {
  assert.equal(foldText('  Ça Égale  '), 'ca egale');
  assert.equal(foldText(undefined), '');
});

test.describe('providerMatches', () => {
  test('alias reconnu comme mot dans le nom du fournisseur', () => {
    assert.equal(providerMatches('paramount+ amazon channel', 'paramount'), true);
    assert.equal(providerMatches('disney plus', 'disney plus'), true);
    assert.equal(providerMatches('canal+', 'canal+'), true);
    assert.equal(providerMatches('netflixx', 'netflix'), false);
  });

  test('alias =max : correspondance exacte', () => {
    assert.equal(providerMatches('max', '=max'), true);
    assert.equal(providerMatches('action max', '=max'), false);
    assert.equal(providerMatches('action max', 'max'), true);
  });
});

test('episodeNumbers', () => {
  assert.deepEqual(episodeNumbers('Serie.S01E03.mkv'), { season: 1, episode: 3 });
  assert.deepEqual(episodeNumbers('serie s2 e114'), { season: 2, episode: 114 });
  assert.deepEqual(episodeNumbers('Serie 1x07'), { season: 1, episode: 7 });
  assert.deepEqual(episodeNumbers('Film 1080p'), { season: null, episode: null });
});

test('cleanRomName', () => {
  assert.equal(cleanRomName('Super Mario World (Europe) (En,Fr) [!]'), 'Super Mario World');
  assert.equal(cleanRomName('Zelda_Link_To_The_Past'), 'Zelda Link To The Past');
  assert.equal(cleanRomName('(Europe)'), '(Europe)');
});

test('similarity', () => {
  assert.equal(similarity('The Witcher 3', 'the-witcher-3'), 1);
  assert.equal(similarity('Witcher3.exe', 'The Witcher 3'), 0);
  assert.equal(similarity('witcher3', 'The Witcher3 GOTY'), 0.8);
  assert.equal(similarity('Hadès', 'hades'), 1);
  assert.equal(similarity('', 'x'), 0);
  assert.equal(similarity('Doom', 'Quake'), 0);
});
