import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const ID = 'mire.web.prime';
const SITE = 'prime';
const dir = new URL('../', import.meta.url);
const lire = (rel) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));

describe(ID, () => {
  const manifeste = lire('mire-plugin.json');
  const app = lire('app/site.json');

  it('est un plugin de données sans permission, en 1.0.0', () => {
    assert.equal(manifeste.id, ID);
    assert.equal(manifeste.version, '1.0.0');
    assert.equal(manifeste.level, 'data');
    assert.equal(manifeste.permissions, undefined);
    assert.equal(manifeste.main, undefined);
    assert.deepEqual(manifeste.contributes, { webApps: [{ id: SITE, file: 'app/site.json' }] });
  });

  it('décrit un service de la forme que lit Mire', () => {
    const permis = ['name', 'url', 'color', 'search', 'providers', 'background', 'category'];
    for (const k of Object.keys(app)) assert.ok(permis.includes(k), k);
    assert.ok(app.name && app.name.length <= 80 && !/[<>]/.test(app.name));
    assert.match(app.color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(app.category, /^[a-z][a-z-]{0,15}$/);
    assert.ok(app.providers === undefined || (Array.isArray(app.providers) && app.providers.length <= 8));
    assert.ok(app.background === undefined || typeof app.background === 'boolean');
  });

  it('n’a que des adresses https: sans identifiants, du même site', () => {
    const url = new URL(app.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username + url.password, '');
    assert.ok(app.url.length <= 500);
    if (app.search === undefined) return;
    assert.equal(app.search.split('{query}').length, 2, 'le jeton {query} une fois');
    const s = new URL(app.search.replace('{query}', 'test'));
    assert.equal(s.protocol, 'https:');
    assert.equal(s.username + s.password, '');
    assert.equal(s.hostname.split('.').slice(-2).join('.'), url.hostname.split('.').slice(-2).join('.'));
  });

  it('a un nom et une description en français et en anglais', () => {
    for (const l of ['fr', 'en']) {
      const c = lire(`i18n/${l}.json`);
      assert.equal(c.meta.code, l);
      assert.ok(c.messages.plugin.name && c.messages.plugin.description);
    }
  });
});
