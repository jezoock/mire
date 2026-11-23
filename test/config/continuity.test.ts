// Continuité pour les installations existantes (P5-01) : migration v10 et table de règles. Les règles d'essai désignent
// un plugin inclus factice et un plugin à installer factice ; chaque tâche P5-xx ajoute ici le test de sa règle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION, mergeConfig, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { applyContinuity, checkRules, CONTINUITY_RULES, type ContinuityRule } from '../../src/main/config/migrations/continuity.ts';

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
  test('configuration v9 réelle : passe en v10 sans perte (table livrée)', () => {
    const v9 = readFixture('config-v9.json');
    const { config, from, changed } = migrate(structuredClone(v9));
    assert.equal(from, 9);
    assert.equal(changed, true);
    // Seule la file `continuity` s'ajoute (règles de la table livrée qui s'appliquent) : aucun réglage perdu.
    const { continuity, ...rest } = config as Any;
    assert.deepEqual(rest, { ...v9, version: CONFIG_VERSION });
    const { continuity: _queue, ...normalized } = normalizeConfig(config) as Any;
    // Normalisée, elle reste celle de la v9 (réglages des plugins compris, secret gardé).
    assert.deepEqual(normalized, { ...normalizeConfig(v9), version: CONFIG_VERSION });
    assert.ok(Array.isArray(continuity));
  });

  test('P5-04 : les trois profils de manettes, plugins inclus, pour toute installation existante', () => {
    const ids = ['P5-04-xbox', 'P5-04-playstation', 'P5-04-nintendo'];
    for (const raw of [readFixture('config-v9.json'), {}, { ui: 'mal formé' }]) {
      const { config } = migrate(structuredClone({ ...raw, version: 9 }));
      for (const id of ids) assert.ok((config as Any).continuity.includes(id), id);
    }
    const rules = CONTINUITY_RULES.filter((r) => ids.includes(r.id));
    assert.deepEqual(
      rules.map((r) => [r.plugin, r.mode, r.settings ?? []]),
      [
        ['mire.gamepad.xbox', 'bundled', []],
        ['mire.gamepad.playstation', 'bundled', []],
        ['mire.gamepad.nintendo', 'bundled', []],
      ],
    );
  });

  test('P5-07 : sites de jeux (selon la configuration) et jeux libres (toute installation), plugins à installer', () => {
    const rule = (id: string) => CONTINUITY_RULES.find((r) => r.id === id)!;
    assert.deepEqual([rule('P5-07-sites').plugin, rule('P5-07-sites').mode, rule('P5-07-sites').settings ?? []], ['mire.game-sites', 'install', []]);
    assert.deepEqual([rule('P5-07-libres').plugin, rule('P5-07-libres').mode, rule('P5-07-libres').settings ?? []], ['mire.free-games', 'install', []]);
    const queue = (raw: Any) => (migrate(structuredClone({ ...raw, version: 9 })).config as Any).continuity as string[];
    // Une console sans liste à elle prenait les sites proposés : le plugin des sites est mis en attente.
    assert.ok(queue({ emulators: [{ id: 'gb-1', name: 'GB' }] }).includes('P5-07-sites'));
    assert.ok(queue({ emulators: [{ id: 'a', romSites: [] }, { id: 'b' }] }).includes('P5-07-sites'));
    // Aucune console, ou que des consoles avec leur propre liste (même vide) : les sites proposés ne servaient pas.
    for (const emulators of [[], [{ id: 'a', romSites: [] }], [{ id: 'a', romSites: [{ name: 'X', url: 'https://x.example/' }] }], 'mal formé', [null, 4]]) {
      assert.ok(!queue({ emulators }).includes('P5-07-sites'), JSON.stringify(emulators));
    }
    assert.ok(!queue({}).includes('P5-07-sites'));
    // La configuration ne dit pas si la liste de jeux libres servait : toute installation existante, même mal formée.
    for (const raw of [readFixture('config-v9.json'), {}, { ui: 'mal formé' }]) assert.ok(queue(raw).includes('P5-07-libres'));
  });

  test('P5-03 : les sept pages prêtes à l’emploi, plugins inclus, pour toute installation existante', () => {
    const slugs = ['movies', 'series', 'music', 'images', 'streaming', 'tv', 'games'];
    for (const raw of [readFixture('config-v9.json'), {}, { ui: 'mal formé' }]) {
      const { config } = migrate(structuredClone({ ...raw, version: 9 }));
      for (const s of slugs) assert.ok((config as Any).continuity.includes(`P5-03-${s}`), s);
    }
    const rules = CONTINUITY_RULES.filter((r) => r.id.startsWith('P5-03-'));
    assert.deepEqual(
      rules.map((r) => [r.plugin, r.mode, r.settings ?? []]),
      slugs.map((s) => [`mire.page.${s}`, 'bundled', []]),
    );
  });

  test('P5-20 : les lecteurs externes, plugin inclus, pour toute installation existante ; le programme choisi reste', () => {
    for (const raw of [readFixture('config-v9.json'), {}, { externalPlayer: { path: '/usr/bin/vlc', args: [] } }, { externalPlayer: 'mal formé' }]) {
      const { config } = migrate(structuredClone({ ...raw, version: 9 }));
      assert.ok((config as Any).continuity.includes('P5-20'));
      assert.deepEqual((config as Any).externalPlayer, (raw as Any).externalPlayer);
    }
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-20');
    assert.deepEqual([rule?.plugin, rule?.mode, rule?.settings ?? []], ['mire.players.external', 'bundled', []]);
  });

  test('P5-02 : la palette choisie (Plein jour, Minuit, Velours) installe son plugin, réglage gardé', () => {
    const queue = (ui: unknown) => {
      const { config } = migrate({ version: 9, ui });
      return ((config as Any).continuity ?? []).filter((id: string) => id.startsWith('P5-02'));
    };
    assert.deepEqual(queue({ theme: 'jour' }), ['P5-02-jour']);
    // « Automatique » prenait Plein jour en mode clair.
    assert.deepEqual(queue({ theme: 'auto' }), ['P5-02-jour']);
    assert.deepEqual(queue({ theme: 'minuit' }), ['P5-02-minuit']);
    assert.deepEqual(queue({ theme: 'velours' }), ['P5-02-velours']);
    for (const ui of [{ theme: 'ecran' }, { theme: 'contraste' }, {}, 'mal formé', null, { theme: 3 }]) assert.deepEqual(queue(ui), [], JSON.stringify(ui));
    // Le réglage reste en place : la palette revient quand le plugin est installé.
    assert.equal((migrate({ version: 9, ui: { theme: 'minuit' } }).config as Any).ui.theme, 'minuit');
    const rules = CONTINUITY_RULES.filter((r) => r.id.startsWith('P5-02'));
    assert.deepEqual(
      rules.map((r) => [r.id, r.plugin, r.mode, r.settings ?? []]),
      [
        ['P5-02-jour', 'mire.palette.jour', 'install', []],
        ['P5-02-minuit', 'mire.palette.minuit', 'install', []],
        ['P5-02-velours', 'mire.palette.velours', 'install', []],
      ],
    );
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
    assert.equal(c.search.tmdbToken, '');
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

test.describe('services de streaming (P5-05)', () => {
  const SERVICES = [
    'netflix',
    'prime',
    'disney',
    'canal',
    'hbomax',
    'appletv',
    'paramount',
    'crunchyroll',
    'youtube',
    'francetv',
    'amazon-music',
    'spotify',
    'deezer',
  ];
  const site = (id: string) => ({ id, name: id, url: `https://${id}.example/`, mode: 'integrated', search: '' });
  const queue = (web: unknown) => (((migrate({ version: 9, web }).config as Any).continuity ?? []) as string[]).filter((id) => id.startsWith('P5-05'));

  test('un service configuré fait installer son plugin (à installer, réglages gardés dans la liste des sites)', () => {
    const rules = CONTINUITY_RULES.filter((r) => r.id.startsWith('P5-05'));
    assert.deepEqual(
      rules.map((r) => [r.id, r.plugin, r.mode, r.settings ?? []]),
      SERVICES.map((s) => [`P5-05-${s}`, `mire.web.${s}`, 'install', []]),
    );
    assert.deepEqual(queue([site('netflix'), site('spotify')]), ['P5-05-netflix', 'P5-05-spotify']);
    // Seuls les services en place : un site de l'utilisateur ou un service absent n'installe rien.
    assert.deepEqual(queue([site('arte'), site('deezer')]), ['P5-05-deezer']);
    for (const web of [[], undefined, 'mal formé', [null, 3, 'x']]) assert.deepEqual(queue(web), [], JSON.stringify(web));
  });

  test('le site reste dans `web`, avec son identifiant : sa connexion et ses réglages sont retrouvés', () => {
    const web = [{ ...site('netflix'), search: 'https://www.netflix.com/search?q={q}', color: '#E50914' }];
    const { config } = migrate({ version: 9, web: structuredClone(web) });
    assert.deepEqual((config as Any).web, web);
  });

  test('JustStream et Voir-Anime : pas de plugin, gardés comme sites ajoutés à la main, avec un message', () => {
    assert.deepEqual(queue([site('juststream'), site('voir-anime'), site('arte')]), ['P5-05-juststream', 'P5-05-voir-anime']);
    assert.deepEqual(queue([site('voir-anime')]), ['P5-05-voir-anime']);
    assert.deepEqual(queue([site('arte')]), []);
    const { config } = migrate({ version: 9, web: [site('juststream')] });
    assert.equal((config as Any).web[0].id, 'juststream');
    assert.equal((config as Any).web[0].app, undefined);
    assert.equal(
      CONTINUITY_RULES.some((r) => /juststream|voir-anime/.test(r.plugin)),
      false,
    );
  });
});
