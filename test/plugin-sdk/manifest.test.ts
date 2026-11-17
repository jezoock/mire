// Validation d'un manifeste de plugin (@mire/plugin-sdk) : manifestes valides et invalides.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isVersion, isVersionRange } from '../../packages/plugin-sdk/src/semver.ts';
import { declaredFiles, isPluginPath, requiredTexts, validateManifest } from '../../packages/plugin-sdk/src/validate.ts';
import type { PluginManifest } from '../../packages/plugin-sdk/src/manifest.ts';

/** Manifeste valide de référence (plugin de code tiers), modifiable par `patch`. */
const base = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'org.exemple.radios',
  version: '1.2.0',
  engines: { mire: '^1.0.0' },
  level: 'code',
  contributes: {
    sources: [{ id: 'radios', main: 'dist/index.js', tags: ['radio'], infos: { station: { type: 'text' } } }],
    packs: [{ id: 'stations', file: 'data/stations.json' }],
  },
  permissions: { hosts: ['api.radio-browser.info', '*.exemple.org'] },
  dependencies: { 'mire.tv.m3u': '>=1.0.0 <2.0.0' },
  settings: [
    { key: 'apiKey', type: 'secret' },
    { key: 'quality', type: 'choice', options: ['high', 'low'], default: 'high' },
  ],
  i18n: 'i18n/',
  ...patch,
});

const codes = (m: unknown, official = false): string[] => validateManifest(m, { official }).issues.map((i) => i.code);

describe('manifeste de plugin', () => {
  it('accepte un manifeste valide, de données comme de code', () => {
    assert.deepEqual(validateManifest(base()).issues, []);
    const data = {
      id: 'org.exemple.theme',
      version: '0.1.0',
      engines: { mire: '*' },
      level: 'data',
      contributes: { palettes: [{ id: 'nuit', file: 'nuit.json' }] },
      i18n: 'i18n',
    };
    assert.deepEqual(validateManifest(data).issues, []);
    const privileged = base({ level: 'privileged', contributes: { webExtensions: [{ id: 'bloqueur', main: 'index.js' }] }, permissions: { webViews: true } });
    assert.deepEqual(validateManifest(privileged).issues, []);
  });

  it('refuse du code dans un plugin de niveau « data »', () => {
    assert.ok(codes(base({ level: 'data', permissions: undefined })).includes('code-in-data'));
    const dataWithMain = base({ level: 'data', permissions: undefined, contributes: { themes: [{ id: 'mire', file: 't.json', main: 't.js' }] } });
    assert.deepEqual(codes(dataWithMain), ['code-in-data']);
  });

  it('refuse une contribution sensible ou une permission sensible sous le niveau « privileged »', () => {
    assert.deepEqual(codes(base({ contributes: { downloaders: [{ id: 'torrent', main: 'index.js' }] } })), ['level-too-low']);
    assert.deepEqual(codes(base({ permissions: { launch: true } })), ['privileged-permission']);
    // Une permission à `false` ne demande rien.
    assert.deepEqual(codes(base({ permissions: { launch: false } })), []);
  });

  it('refuse toute permission pour un plugin de données', () => {
    const data = base({ level: 'data', contributes: { packs: [{ id: 'p', file: 'p.json' }] } });
    assert.deepEqual(codes(data), ['permission-in-data']);
  });

  it('réserve le préfixe « mire. » au dépôt officiel', () => {
    assert.deepEqual(codes(base({ id: 'mire.radios' })), ['reserved-prefix']);
    assert.deepEqual(codes(base({ id: 'mire.radios' }), true), []);
  });

  it('refuse une permission, une contribution, un champ ou un niveau inconnus', () => {
    assert.deepEqual(codes(base({ permissions: { camera: true } })), ['unknown-permission']);
    assert.deepEqual(codes(base({ contributes: { widgets: [{ id: 'w', main: 'w.js' }] } })), ['unknown-contribution', 'empty-contributions']);
    assert.deepEqual(codes(base({ author: 'moi' })), ['unknown-field']);
    assert.deepEqual(codes(base({ level: 'root' })), ['unknown-level']);
    assert.deepEqual(codes(base({ contributes: { search: [{ id: 's', main: 's.js', tags: ['x'] }] } })), ['unknown-field']);
  });

  it('refuse des champs obligatoires absents', () => {
    const m = base();
    delete m.engines;
    delete m.i18n;
    assert.deepEqual(codes(m), ['missing-field', 'missing-field']);
    assert.deepEqual(codes(base({ contributes: { metadata: [{ id: 'tmdb', main: 'i.js' }] } })), ['missing-field']);
    assert.deepEqual(codes(base({ contributes: { pages: [{ id: 'films' }] } })), ['missing-field']);
    assert.deepEqual(codes(null), ['invalid-type']);
  });

  it('vérifie version, engines.mire et dépendances', () => {
    assert.deepEqual(codes(base({ version: '1.2' })), ['invalid-version']);
    assert.deepEqual(codes(base({ engines: { mire: 'dernière' } })), ['invalid-engine']);
    assert.deepEqual(codes(base({ engines: { mire: '' } })), ['invalid-engine']);
    assert.deepEqual(codes(base({ engines: {} })), ['invalid-engine']);
    assert.deepEqual(codes(base({ dependencies: { 'org.exemple.radios': '^1.0.0' } })), ['self-dependency']);
    assert.deepEqual(codes(base({ dependencies: { Radios: '^1.0.0', 'org.a.b': 'n/a' } })), ['invalid-dependency', 'invalid-dependency']);
  });

  it('vérifie identifiants, chemins, hôtes, infos et réglages', () => {
    assert.deepEqual(codes(base({ id: 'radios' })), ['invalid-id']);
    assert.deepEqual(codes(base({ contributes: { packs: [{ id: 'p', file: '../p.json' }] } })), ['invalid-path']);
    assert.deepEqual(
      codes(
        base({
          contributes: {
            packs: [
              { id: 'p', file: 'a.json' },
              { id: 'p', file: 'b.json' },
            ],
          },
        }),
      ),
      ['duplicate-id'],
    );
    assert.deepEqual(codes(base({ i18n: '/etc/' })), ['invalid-path']);
    assert.deepEqual(codes(base({ permissions: { hosts: ['http://a.com', 'a.com', 'a.com'] } })), ['invalid-value', 'duplicate-value']);
    assert.deepEqual(codes(base({ contributes: { taggers: [{ id: 't', main: 't.js', infos: { piste: { type: 'date' } } }] } })), ['invalid-info']);
    assert.deepEqual(codes(base({ settings: [{ key: 'apiKey', type: 'secret', default: 'abc' }] })), ['invalid-setting']);
    assert.deepEqual(codes(base({ settings: [{ key: 'q', type: 'choice', options: ['a'], default: 'b' }] })), ['invalid-setting']);
    assert.deepEqual(codes(base({ settings: [{ key: 'q', type: 'color' }] })), ['invalid-setting']);
    assert.deepEqual(
      codes(
        base({
          settings: [
            { key: 'q', type: 'toggle' },
            { key: 'q', type: 'text' },
          ],
        }),
      ),
      ['duplicate-setting'],
    );
  });

  it('indique où est chaque problème', () => {
    const [issue] = validateManifest(base({ contributes: { packs: [{ id: 'p', file: '..' }] } })).issues;
    assert.equal(issue?.path, 'contributes.packs[0].file');
    assert.ok(issue?.message);
  });

  it('liste les textes demandés et les fichiers déclarés', () => {
    const m = base() as unknown as PluginManifest;
    assert.deepEqual(requiredTexts(m), [
      'plugin.name',
      'tags.radio',
      'infos.station',
      'settings.apiKey.label',
      'settings.quality.label',
      'settings.quality.options.high',
      'settings.quality.options.low',
    ]);
    assert.deepEqual(declaredFiles(m), [
      { path: 'contributes.sources[0].main', file: 'dist/index.js' },
      { path: 'contributes.packs[0].file', file: 'data/stations.json' },
    ]);
  });
});

describe('versions et chemins', () => {
  it('reconnaît versions et plages semver', () => {
    for (const v of ['1.0.0', '0.1.0-beta.1', '2.0.0+build.5']) assert.ok(isVersion(v), v);
    for (const v of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-']) assert.ok(!isVersion(v), v);
    for (const r of ['^1.0.0', '~1.2', '>=1.0.0 <2.0.0', '1.x || 2.x', '*', '1.2.3']) assert.ok(isVersionRange(r), r);
    for (const r of ['', '^', '1.0.0 ||', 'latest', '>= 1.0.0']) assert.ok(!isVersionRange(r), r);
  });

  it('n’accepte que des chemins relatifs au plugin', () => {
    for (const p of ['index.js', 'dist/index.js', 'data/a.b.json']) assert.ok(isPluginPath(p), p);
    for (const p of ['', '/abs.js', '../a.js', 'a/../../b', './a.js', 'c:/a.js', 'a\\b.js', 'a//b.js']) assert.ok(!isPluginPath(p), p);
    assert.ok(isPluginPath('i18n/', true));
    assert.ok(!isPluginPath('i18n/'));
  });
});
