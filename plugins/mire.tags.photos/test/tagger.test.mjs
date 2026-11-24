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

test('manifeste : niveau code, aucune permission, un tag automatique `photos` qui pose l’info `folder`', () => {
  assert.equal(manifest.id, 'mire.tags.photos');
  assert.equal(manifest.level, 'code');
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(
    manifest.contributes.taggers.map((c) => [c.id, c.main, c.tags]),
    [['photos', 'src/tagger.mjs', undefined]],
  );
  assert.deepEqual(manifest.contributes.taggers[0].infos, { folder: { type: 'text' } });
  assert.equal(createTagger().id, 'photos');
  checkTexts();
});

test('groupe de dossier : le dossier, ou « parent, dossier » quand le dossier seul ne dit rien', () => {
  assert.deepEqual(compute(fileEl('/photos/Vacances/IMG_1.jpg', 'image', { folder: 'Vacances' })), { infos: { folder: 'Vacances' } });
  assert.deepEqual(compute(fileEl('/photos/Mariage/Partie 2/IMG_2.jpg', 'image', { folder: 'Partie 2' })), { infos: { folder: 'Mariage, Partie 2' } });
  assert.deepEqual(compute(fileEl('C:\\Photos\\Noël\\IMG_3.jpg', 'image')), { infos: { folder: 'Noël' } });
});

test('seules les images', () => {
  assert.equal(compute(fileEl('/photos/Vacances/clip.mp4', 'video', { folder: 'Vacances' })), null);
});
