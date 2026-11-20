import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = 'mire.page.images';
const PAGE = 'images';
const dir = new URL('../', import.meta.url);
const lire = (rel) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));
const CHAMPS = ['id', 'name', 'icon', 'require', 'exclude', 'where', 'groupBy', 'sort', 'display', 'menu'];
const ID_INFO = /^[a-z][a-zA-Z0-9]*$/;

describe(ID, () => {
  const manifeste = lire('mire-plugin.json');
  const page = lire(`pages/${PAGE}.json`);

  it('est un plugin de données sans permission, en 1.0.0', () => {
    assert.equal(manifeste.id, ID);
    assert.equal(manifeste.version, '1.0.0');
    assert.equal(manifeste.level, 'data');
    assert.equal(manifeste.permissions, undefined);
    assert.equal(manifeste.main, undefined);
  });

  it('apporte une seule page, désignée par son fichier', () => {
    assert.deepEqual(manifeste.contributes.pages, [{ id: PAGE, file: `pages/${PAGE}.json` }]);
    assert.equal(page.id, PAGE);
  });

  it('a une définition de page bornée, sans champ inconnu', () => {
    for (const k of Object.keys(page)) assert.ok(CHAMPS.includes(k), k);
    assert.ok(Array.isArray(page.require) && page.require.length > 0 && page.require.length <= 16);
    for (const info of page.groupBy ?? []) assert.match(info, ID_INFO);
    for (const s of page.sort ?? []) assert.match(s.by, ID_INFO);
    assert.ok(['posters', 'thumbnails', 'list', 'rows'].includes(page.display));
    assert.equal(page.menu.pinned, true);
  });

  it('donne son nom par une clé de texte, jamais en clair', () => {
    assert.deepEqual(Object.keys(page.name), ['key']);
    assert.equal(page.name.key, `pages.${PAGE}`);
  });

  it('fournit les textes en anglais et en français', () => {
    for (const code of ['en', 'fr']) {
      const cat = lire(`i18n/${code}.json`);
      assert.equal(cat.meta.code, code);
      assert.ok(cat.messages.plugin.name && cat.messages.plugin.description);
      assert.ok(cat.messages.pages[PAGE], code);
    }
  });
});
