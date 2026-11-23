// Continuité pour les installations existantes (P5-01) : migration v10 et table de règles. Les règles d'essai désignent
// un plugin inclus factice et un plugin à installer factice ; chaque tâche P5-xx ajoute ici le test de sa règle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION, mergeConfig, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { applyContinuity, checkRules, CONTINUITY_RULES, providerRenames, type ContinuityRule } from '../../src/main/config/migrations/continuity.ts';

// Valeurs volontairement mal formées : le typage strict ne s'applique pas ici.
type Any = any;

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');
const readFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

/** Plugin inclus factice : les lecteurs externes (un lecteur choisi). */
const BUNDLED: ContinuityRule = {
  id: 'P5-test-inclus',
  plugin: 'mire.essai.lecteurs',
  mode: 'bundled',
  applies: (c) => typeof c.externalPlayer?.path === 'string' && c.externalPlayer.path !== '',
  settings: [
    { from: 'externalPlayer.path', to: 'path' },
    { from: 'externalPlayer.args', to: 'args' },
  ],
};
/** Plugin à installer factice : les infos en ligne (une clé saisie). */
const INSTALL: ContinuityRule = {
  id: 'P5-test-installer',
  plugin: 'mire.essai.infos',
  mode: 'install',
  applies: (c) => typeof c.search?.tmdbToken === 'string' && c.search.tmdbToken !== '',
  settings: [
    { from: 'search.tmdbToken', to: 'token', secret: true },
    { from: 'search.region', to: 'region' },
  ],
};
const RULES = [BUNDLED, INSTALL];

test.describe('migration v10 (P5-01)', () => {
  test('configuration v9 réelle : passe en v10, seule la clé TMDB change de place (règle P5-15)', () => {
    const v9 = readFixture('config-v9.json');
    const { config, from, changed } = migrate(structuredClone(v9));
    assert.equal(from, 9);
    assert.equal(changed, true);
    const { tmdbToken: _t, region: _r, ...search } = v9.search;
    const plugins = { ...v9.plugins, 'mire.tmdb': { token: { $secret: 'jeton-tmdb', encrypted: false }, region: 'be', language: 'en-US' } };
    const catalog = { ...v9.catalog, metadataProviders: ['mire.tmdb/tmdb'] };
    assert.deepEqual(config, { ...v9, search, plugins, catalog, continuity: ['P5-15'], version: CONFIG_VERSION });
    // Normalisée : réglages des autres plugins gardés, secret compris.
    const c = normalizeConfig(config);
    assert.deepEqual(c.plugins?.['org.exemple.films'], normalizeConfig(v9).plugins?.['org.exemple.films']);
    assert.deepEqual(c.continuity, ['P5-15']);
  });

  test('table livrée : chaque règle désigne un plugin du dépôt officiel', () => {
    assert.deepEqual(checkRules(CONTINUITY_RULES), []);
    assert.deepEqual(checkRules(RULES), []);
    const bad = checkRules([
      { ...INSTALL, plugin: 'org.tiers.infos' },
      { ...BUNDLED, id: 'P5 test' },
      { ...BUNDLED, id: 'P5 test' },
      { ...BUNDLED, mode: 'autre' as Any },
    ]);
    assert.equal(bad.length, 5);
    assert.match(bad[0], /official repository/);
  });

  test('règles : réglages déplacés sous plugins.<id>, règles notées dans continuity', () => {
    const raw: Any = readFixture('config-v9.json');
    const applied = applyContinuity(raw, RULES);
    assert.deepEqual(applied, ['P5-test-inclus', 'P5-test-installer']);
    assert.deepEqual(raw.continuity, applied);
    assert.deepEqual(raw.plugins['mire.essai.lecteurs'], { path: '/usr/bin/vlc', args: ['--fullscreen'] });
    assert.deepEqual(raw.plugins['mire.essai.infos'], { token: { $secret: 'jeton-tmdb', encrypted: false }, region: 'BE' });
    assert.deepEqual(raw.externalPlayer, {});
    assert.equal('tmdbToken' in raw.search, false);
    // Les réglages des autres plugins ne bougent pas.
    assert.deepEqual(raw.plugins['org.exemple.films'], readFixture('config-v9.json').plugins['org.exemple.films']);
    // La normalisation garde la file et les réglages déplacés ; les anciens emplacements reprennent leur valeur par défaut.
    const c = normalizeConfig(raw);
    assert.deepEqual(c.continuity, applied);
    assert.deepEqual(c.plugins?.['mire.essai.infos'], { token: { $secret: 'jeton-tmdb', encrypted: false }, region: 'BE' });
    assert.equal('tmdbToken' in c.search, false);
  });

  test('règle qui ne s’applique pas : rien ne bouge', () => {
    const raw: Any = readFixture('config-v9.json');
    raw.search.tmdbToken = '';
    const before = structuredClone(raw);
    assert.deepEqual(applyContinuity(raw, [INSTALL]), []);
    assert.deepEqual(raw, before);
    // Configuration mal formée que la règle n'a pas prévue : ignorée sans erreur.
    const thrower: ContinuityRule = { ...INSTALL, applies: (c) => c.absent.profond === 1 };
    assert.deepEqual(applyContinuity({ version: 9 }, [thrower]), []);
  });

  test('aucune perte : valeur mal formée laissée en place, réglage déjà présent gardé', () => {
    const raw: Any = { version: 9, search: { tmdbToken: 'abc', region: { pays: 'FR' } }, plugins: { 'mire.essai.infos': { token: 'déjà' } } };
    applyContinuity(raw, [INSTALL]);
    assert.deepEqual(raw.search, { region: { pays: 'FR' } });
    assert.deepEqual(raw.plugins['mire.essai.infos'], { token: 'déjà' });
    // Section plugins mal formée : remplacée par une section valide.
    const odd: Any = { version: 9, search: { tmdbToken: 'abc' }, plugins: ['x'] };
    applyContinuity(odd, [INSTALL]);
    assert.deepEqual(odd.plugins, { 'mire.essai.infos': { token: { $secret: 'abc', encrypted: false } } });
  });

  test('rejouée : rien de plus (file sans doublon, réglages non écrasés)', () => {
    const raw: Any = { version: 9, externalPlayer: { path: '/vlc', args: [] }, continuity: ['P5-test-inclus', 'mauvais id', 3] };
    applyContinuity(raw, RULES);
    const once = structuredClone(raw);
    assert.deepEqual(once.continuity, ['P5-test-inclus']);
    applyContinuity(raw, RULES);
    assert.deepEqual(raw, once);
    // Une configuration déjà en v10 n'est pas migrée de nouveau.
    const again = migrate(structuredClone({ ...once, version: CONFIG_VERSION }));
    assert.equal(again.changed, false);
  });

  test('P5-15 : clé TMDB → secret du plugin mire.tmdb (à installer), pays et langue des fiches repris', () => {
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-15')!;
    assert.equal(rule.plugin, 'mire.tmdb');
    assert.equal(rule.mode, 'install');
    const raw: Any = { version: 9, search: { tmdbToken: '  cle-courte  ', region: 'CH', language: '' } };
    assert.deepEqual(applyContinuity(raw, [rule]), ['P5-15']);
    assert.deepEqual(raw.plugins['mire.tmdb'], { token: { $secret: 'cle-courte', encrypted: false }, region: 'ch', language: 'auto' });
    // La langue des fiches sert encore au cœur (Steam) : copiée, pas déplacée.
    assert.deepEqual(raw.search, { language: '' });
    assert.deepEqual(raw.continuity, ['P5-15']);
    // Normalisée, la clé reste un secret (jamais rendu à l'interface).
    assert.deepEqual(normalizeConfig(raw).plugins?.['mire.tmdb']?.token, { $secret: 'cle-courte', encrypted: false });
  });

  test('P5-15 : sans clé TMDB (vide, absente, mal formée), rien n’est installé ni déplacé', () => {
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-15')!;
    for (const search of [{ tmdbToken: '', region: 'BE' }, { tmdbToken: '   ' }, { region: 'FR' }, { tmdbToken: 42 }, 'x', undefined]) {
      const raw: Any = { version: 9, search };
      const before = structuredClone(raw);
      assert.deepEqual(applyContinuity(raw, [rule]), []);
      assert.deepEqual(raw, before);
    }
  });

  test('fournisseurs renommés (P5-15) : l’ordre choisi suit TMDB dans son plugin, même sans clé', () => {
    const raw: Any = { version: 9, catalog: { metadataProviders: ['steam', 'tmdb', 'mire.tmdb/tmdb', 3] } };
    assert.deepEqual(applyContinuity(raw), []);
    assert.deepEqual(raw.catalog.metadataProviders, ['steam', 'mire.tmdb/tmdb', 3]);
    assert.deepEqual(providerRenames(), { tmdb: 'mire.tmdb/tmdb' });
    // Une règle ne peut renommer un fournisseur que vers un des siens.
    assert.match(checkRules([{ ...INSTALL, providers: { tmdb: 'org.tiers/infos' } }])[0], /must be renamed/);
    const untouched: Any = { version: 9, catalog: { metadataProviders: 'tmdb' } };
    applyContinuity(untouched);
    assert.equal(untouched.catalog.metadataProviders, 'tmdb');
  });

  test('convert et keep : valeur traduite, copiée ou laissée en place si elle ne se traduit pas', () => {
    const rule: ContinuityRule = {
      ...INSTALL,
      settings: [
        { from: 'search.tmdbToken', to: 'token', secret: true },
        { from: 'search.region', to: 'region', convert: () => undefined },
        { from: 'search.language', to: 'language', keep: true, convert: (v) => `${v}!` },
      ],
    };
    const raw: Any = { version: 9, search: { tmdbToken: 'k', region: 'FR', language: 'fr-FR' } };
    applyContinuity(raw, [rule]);
    assert.deepEqual(raw.search, { region: 'FR', language: 'fr-FR' });
    assert.deepEqual(raw.plugins['mire.essai.infos'], { token: { $secret: 'k', encrypted: false }, language: 'fr-FR!' });
  });

  test('file normalisée : identifiants de règles seulement, absente quand elle est vide', () => {
    assert.deepEqual(normalizeConfig({ continuity: ['P5-15', 'P5-15', '../x', 42, ''] }).continuity, ['P5-15']);
    assert.equal('continuity' in normalizeConfig({ continuity: [] }), false);
    assert.equal('continuity' in normalizeConfig({ continuity: 'P5-15' }), false);
  });

  test('import « compléter » d’un fichier ancien : ses règles rejoignent la file', () => {
    const merged = mergeConfig({ ...normalizeConfig({}), continuity: ['P5-a'] }, { continuity: ['P5-b', 'P5-a', 'x y'] });
    assert.deepEqual(merged.continuity, ['P5-a', 'P5-b']);
    assert.equal('continuity' in mergeConfig(normalizeConfig({}), {}), false);
  });
});
