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
  test('configuration v9 réelle : passe en v10, la clé TMDB change de place (P5-15), la langue des fiches part dans les plugins (P5-15, P5-16)', () => {
    const v9 = readFixture('config-v9.json');
    const { config, from, changed } = migrate(structuredClone(v9));
    assert.equal(from, 9);
    assert.equal(changed, true);
    const { tmdbToken: _t, region: _r, language: _l, ...search } = v9.search;
    const plugins = {
      ...v9.plugins,
      'mire.tmdb': { token: { $secret: 'jeton-tmdb', encrypted: false }, region: 'be', language: 'en-US' },
      'mire.steam': { language: 'en-US' },
    };
    const catalog = { ...v9.catalog, metadataProviders: ['mire.tmdb/tmdb'] };
    assert.deepEqual(config, {
      ...v9,
      search,
      plugins,
      catalog,
      continuity: readFixture('config-v9.migrated.json').raw.continuity,
      version: CONFIG_VERSION,
    });
    // Normalisée : réglages des autres plugins gardés, secret compris.
    const c = normalizeConfig(config);
    assert.deepEqual(c.plugins?.['org.exemple.films'], normalizeConfig(v9).plugins?.['org.exemple.films']);
    assert.deepEqual(c.continuity, readFixture('config-v9.migrated.json').raw.continuity);
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

  test('P5-11b : les sous-titres posés à côté des vidéos, plugin inclus, pour toute installation existante', () => {
    for (const raw of [readFixture('config-v9.json'), {}, { library: 'mal formé' }]) {
      const { config } = migrate(structuredClone({ ...raw, version: 9 }));
      assert.ok((config as Any).continuity.includes('P5-11b'));
    }
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-11b');
    assert.deepEqual([rule?.plugin, rule?.mode, rule?.settings ?? []], ['mire.subtitles', 'bundled', []]);
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

  test('P5-09 : les cinq tags automatiques, plugins inclus, pour toute installation existante ; aucun réglage', () => {
    const kinds = ['series', 'movies', 'music', 'consoles', 'photos'];
    for (const raw of [readFixture('config-v9.json'), {}, { catalog: 'mal formé' }]) {
      const { config } = migrate(structuredClone({ ...raw, version: 9 }));
      for (const k of kinds) assert.ok((config as Any).continuity.includes(`P5-09-${k}`), k);
      assert.equal((config as Any).plugins?.['mire.tags.series'], undefined);
    }
    const rules = CONTINUITY_RULES.filter((r) => r.id.startsWith('P5-09-'));
    assert.deepEqual(
      rules.map((r) => [r.plugin, r.mode, r.settings ?? []]),
      kinds.map((k) => [`mire.tags.${k}`, 'bundled', []]),
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
    assert.equal('tmdbToken' in (c as Any).search, false);
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
    const raw: Any = { version: 9, catalog: { metadataProviders: ['libretro', 'tmdb', 'mire.tmdb/tmdb', 3] } };
    // Sans clé TMDB, la règle P5-15 ne s'applique pas (seules celles des manettes, P5-04) ; l'ordre est renommé quand même.
    assert.equal(applyContinuity(raw).includes('P5-15'), false);
    assert.deepEqual(raw.catalog.metadataProviders, ['mire.libretro/libretro', 'mire.tmdb/tmdb', 3]);
    assert.equal(providerRenames().tmdb, 'mire.tmdb/tmdb');
    // Une règle ne peut renommer un fournisseur que vers un des siens.
    assert.match(checkRules([{ ...INSTALL, providers: { tmdb: 'org.tiers/infos' } }])[0], /must be renamed/);
    const untouched: Any = { version: 9, catalog: { metadataProviders: 'tmdb' } };
    applyContinuity(untouched);
    assert.equal(untouched.catalog.metadataProviders, 'tmdb');
  });

  test('P5-16 : MusicBrainz installé s’il y a de la musique dans la bibliothèque, rien à déplacer', () => {
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-16-musicbrainz')!;
    assert.deepEqual([rule.plugin, rule.mode, rule.settings], ['mire.musicbrainz', 'install', undefined]);
    const music = { kind: 'audio', id: 'm', location: '/Musique' };
    const raw: Any = { version: 9, library: { sources: [{ kind: 'video', id: 'v', location: '/Films' }, music] } };
    assert.deepEqual(applyContinuity(raw, [rule]), ['P5-16-musicbrainz']);
    assert.equal(raw.plugins, undefined);
    for (const library of [{ sources: [{ kind: 'video', location: '/Films' }] }, { sources: [] }, { sources: 'x' }, undefined, [music]]) {
      const none: Any = { version: 9, library };
      const before = structuredClone(none);
      assert.deepEqual(applyContinuity(none, [rule]), []);
      assert.deepEqual(none, before);
    }
  });

  test('P5-16 : libretro installé s’il y a une console dont le système est reconnu, rien à déplacer', () => {
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-16-libretro')!;
    assert.deepEqual([rule.plugin, rule.mode, rule.settings], ['mire.libretro', 'install', undefined]);
    for (const emu of [
      { id: 'snes', name: 'Snes9x', path: 'C:/Emu/snes9x.exe', extensions: ['.sfc'] },
      { id: 'x', name: 'Ma console', path: 'truc.exe', system: 'Nintendo - Game Boy' },
      { id: 'y', name: 'Ma console', path: 'truc.exe', extensions: ['.GBA'] },
    ]) {
      const raw: Any = { version: 9, emulators: [{ id: 'z', name: 'Inconnue', path: 'z.exe', extensions: ['.xyz'] }, emu] };
      assert.deepEqual(applyContinuity(raw, [rule]), ['P5-16-libretro'], emu.id);
      assert.equal(raw.plugins, undefined);
    }
    for (const emulators of [[], [{ id: 'z', name: 'Inconnue', path: 'z.exe', extensions: ['.xyz'] }], 'x', [3, null], undefined]) {
      const none: Any = { version: 9, emulators };
      const before = structuredClone(none);
      assert.deepEqual(applyContinuity(none, [rule]), []);
      assert.deepEqual(none, before);
    }
  });

  test('P5-16 : Steam installé s’il y a des jeux PC ; la langue des fiches part dans son réglage', () => {
    const rule = CONTINUITY_RULES.find((r) => r.id === 'P5-16-steam')!;
    assert.deepEqual([rule.plugin, rule.mode], ['mire.steam', 'install']);
    for (const config of [
      { games: [{ name: 'Hades', path: 'C:/Hades.exe' }] },
      { gameSources: [{ id: 's', location: 'D:/Jeux' }] },
      {
        gameBookmarks: [
          { id: 'b', console: 'snes' },
          { id: 'c', console: 'pc' },
        ],
      },
    ]) {
      const raw: Any = { version: 9, search: { language: ' nl-BE ' }, ...config };
      assert.deepEqual(applyContinuity(raw, [rule]), ['P5-16-steam']);
      assert.deepEqual(raw.plugins, { 'mire.steam': { language: 'nl-BE' } });
      // Le réglage quitte le cœur.
      assert.deepEqual(raw.search, {});
    }
    const auto: Any = { version: 9, search: { language: '' }, games: [{ name: 'Ys' }] };
    applyContinuity(auto, [rule]);
    assert.deepEqual(auto.plugins['mire.steam'], { language: 'auto' });
    for (const config of [{}, { games: [] }, { gameSources: 'x' }, { gameBookmarks: [{ console: 'snes' }] }]) {
      const none: Any = { version: 9, search: { language: 'fr-FR' }, ...config };
      const before = structuredClone(none);
      assert.deepEqual(applyContinuity(none, [rule]), []);
      assert.deepEqual(none, before);
    }
  });

  test('P5-15 puis P5-16 : TMDB et Steam reprennent chacun la langue des fiches', () => {
    const raw: Any = { version: 9, search: { tmdbToken: 'k', language: 'en-GB' }, games: [{ name: 'Ys' }] };
    const applied = applyContinuity(
      raw,
      CONTINUITY_RULES.filter((r) => r.id === 'P5-15' || r.id === 'P5-16-steam'),
    );
    assert.deepEqual(applied, ['P5-15', 'P5-16-steam']);
    assert.equal(raw.plugins['mire.tmdb'].language, 'en-GB');
    assert.deepEqual(raw.plugins['mire.steam'], { language: 'en-GB' });
  });

  test('fournisseurs renommés (P5-16) : ordre choisi gardé pour toute configuration, fiches reprises sous le nouveau nom', () => {
    const raw: Any = { version: 9, catalog: { metadataProviders: ['steam', 'libretro', 'musicbrainz', 'tmdb'] } };
    const applied = applyContinuity(raw);
    assert.equal(
      applied.some((id) => id.startsWith('P5-16')),
      false,
    );
    assert.deepEqual(raw.catalog.metadataProviders, ['mire.steam/steam', 'mire.libretro/libretro', 'mire.musicbrainz/musicbrainz', 'mire.tmdb/tmdb']);
    assert.deepEqual(providerRenames(), {
      tmdb: 'mire.tmdb/tmdb',
      musicbrainz: 'mire.musicbrainz/musicbrainz',
      libretro: 'mire.libretro/libretro',
      steam: 'mire.steam/steam',
    });
    assert.deepEqual(checkRules(CONTINUITY_RULES), []);
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
