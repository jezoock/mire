// Registres : tags et infos déclarés par les plugins (registre du catalogue, mémoire de la recherche), contributions
// par nature, tags automatiques par lots, protocole mire-plugin://, état mémorisé, textes des plugins.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { contributionEntries, createContributionRegistry, declaredTagsAndInfos } from '../../src/main/plugins/registry.ts';
import { createPluginTaggers, sanitizeTaggerResult } from '../../src/main/plugins/taggers.ts';
import { HOST_CSP, resolvePluginRequest } from '../../src/main/plugins/protocol.ts';
import { normalizeState } from '../../src/main/plugins/state.ts';
import { createLanguageService } from '../../src/main/i18n/index.ts';
import type { PluginManifest } from '@mire/plugin-sdk';
import type { Config, Element } from '@mire/shared';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-registry-'));
after(() => rmSync(root, { recursive: true, force: true }));

describe('registre des tags et des infos', () => {
  it('déclare et retire les tags et infos d’un plugin ; le cœur garde la priorité', () => {
    const r = createRegistry((key) => `«${key}»`);
    let changes = 0;
    r.onChange(() => changes++);
    assert.equal(r.infoSearch('millesime'), 'text');
    r.declarePlugin('org.exemple.a', {
      tags: ['date', 'video'],
      infos: { millesime: { type: 'number' }, year: { type: 'text' } },
      textPrefix: 'pluginTexts.org_exemple_a.',
    });
    assert.equal(changes, 1);
    assert.equal(r.tagName('date'), '«pluginTexts.org_exemple_a.tags.date»');
    assert.equal(r.tagName('video'), '«catalog.tags.video»');
    assert.equal(r.isPluginTag('date'), true);
    assert.equal(r.isPluginTag('video'), false);
    assert.equal(r.infoName('millesime'), '«pluginTexts.org_exemple_a.infos.millesime»');
    assert.equal(r.infoType('millesime'), 'number');
    assert.equal(r.infoSearch('millesime'), null);
    assert.equal(r.infoType('year'), 'number');
    r.removePlugin('org.exemple.a');
    assert.equal(changes, 2);
    assert.equal(r.tagName('date'), 'date');
    assert.equal(r.infoSearch('millesime'), 'text');
  });
});

const manifest = {
  id: 'org.exemple.a',
  version: '1.0.0',
  engines: { mire: '^1.0.0' },
  level: 'code',
  contributes: {
    taggers: [{ id: 't', main: 't.js', tags: ['x'], infos: { n: { type: 'number' } } }],
    sources: [{ id: 's', main: 's.js', tags: ['y'], infos: { n: { type: 'text' }, m: { type: 'list' } } }],
    palettes: [{ id: 'nuit', file: 'nuit.json' }],
  },
  i18n: 'i18n/',
} as unknown as PluginManifest;

describe('registre des contributions', () => {
  it('expose les contributions par nature et prévient des changements', () => {
    const reg = createContributionRegistry();
    const seen: string[][] = [];
    reg.onChange((kinds) => seen.push(kinds));
    const entries = contributionEntries(manifest, '/p', new Map([['palettes/nuit', { a: 1 }]]), path.posix.join);
    reg.set('org.exemple.a', entries);
    assert.deepEqual(
      reg.list('palettes').map((e) => [e.pluginId, e.id, e.file, e.data]),
      [['org.exemple.a', 'nuit', '/p/nuit.json', { a: 1 }]],
    );
    assert.equal(reg.list('taggers')[0].declaration.main, 't.js');
    reg.remove('org.exemple.a');
    assert.deepEqual(reg.list('palettes'), []);
    assert.deepEqual(seen, [
      ['sources', 'taggers', 'palettes'],
      ['sources', 'taggers', 'palettes'],
    ]);
  });

  it('réunit les tags et infos déclarés (la première déclaration d’une info l’emporte)', () => {
    assert.deepEqual(declaredTagsAndInfos(manifest), { tags: ['y', 'x'], infos: { n: { type: 'text' }, m: { type: 'list' } } });
  });
});

describe('tags automatiques des plugins', () => {
  const decl = { tags: ['date'], infos: { n: { type: 'number' as const } } };
  it('ne garde que les tags et infos déclarés, au type déclaré', () => {
    assert.deepEqual(sanitizeTaggerResult({ tags: ['date', 'autre', 3], infos: { n: '12', z: 'x' } }, decl), { tags: ['date'], infos: { n: 12 } });
    assert.equal(sanitizeTaggerResult({ tags: ['autre'] }, decl), null);
    assert.equal(sanitizeTaggerResult('n’importe quoi', decl), null);
  });

  it('calcule par lots, garde les résultats, recalcule un élément changé', async () => {
    const batches: number[] = [];
    const refreshed: string[][] = [];
    const taggers = createPluginTaggers({ refresh: (keys) => refreshed.push(keys), onError: () => assert.fail(), batchSize: 2 });
    taggers.add({
      pluginId: 'p',
      id: 't',
      ...decl,
      computeBatch: async (els) => (batches.push(els.length), els.map((e) => ({ tags: ['date'], infos: { n: e.name.length } }))),
    });
    const [c] = taggers.contributors();
    const el = (key: string, name: string) => ({ key, name, tags: [], infos: {} }) as unknown as Element;
    const els = [el('a', 'un'), el('b', 'deux'), el('c', 'trois')];
    assert.deepEqual(
      els.map((e) => c.compute(e)),
      [null, null, null],
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(batches, [2, 1]);
    assert.deepEqual(refreshed, [['a', 'b'], ['c']]);
    assert.deepEqual(c.compute(els[1]), { tags: ['date'], infos: { n: 4 } });
    // Élément changé : l'ancien résultat en attendant le lot.
    assert.deepEqual(c.compute(el('b', 'quatre')), { tags: ['date'], infos: { n: 4 } });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(c.compute(el('b', 'quatre')), { tags: ['date'], infos: { n: 6 } });
    taggers.remove('p');
    assert.equal(c.compute(els[0]), null);
  });

  it('signale l’échec d’un lot', async () => {
    let failed = '';
    const taggers = createPluginTaggers({ refresh: () => {}, onError: (id) => (failed = id) });
    taggers.add({ pluginId: 'p', id: 't', ...decl, computeBatch: async () => Promise.reject(new Error('x')) });
    taggers.contributors()[0].compute({ key: 'a', name: 'a', tags: [], infos: {} } as unknown as Element);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(failed, 'p');
  });
});

describe('protocole mire-plugin://', () => {
  const plugin = path.join(root, 'plugin');
  mkdirSync(path.join(plugin, 'lib'), { recursive: true });
  writeFileSync(path.join(plugin, 'lib', 'a.js'), 'export default 1;');
  writeFileSync(path.join(root, 'secret.txt'), 'secret');
  symlinkSync(path.join(root, 'secret.txt'), path.join(plugin, 'lien.txt'));
  const opts = { hostDir: '/dist/plugin-host', pluginDir: (id: string) => (id === 'org.exemple.a' ? plugin : null) };
  const status = (url: string, method = 'GET') => {
    const r = resolvePluginRequest(method, url, opts);
    return r.ok ? 200 : r.status;
  };

  it('sert la page de l’hôte avec sa CSP, et les fichiers du plugin avec CORS', () => {
    const page = resolvePluginRequest('GET', 'mire-plugin://host/index.html', opts);
    assert.ok(page.ok);
    assert.equal(page.file, path.join('/dist/plugin-host', 'index.html'));
    assert.equal(page.headers['content-security-policy'], HOST_CSP);
    assert.match(HOST_CSP, /default-src 'none'/);
    assert.match(HOST_CSP, /connect-src mire-plugin:/);
    const file = resolvePluginRequest('GET', 'mire-plugin://org.exemple.a/lib/a.js', opts);
    assert.ok(file.ok);
    assert.equal(file.headers['access-control-allow-origin'], 'mire-plugin://host');
    assert.equal(file.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('refuse le reste', () => {
    assert.equal(status('mire-plugin://host/autre.js'), 404);
    assert.equal(status('mire-plugin://org.exemple.a/lib/a.js', 'POST'), 405);
    assert.equal(status('mire-plugin://org.exemple.b/lib/a.js'), 404);
    // Sorties par « .. » : normalisées par l'URL (404) ou refusées après décodage (403).
    for (const url of [
      'mire-plugin://org.exemple.a/lib/%2e%2e/%2e%2e/secret.txt',
      'mire-plugin://org.exemple.a/..%2f..%2fsecret.txt',
      'mire-plugin://org.exemple.a/lib/..%2F..%2Fsecret.txt',
    ])
      assert.ok([403, 404].includes(status(url)), url);
    assert.equal(status('mire-plugin://org.exemple.a/lib%5ca.js'), 403);
    assert.equal(status('mire-plugin://org.exemple.a/lien.txt'), 403);
    assert.equal(status('mire-plugin://org.exemple.a/lib'), 403);
    assert.equal(status('mire-plugin://org.exemple.a/absent.js'), 404);
    assert.equal(status('media://org.exemple.a/lib/a.js'), 400);
  });
});

describe('état des plugins', () => {
  it('ne garde que les entrées bien formées', () => {
    const s = normalizeState({
      version: 1,
      plugins: {
        a: { enabled: false, fault: { code: 'timeout', message: 'm', at: 1 } },
        b: { enabled: 'oui' },
        c: { enabled: true, fault: { code: 'autre' } },
      },
    });
    assert.deepEqual(s, { version: 1, plugins: { a: { enabled: false, fault: { code: 'timeout', message: 'm', at: 1 } }, c: { enabled: true } } });
    assert.deepEqual(normalizeState(null), { version: 1, plugins: {} });
  });
});

describe('textes des plugins', () => {
  it('sont ajoutés aux catalogues, puis retirés ; les abonnés sont prévenus', () => {
    const config = { get: () => ({ ui: { language: 'fr' } }) as Config, onChange: () => () => {} };
    const lang = createLanguageService({ config, systemLanguages: () => ['fr'] });
    let notified = 0;
    lang.onChange(() => notified++);
    assert.equal(lang.t('pluginTexts.org_exemple_a.plugin.name'), 'pluginTexts.org_exemple_a.plugin.name');
    lang.setPluginTexts('org_exemple_a', { en: { plugin: { name: 'Years' } }, fr: { plugin: { name: 'Années' } } });
    assert.equal(lang.t('pluginTexts.org_exemple_a.plugin.name'), 'Années');
    assert.equal((lang.snapshot().catalogs.fr.messages.pluginTexts as Record<string, unknown>).org_exemple_a !== undefined, true);
    lang.setPluginTexts('org_exemple_a', null);
    assert.equal(lang.t('pluginTexts.org_exemple_a.plugin.name'), 'pluginTexts.org_exemple_a.plugin.name');
    assert.equal(notified, 2);
  });
});
