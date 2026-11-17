// Le schéma JSON de mire-plugin.json et le validateur écrit à la main (@mire/plugin-sdk) restent d'accord : mêmes
// champs, mêmes champs obligatoires, mêmes valeurs permises, mêmes motifs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CODE_CONTRIBUTIONS,
  CONTRIBUTION_FIELDS,
  CONTRIBUTION_KINDS,
  INFO_FIELDS,
  INFO_TYPES,
  MANIFEST_FIELDS,
  METADATA_KINDS,
  PERMISSIONS,
  PLUGIN_LEVELS,
  REQUIRED_FIELDS,
  SETTING_FIELDS,
  SETTING_TYPES,
} from '../../packages/plugin-sdk/src/manifest.ts';
import { VERSION_RE } from '../../packages/plugin-sdk/src/semver.ts';
import { contributionRequired, HOST_RE, isPluginPath, INFO_ID_RE, LOCAL_ID_RE, OPTION_RE, PLUGIN_ID_RE } from '../../packages/plugin-sdk/src/validate.ts';

type Schema = Record<string, any>;
const schema: Schema = JSON.parse(readFileSync(new URL('../../packages/plugin-sdk/schema/mire-plugin.schema.json', import.meta.url), 'utf8'));
const keys = (o: Schema): string[] => Object.keys(o.properties).sort();
const sorted = (l: readonly string[]): string[] => [...l].sort();
const def = (name: string): Schema => schema.$defs[name];

describe('schéma de mire-plugin.json', () => {
  it('a les champs du manifeste, fermés, et les mêmes obligatoires', () => {
    assert.deepEqual(keys(schema), sorted(MANIFEST_FIELDS));
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(sorted(schema.required), sorted(REQUIRED_FIELDS));
    assert.deepEqual(sorted(schema.properties.engines.required), ['mire']);
    assert.deepEqual(keys(schema.properties.engines), ['mire']);
  });

  it('a les mêmes niveaux, contributions et permissions (listes fermées)', () => {
    assert.deepEqual(schema.properties.level.enum, [...PLUGIN_LEVELS]);
    assert.deepEqual(keys(schema.properties.contributes), sorted(CONTRIBUTION_KINDS));
    assert.equal(schema.properties.contributes.additionalProperties, false);
    assert.deepEqual(keys(schema.properties.permissions), sorted(PERMISSIONS));
    assert.equal(schema.properties.permissions.additionalProperties, false);
  });

  it('décrit chaque contribution avec les mêmes champs et les mêmes obligatoires', () => {
    for (const kind of CONTRIBUTION_KINDS) {
      assert.equal(schema.properties.contributes.properties[kind].items.$ref, `#/$defs/${kind}`);
      const d = def(kind);
      assert.equal(d.additionalProperties, false, kind);
      assert.deepEqual(keys(d), sorted(CONTRIBUTION_FIELDS[kind]), kind);
      assert.deepEqual(sorted(d.required), sorted(contributionRequired(kind)), kind);
      assert.ok(d.properties[(CODE_CONTRIBUTIONS as readonly string[]).includes(kind) ? 'main' : 'file'], kind);
    }
    assert.deepEqual(def('metadata').properties.kinds.items.enum, [...METADATA_KINDS]);
  });

  it('décrit réglages et infos comme le validateur', () => {
    const setting = schema.properties.settings.items;
    assert.deepEqual(keys(setting), sorted(SETTING_FIELDS));
    assert.deepEqual(setting.properties.type.enum, [...SETTING_TYPES]);
    assert.deepEqual(sorted(setting.required), ['key', 'type']);
    const info = def('infos').additionalProperties;
    assert.deepEqual(keys(info), sorted(INFO_FIELDS));
    assert.deepEqual(info.properties.type.enum, [...INFO_TYPES]);
  });

  it('emploie les mêmes motifs', () => {
    assert.equal(def('pluginId').pattern, PLUGIN_ID_RE.source);
    assert.equal(def('localId').pattern, LOCAL_ID_RE.source);
    assert.equal(def('infos').propertyNames.pattern, INFO_ID_RE.source);
    assert.equal(schema.properties.settings.items.properties.key.pattern, INFO_ID_RE.source);
    assert.equal(schema.properties.settings.items.properties.options.items.pattern, OPTION_RE.source);
    assert.equal(schema.properties.permissions.properties.hosts.items.pattern, HOST_RE.source);
    assert.equal(schema.properties.version.pattern, VERSION_RE.source);
  });

  it('accepte les mêmes chemins de fichiers', () => {
    const re = new RegExp(def('path').pattern, 'u');
    for (const p of ['index.js', 'dist/index.js', 'a.b/c.json', '', '/a.js', '../a.js', 'a/../b', './a', 'a/.', 'c:/a', 'a\\b', 'a//b', 'a/']) {
      assert.equal(re.test(p), isPluginPath(p), JSON.stringify(p));
    }
  });
});
