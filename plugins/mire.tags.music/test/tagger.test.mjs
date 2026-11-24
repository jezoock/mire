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

test('manifeste : niveau code, aucune permission, un tag automatique `music` sans tag, avec ses infos', () => {
  assert.equal(manifest.id, 'mire.tags.music');
  assert.equal(manifest.level, 'code');
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(
    manifest.contributes.taggers.map((c) => [c.id, c.main, c.tags]),
    [['music', 'src/tagger.mjs', undefined]],
  );
  assert.deepEqual(Object.keys(manifest.contributes.taggers[0].infos), ['title', 'artist', 'album', 'track']);
  assert.equal(createTagger().id, 'music');
  checkTexts();
});

test('dossier « Artiste - Album » : artiste, album, piste et titre', () => {
  const r = compute(fileEl('/Musique/Daft Punk - Discovery/01 - One More Time.mp3', 'audio', { folder: 'Daft Punk - Discovery' }));
  assert.deepEqual(r, { infos: { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', track: 1 } });
});

test('dossier générique (« CD 2 ») : l’album est le dossier parent', () => {
  const r = compute(fileEl('C:\\Musique\\Album\\CD 2\\1-05 - Face B.flac', 'audio', { folder: 'CD 2' }));
  assert.deepEqual(r, { infos: { title: 'Face B', album: 'Album', track: 5 } });
});

test('sans numéro de piste ni info `folder` : le dossier du fichier', () => {
  assert.deepEqual(compute(fileEl('/Musique/Discovery/Around the World.mp3', 'audio')), { infos: { title: 'Around the World', album: 'Discovery' } });
});

test('« CD 1 » à la racine : le dossier lui-même, faute de parent', () => {
  assert.deepEqual(compute(fileEl('/CD 1/02 Intro.mp3', 'audio', { folder: 'CD 1' })), { infos: { title: 'Intro', album: 'CD 1', track: 2 } });
});

test('une vidéo n’a pas d’album', () => {
  assert.equal(compute(fileEl('/Musique/Clip.mp4', 'video')), null);
});
