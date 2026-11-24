// Contrat attendu par Mire (P5-16) : identifiant, contribution, hôtes, textes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createMetadata, { GAME_GENRES } from '../src/metadata.mjs';
import { TEXT_CATALOGS } from '../src/texts.mjs';
import { fakeContext } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const manifest = read('mire-plugin.json');

test('manifeste : identifiant de la règle P5-16, niveau code, seuls les hôtes de libretro et de GitHub', () => {
  assert.equal(manifest.id, 'mire.libretro');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.level, 'code');
  assert.deepEqual(manifest.permissions, { hosts: ['thumbnails.libretro.com', 'raw.githubusercontent.com', 'api.github.com'] });
  assert.deepEqual(manifest.contributes.metadata, [{ id: 'libretro', main: 'src/metadata.mjs', kinds: ['rom'] }]);
  assert.equal(manifest.settings, undefined);
});

test('la fabrique rend la contribution déclarée (id attendu par l’hôte)', () => {
  assert.equal(createMetadata(fakeContext().ctx).id, manifest.contributes.metadata[0].id);
});

test('textes : ceux du code sont ceux des catalogues i18n (section libretro), chaque genre traduit', () => {
  for (const lang of ['fr', 'en']) {
    const catalog = read(`i18n/${lang}.json`);
    assert.equal(catalog.meta.code, lang);
    assert.deepEqual(catalog.messages.libretro, TEXT_CATALOGS[lang]);
    for (const id of Object.values(GAME_GENRES)) assert.equal(typeof TEXT_CATALOGS[lang].genres[id], 'string', `${lang} ${id}`);
  }
});
