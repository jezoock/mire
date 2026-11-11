// Schéma des réglages de @mire/shared (P1-26) : chemins, types de champ, doublons.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_FIELD_TYPES,
  SETTINGS_SCHEMA,
  fieldPaths,
  settingsPaths,
  settingsTextKey,
  validateSettingsSchema,
  valueAtPath,
} from '@mire/shared/settings/schema';
import type { SettingsSchema } from '@mire/shared/settings/schema';
import { DEFAULT_CONFIG } from '../../src/main/config/index.ts';

// Valeurs volontairement mal formées : le typage strict ne s'applique pas ici.
type Any = any;

describe('SETTINGS_SCHEMA', () => {
  it('est valide', () => {
    assert.deepEqual(validateSettingsSchema(SETTINGS_SCHEMA), []);
  });

  it('chaque chemin de config existe dans DEFAULT_CONFIG', () => {
    for (const p of settingsPaths()) assert.notEqual(valueAtPath(DEFAULT_CONFIG, p), undefined, p);
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
    for (const p of ['search.tmdbToken', 'search.region', 'adblock.enabled', 'ui.start', 'ui.home.clock', 'externalPlayer.path']) {
      assert.equal(paths.filter((x) => x === p).length, 1, p);
    }
  });
});

describe('validateSettingsSchema', () => {
  const block = (fields: Any[]): SettingsSchema => [{ id: 'bloc', title: 'Bloc', fields }];

  it('type de champ inconnu', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'couleur', path: 'a', default: '', label: 'X' }]));
    assert.match(errors.join('\n'), /type inconnu/);
  });

  it('valeur par défaut du mauvais type', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'toggle', path: 'a', default: 'oui', label: 'X' }]));
    assert.match(errors.join('\n'), /non booléenne/);
  });

  it('choix : valeur par défaut absente des options', () => {
    const options = [{ value: 'a', label: 'A' }];
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'choice', path: 'a', default: 'b', options, label: 'X' }]));
    assert.match(errors.join('\n'), /absente des options/);
  });

  it('composant inconnu', () => {
    const errors = validateSettingsSchema(block([{ id: 'x', type: 'custom', component: 'nope', paths: [], label: 'X' }]));
    assert.match(errors.join('\n'), /composant inconnu/);
  });

  it('chemin en double, ou contenu dans un autre', () => {
    const t = (id: string, path: string) => ({ id, type: 'toggle', path, default: false, label: id });
    assert.match(validateSettingsSchema(block([t('a', 'ui.x'), t('b', 'ui.x')])).join('\n'), /chemin en double : ui\.x/);
    const custom = { id: 'c', type: 'custom', component: 'sources', paths: ['ui'], label: 'C' };
    assert.match(validateSettingsSchema(block([t('a', 'ui.x'), custom])).join('\n'), /contient ui\.x/);
  });

  it('libellé manquant', () => {
    assert.match(validateSettingsSchema(block([{ id: 'x', type: 'toggle', path: 'a', default: false, label: '' }])).join('\n'), /libellé/);
  });
});

describe('outils', () => {
  it('valueAtPath', () => {
    assert.equal(valueAtPath({ a: { b: 1 } }, 'a.b'), 1);
    assert.equal(valueAtPath({ a: { b: 1 } }, 'a.c'), undefined);
    assert.equal(valueAtPath({ a: null }, 'a.b'), undefined);
  });

  it('fieldPaths : un chemin, ou ceux du bloc personnalisé', () => {
    assert.deepEqual(fieldPaths({ id: 'x', type: 'toggle', path: 'a.b', default: false, label: 'X' }), ['a.b']);
    assert.deepEqual(fieldPaths({ id: 'x', type: 'custom', component: 'sources', paths: ['a', 'b'], label: 'X' }), ['a', 'b']);
  });

  it('settingsTextKey', () => {
    assert.equal(settingsTextKey('home', 'clock', 'label'), 'settings.home.clock.label');
  });
});
