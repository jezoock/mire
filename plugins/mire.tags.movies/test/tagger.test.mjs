import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createTagger, { compute } from '../src/tagger.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const manifest = read('mire-plugin.json');

/** Élément tel que le voit un tag automatique : tags du type de fichier et de la source déjà posés. */
const el = (name, open, tags = [], infos = {}) => ({
  key: 'local:x',
  source: { plugin: 'src-local', instance: '/' },
  name,
  open,
  tags,
  infos,
  images: {},
  added: 0,
});
/** Fichier local : le nom est celui du fichier sans extension, comme dans la bibliothèque de Mire. */
const fileEl = (p, tag, infos = {}) =>
  el(
    p
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, ''),
    { kind: 'file', path: p },
    [tag, 'local'],
    infos,
  );

/** Textes : ceux que le manifeste demande, en français et en anglais. */
function checkTexts() {
  const [c] = manifest.contributes.taggers;
  for (const lang of ['fr', 'en']) {
    const { meta, messages } = read(`i18n/${lang}.json`);
    assert.equal(meta.code, lang);
    assert.equal(typeof messages.plugin.name, 'string');
    for (const t of c.tags ?? []) assert.equal(typeof messages.tags[t], 'string', `${lang} tags.${t}`);
    for (const i of Object.keys(c.infos)) assert.equal(typeof messages.infos[i], 'string', `${lang} infos.${i}`);
  }
}

test('manifeste : niveau code, aucune permission, un tag automatique `movie` qui pose ce qu’il déclare', () => {
  assert.equal(manifest.id, 'mire.tags.movies');
  assert.equal(manifest.level, 'code');
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(
    manifest.contributes.taggers.map((c) => [c.id, c.main, c.tags]),
    [['movie', 'src/tagger.mjs', ['movie']]],
  );
  assert.deepEqual(Object.keys(manifest.contributes.taggers[0].infos), ['title', 'year']);
  assert.equal(createTagger().id, 'movie');
  checkTexts();
});

test('titre et année d’après le nom', () => {
  assert.deepEqual(compute(fileEl('/Films/Amélie (2001).mkv', 'video')), { tags: ['movie'], infos: { title: 'Amélie', year: 2001 } });
  assert.deepEqual(compute(fileEl('/Films/Le.Fabuleux.Destin.2001.1080p.BluRay.x264.mkv', 'video'))?.infos, { title: 'Le Fabuleux Destin', year: 2001 });
  assert.deepEqual(compute(fileEl('/Films/Blade Runner 2049 (2017).mkv', 'video'))?.infos, { title: 'Blade Runner 2049', year: 2017 });
});

test('sans année : le titre seul', () => {
  assert.deepEqual(compute(fileEl('/Films/Blade Runner 2049.mkv', 'video'))?.infos, { title: 'Blade Runner 2049' });
});

test('un épisode, une image ou un flux ne sont pas des films', () => {
  assert.equal(compute(fileEl('/Séries/Friends S01E03.mkv', 'video')), null);
  assert.equal(compute(fileEl('/Photos/Amélie (2001).jpg', 'image')), null);
  assert.equal(compute(el('Amélie (2001)', { kind: 'stream', url: 'http://box/1' }, ['video'])), null);
});
