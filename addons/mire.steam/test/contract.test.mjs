// Contrat attendu par Mire (P5-16) : identifiant, contribution, réglage, hôtes, textes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createMetadata from '../src/metadata.mjs';
import { metadataLanguage, steamLocale } from '../src/locale.mjs';
import { TEXT_CATALOGS } from '../src/texts.mjs';
import { fakeContext } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const manifest = read('mire-plugin.json');

test('manifeste : identifiant de la règle P5-16, niveau code, seuls les hôtes du magasin et des images de Steam', () => {
  assert.equal(manifest.id, 'mire.steam');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.level, 'code');
  assert.deepEqual(manifest.permissions, {
    hosts: ['store.steampowered.com', 'shared.akamai.steamstatic.com', 'cdn.akamai.steamstatic.com', 'store.akamai.steamstatic.com'],
  });
  assert.deepEqual(manifest.contributes.metadata, [{ id: 'steam', main: 'src/metadata.mjs', kinds: ['pc'] }]);
});

test('réglage : `language` (texte, `auto`), où la règle P5-16 range l’ancienne langue des fiches', () => {
  assert.deepEqual(manifest.settings, [{ key: 'language', type: 'text', default: 'auto' }]);
});

test('la fabrique rend la contribution déclarée (id attendu par l’hôte)', () => {
  assert.equal(createMetadata(fakeContext().ctx).id, manifest.contributes.metadata[0].id);
});

test('textes : ceux du code sont ceux des catalogues i18n (section steam), en français et en anglais', () => {
  for (const lang of ['fr', 'en']) {
    const catalog = read(`i18n/${lang}.json`);
    assert.equal(catalog.meta.code, lang);
    assert.deepEqual(catalog.messages.steam, TEXT_CATALOGS[lang]);
    assert.equal(typeof catalog.messages.settings.language.label, 'string');
  }
});

test('langue des fiches et paramètres du magasin (repris de Mire)', () => {
  assert.equal(metadataLanguage('auto', 'fr'), 'fr-FR');
  assert.equal(metadataLanguage('', 'en'), 'en-US');
  assert.equal(metadataLanguage(' nl-BE ', 'fr'), 'nl-BE');
  assert.equal(metadataLanguage(undefined, '!!'), 'fr-FR');
  assert.deepEqual(steamLocale('fr-FR'), { l: 'french', cc: 'FR' });
  assert.deepEqual(steamLocale('pt'), { l: 'portuguese', cc: 'BR' });
  assert.deepEqual(steamLocale('sv-SE'), { l: 'english', cc: 'SE' });
  assert.deepEqual(steamLocale('xx'), { l: 'english', cc: 'US' });
});
