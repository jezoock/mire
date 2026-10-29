'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EXT, KIND, NATIVE, MIME, COVER_RE, ART_RE, FANART_RE, MEDIA_KINDS } = require('../../lib/formats.js');

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
