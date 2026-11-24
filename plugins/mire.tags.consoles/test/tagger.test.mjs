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
const game = (p, infos = {}) => el(p.split('/').pop(), { kind: 'game', console: 'emu-1', path: p }, ['game'], infos);

test('manifeste : niveau code, aucune permission, un tag automatique `consoles` qui pose l’info `system`', () => {
  assert.equal(manifest.id, 'mire.tags.consoles');
  assert.equal(manifest.level, 'code');
  assert.equal(manifest.permissions, undefined);
  assert.deepEqual(
    manifest.contributes.taggers.map((c) => [c.id, c.main, c.tags]),
    [['consoles', 'src/tagger.mjs', undefined]],
  );
  assert.deepEqual(manifest.contributes.taggers[0].infos, { system: { type: 'text' } });
  assert.equal(createTagger().id, 'consoles');
  checkTexts();
});

test('jeu sans système : d’après l’extension de son fichier ; rien si elle ne dit rien', () => {
  assert.deepEqual(compute(game('/roms/Tetris.gb')), { infos: { system: 'Nintendo - Game Boy' } });
  assert.deepEqual(compute(game('/roms/Mario.SFC')), { infos: { system: 'Nintendo - Super Nintendo Entertainment System' } });
  assert.deepEqual(compute(game('C:\\roms\\Zelda.gba')), { infos: { system: 'Nintendo - Game Boy Advance' } });
  assert.equal(compute(game('/roms/Jeu.zip')), null);
  assert.equal(compute(game('/roms/sans-extension')), null);
});

test('le système posé par la source des jeux (d’après la console) n’est pas touché', () => {
  assert.equal(compute(game('/roms/Panzer.gb', { system: 'Sega - Saturn' })), null);
});

test('seuls les jeux de console ont un système', () => {
  assert.equal(compute(fileEl('/roms/Tetris.gb', 'video')), null);
  assert.equal(compute(el('Jeu', { kind: 'program', path: '/jeux/jeu.exe' }, ['game'])), null);
});
