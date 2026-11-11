// Formats de fichiers (repris de test/lib/formats.test.js, déplacé avec le module en P1-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ART_RE, COVER_RE, DISC_INDEX_EXT, EXT, FANART_RE, GAME_FILE_RE, KIND, MEDIA_KINDS, MIME, NATIVE } from '@mire/shared';

test('KIND : chaque extension rangée sous son type', () => {
  assert.deepEqual(MEDIA_KINDS, Object.keys(EXT));
  assert.equal(KIND['.mkv'], 'video');
  assert.equal(KIND['.flac'], 'audio');
  assert.equal(KIND['.heic'], 'image');
  assert.equal(KIND['.txt'], undefined);
});

test('NATIVE et MIME : formats lus par le lecteur intégré', () => {
  assert.equal(NATIVE.has('.mp4'), true);
  assert.equal(NATIVE.has('.avi'), false);
  for (const ext of NATIVE) assert.ok(MIME[ext], ext);
});

test('illustrations', () => {
  assert.match('Cover.JPG', COVER_RE);
  assert.doesNotMatch('fanart.jpg', COVER_RE);
  assert.match('fanart.jpg', ART_RE);
  assert.match('clearlogo.png', ART_RE);
  assert.match('backdrop.webp', FANART_RE);
  assert.doesNotMatch('film-fanart.jpg', FANART_RE);
});

test('fichiers de jeux et index de disques', () => {
  assert.match('Jeu.CHD', GAME_FILE_RE);
  assert.doesNotMatch('jeu.txt', GAME_FILE_RE);
  assert.deepEqual([...DISC_INDEX_EXT], ['.cue', '.gdi', '.m3u', '.ccd', '.mds', '.toc']);
});
