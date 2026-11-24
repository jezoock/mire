// Schéma des réglages de @mire/shared (P1-26) : chemins, types de champ, doublons.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_FIELD_TYPES,
  SETTINGS_SCHEMA,
  fieldPaths,
  settingsPaths,
  settingsTextKey,
  settingsTextKeys,
  validateSettingsSchema,
  valueAtPath,
} from '@mire/shared/settings/schema';
import type { SettingsSchema } from '@mire/shared/settings/schema';
import { DEFAULT_CONFIG } from '../../src/main/config/index.ts';
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };

// Valeurs volontairement mal formées : le typage strict ne s'applique pas ici.
type Any = any;

describe('SETTINGS_SCHEMA', () => {
  it('est valide', () => {
    assert.deepEqual(validateSettingsSchema(SETTINGS_SCHEMA), []);
  });

  it('chaque chemin de config existe dans DEFAULT_CONFIG (sauf ceux des blocs facultatifs)', () => {
    const optional = SETTINGS_SCHEMA.flatMap((b) => b.fields).flatMap((f) => (f.type === 'custom' && f.optional ? f.paths : []));
    assert.deepEqual(optional, ['catalog.metadataProviders']);
    for (const p of settingsPaths()) if (!optional.includes(p)) assert.notEqual(valueAtPath(DEFAULT_CONFIG, p), undefined, p);
  });

  it('chaque texte est une clé tirée des identifiants, présente en français et en anglais', () => {
    const keys = settingsTextKeys();
    assert.ok(keys.includes('settings.home.clock.label'));
    assert.ok(keys.includes('settings.language.interface.options.auto'));
    for (const key of keys) {
      for (const catalog of [fr, en]) {
        const text = valueAtPath(catalog.messages, key);
        assert.equal(typeof text, 'string', `${catalog.meta.code} : ${key}`);
      }
    }
  });

  it('réglages de langue : interface (Automatique, puis les langues) ; la langue des fiches est un réglage des plugins (P5-16)', () => {
    const fields = SETTINGS_SCHEMA.find((b) => b.id === 'language')!.fields;
    const ui = fields.find((f) => f.id === 'interface')!;
    assert.ok(ui.type === 'choice' && ui.path === 'ui.language' && ui.optionsFrom === 'languages');
    assert.deepEqual(
      ui.options.map((o) => o.value),
      ['auto'],
    );
    assert.deepEqual(
      fields.map((f) => f.id),
      ['interface'],
    );
  });

  it('chaque valeur par défaut est celle de DEFAULT_CONFIG', () => {
    for (const f of SETTINGS_SCHEMA.flatMap((b) => b.fields)) {
      if (f.type !== 'custom') assert.deepEqual(f.default, valueAtPath(DEFAULT_CONFIG, f.path), f.path);
    }
  });

  it('chaque type de champ est valide', () => {
    for (const f of SETTINGS_SCHEMA.flatMap((b) => b.fields)) assert.ok(SETTINGS_FIELD_TYPES.includes(f.type), f.id);
  });

  it('aucun chemin en double', () => {
    const paths = settingsPaths();
    assert.equal(new Set(paths).size, paths.length);
  });

  it('couvre les réglages repérés en double dans le rendu actuel', () => {
    const paths = settingsPaths();
    for (const p of ['adblock.enabled', 'ui.start', 'ui.home.clock', 'externalPlayer.path', 'ui.language']) {
      assert.equal(paths.filter((x) => x === p).length, 1, p);
    }
  });
});

describe('validateSettingsSchema', () => {
  const block = (fields: Any[]): SettingsSchema => [{ id: 'bloc', title: 'settings.bloc.title', fields }];

  it('type de champ inconnu', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'couleur', path: 'a', default: '', label: 'settings.bloc.x.label' }]));
    assert.match(errors.join('\n'), /type inconnu/);
  });

  it('valeur par défaut du mauvais type', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'toggle', path: 'a', default: 'oui', label: 'settings.bloc.x.label' }]));
    assert.match(errors.join('\n'), /non booléenne/);
  });

  it('choix : valeur par défaut absente des options', () => {
    const options = [{ value: 'a', label: 'settings.bloc.x.options.a' }];
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'choice', path: 'a', default: 'b', options, label: 'settings.bloc.x.label' }]));
    assert.match(errors.join('\n'), /absente des options/);
  });

  it('composant inconnu', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'custom', component: 'nope', paths: [], label: 'settings.bloc.x.label' }]));
    assert.match(errors.join('\n'), /composant inconnu/);
  });

  it('chemin en double, ou contenu dans un autre', () => {
    const t = (id: string, path: string) => ({ id, type: 'toggle', path, default: false, label: `settings.bloc.${id}.label` });
    assert.match(validateSettingsSchema(block([t('a', 'ui.x'), t('b', 'ui.x')])).join('\n'), /chemin en double : ui\.x/);
    const custom = { id: 'c', type: 'custom', component: 'sources', paths: ['ui'], label: 'settings.bloc.c.label' };
    assert.match(validateSettingsSchema(block([t('a', 'ui.x'), custom])).join('\n'), /contient ui\.x/);
  });

  it('libellé manquant, ou qui n’est pas une clé de catalogue', () => {
    assert.match(validateSettingsSchema(block([{ id: 'x', type: 'toggle', path: 'a', default: false, label: '' }])).join('\n'), /libellé/);
    assert.match(validateSettingsSchema(block([{ id: 'x', type: 'toggle', path: 'a', default: false, label: 'Texte' }])).join('\n'), /libellé/);
  });
});

describe('outils', () => {
  it('valueAtPath', () => {
    assert.equal(valueAtPath({ a: { b: 1 } }, 'a.b'), 1);
    assert.equal(valueAtPath({ a: { b: 1 } }, 'a.c'), undefined);
    assert.equal(valueAtPath({ a: null }, 'a.b'), undefined);
  });

  it('fieldPaths : un chemin, ou ceux du bloc personnalisé', () => {
    assert.deepEqual(fieldPaths({ id: 'x', type: 'toggle', path: 'a.b', default: false, label: 'settings.bloc.x.label' }), ['a.b']);
    assert.deepEqual(fieldPaths({ id: 'x', type: 'custom', component: 'sources', paths: ['a', 'b'], label: 'settings.bloc.x.label' }), ['a', 'b']);
  });

  it('settingsTextKey', () => {
    assert.equal(settingsTextKey('home', 'clock', 'label'), 'settings.home.clock.label');
  });
});
