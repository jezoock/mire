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

test('manifeste : niveau code, aucune permission, un tag automatique `series` qui pose ce qu’il déclare', () => {
  assert.equal(manifest.id, 'mire.tags.series');
  assert.equal(manifest.level, 'code');
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(
    manifest.contributes.taggers.map((c) => [c.id, c.main, c.tags]),
    [['series', 'src/tagger.mjs', ['series']]],
  );
  assert.deepEqual(Object.keys(manifest.contributes.taggers[0].infos), ['series', 'season', 'episode']);
  assert.equal(createTagger().id, 'series');
  checkTexts();
});

test('« Friends S01E03 » : `series`, série, saison et épisode', () => {
  assert.deepEqual(compute(fileEl('/Séries/Friends S01E03.mkv', 'video')), { tags: ['series'], infos: { series: 'Friends', season: 1, episode: 3 } });
});

test('épisode seul dans « Série/Saison 1 » : le titre vient du dossier parent', () => {
  const r = compute(fileEl('/Séries/Le Bureau des légendes/Saison 1/S01E03.mkv', 'video'));
  assert.deepEqual(r?.infos, { series: 'Le Bureau des légendes', season: 1, episode: 3 });
});

test('notation 1x03 dans un dossier non générique (chemin Windows)', () => {
  assert.deepEqual(compute(fileEl('D:\\Séries\\Kaamelott\\1x03.avi', 'video'))?.infos, { series: 'Kaamelott', season: 1, episode: 3 });
});

test('dossier générique sans parent : pas de nom de série, mais saison et épisode', () => {
  assert.deepEqual(compute(fileEl('/Saison 1/S01E03.mkv', 'video'))?.infos, { season: 1, episode: 3 });
});

test('un film, une musique ou un flux ne sont pas des séries', () => {
  assert.equal(compute(fileEl('/Films/Amélie (2001).mkv', 'video')), null);
  assert.equal(compute(fileEl('/Musique/S01E03.mp3', 'audio')), null);
  assert.equal(compute(el('Friends S01E03', { kind: 'stream', url: 'http://box/1' }, ['video'])), null);
});
