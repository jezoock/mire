// Normalisation, migrations et fusion de la configuration (tests de caractérisation de P0-03, repris pour
// src/main/config/). Les fixtures gardent la forme `{ raw, changed }` de l'ancien `migrateConfig`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION, DEFAULT_CONFIG, DEFAULT_TV, MIGRATIONS, mergeConfig, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { createConfigService } from '../../src/main/config/service.ts';
import { homeRowsFromV8 } from '../../src/main/config/migrations/v9.ts';
import os from 'node:os';

// Valeurs volontairement mal formées : le typage strict ne s'applique pas ici.
type Any = any;

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');
const readFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const ID_RE = /^[0-9a-f]{10}$/;

test.describe('normalizeConfig', () => {
  test('config vide : valeurs par défaut', () => {
    for (const raw of [undefined, null, 'texte', {}]) {
      const c = normalizeConfig(raw);
      assert.equal(c.version, CONFIG_VERSION);
      assert.equal(c.ui.theme, 'ecran');
      assert.deepEqual(c.ui.menu, { position: 'left', autohide: false });
      assert.deepEqual(c.ui.home, DEFAULT_CONFIG.ui.home);
      assert.deepEqual(c.library, { sources: [] });
      assert.deepEqual(c.web, []);
      assert.deepEqual(c.tv, { services: DEFAULT_TV, active: '', detected: false });
    }
  });

  test('ne modifie pas DEFAULT_CONFIG', () => {
    const before = structuredClone(DEFAULT_CONFIG);
    const c = normalizeConfig({});
    (c.ui.home.bars as Any).push('x');
    c.tv.services[0].url = 'x';
    assert.deepEqual(DEFAULT_CONFIG, before);
  });

  test('config complète : valeurs conservées', () => {
    const raw: Any = {
      library: { sources: [{ id: 's1', kind: 'audio', location: ' /musique ' }] },
      gameSources: [{ id: 'g1', location: 'D:\\Jeux' }],
      web: [{ id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com', mode: 'browser', search: 'https://n/?q={q}' }],
      ui: {
        theme: 'minuit',
        backdrop: false,
        start: 'tv',
        menu: { position: 'bottom', autohide: true },
        home: { clock: false, recent: false, bars: ['tv', 'games'], services: ['netflix'] },
      },
      gamesOpts: { autoOnline: true },
      pcSites: [{ name: 'Site', url: 'https://jeux.example/', search: 'https://jeux.example/?q={q}' }],
      tv: { active: 'orange', detected: true },
    };
    const c = normalizeConfig(raw);
    assert.deepEqual(c.library.sources, [{ id: 's1', kind: 'audio', location: '/musique' }]);
    assert.deepEqual(c.gameSources, [{ id: 'g1', location: 'D:\\Jeux' }]);
    assert.deepEqual(c.web, [{ id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com', mode: 'browser', search: 'https://n/?q={q}' }]);
    assert.equal(c.ui.theme, 'minuit');
    assert.equal(c.ui.backdrop, false);
    assert.equal(c.ui.start, 'tv');
    assert.deepEqual(c.ui.menu, { position: 'bottom', autohide: true });
    assert.deepEqual(c.ui.home, {
      clock: false,
      recent: false,
      bars: ['tv', 'games'],
      services: ['netflix'],
      rows: [
        { kind: 'bars', targets: ['tv', 'games'] },
        { kind: 'sites', keys: ['web:netflix'] },
      ],
    });
    assert.deepEqual(c.gamesOpts, { autoOnline: true });
    assert.deepEqual(c.pcSites, raw.pcSites);
    assert.equal(c.tv.active, 'orange');
    assert.equal(c.tv.detected, true);
  });

  test('palette invalide et position de menu inconnue : valeurs par défaut', () => {
    const c = normalizeConfig({ ui: { theme: '../fluo', start: 3, menu: { position: 'milieu', autohide: 'oui' } } });
    assert.equal(c.ui.theme, 'ecran');
    assert.equal(c.ui.start, 'home');
    assert.deepEqual(c.ui.menu, { position: 'left', autohide: false });
  });

  test('palette (P5-02) : « auto » ou un identifiant, même inconnu (palette d’un plugin absent, gardée)', () => {
    for (const v of ['auto', 'ecran', 'contraste', 'jour', 'fluo-2']) assert.equal(normalizeConfig({ ui: { theme: v } }).ui.theme, v);
    for (const v of ['Jour', 'a b', '', 3, null, '../x']) assert.equal(normalizeConfig({ ui: { theme: v } }).ui.theme, 'ecran', String(v));
  });

  test('thème des pages (P4-11) : un identifiant, sinon le thème Mire', () => {
    assert.equal(normalizeConfig({}).ui.pageTheme, 'mire');
    assert.equal(normalizeConfig({ ui: { pageTheme: 'essai-papier' } }).ui.pageTheme, 'essai-papier');
    for (const v of ['../mire', 'Mire', 3, null]) assert.equal(normalizeConfig({ ui: { pageTheme: v } }).ui.pageTheme, 'mire');
  });

  test('accueil : barres inconnues, doublons et services absents retirés', () => {
    const c = normalizeConfig({
      web: [{ id: 'yt', url: 'https://youtube.com' }],
      ui: { home: { bars: ['tv', 'tv', 'inconnue'], services: ['yt', 'absent', 'yt'] } },
    });
    assert.deepEqual(c.ui.home.bars, ['tv']);
    assert.deepEqual(c.ui.home.services, ['yt']);
  });

  test('sources sans emplacement ou de type inconnu retirées, identifiant ajouté', () => {
    const c = normalizeConfig({
      library: {
        folders: ['/ancien'],
        sources: [{ kind: 'video', location: '/films' }, { kind: 'video', location: '  ' }, { kind: 'video' }, { kind: 'jeux', location: '/x' }, null, 'texte'],
      },
      gameSources: [{ location: '/jeux' }, { location: '' }, null],
    });
    assert.equal(c.library.sources.length, 1);
    assert.match(c.library.sources[0].id, ID_RE);
    assert.equal(c.library.sources[0].location, '/films');
    assert.equal('folders' in c.library, false);
    assert.equal(c.gameSources.length, 1);
    assert.equal(c.gameSources[0].location, '/jeux');
  });

  test('sites sans URL retirés, identifiant et mode complétés', () => {
    const c = normalizeConfig({
      web: [{ name: 'Sans adresse' }, { name: 'Mon Site', url: 'https://a/' }, { url: 'https://b/', mode: 'autre', search: 3 }, null],
    });
    assert.deepEqual(
      c.web.map((w) => [w.id, w.mode, w.search]),
      [
        ['mon-site', 'integrated', ''],
        ['site-1', 'integrated', ''],
      ],
    );
  });

  test('services TV de l’utilisateur fusionnés avec ceux par défaut', () => {
    const c = normalizeConfig({
      tv: {
        services: [
          { id: 'freebox', url: 'http://box/playlist.m3u', quality: 'sd' },
          { name: 'Ma Télé', url: 'https://tele.example/', kind: 'web' },
          { name: 'Sans adresse' },
        ],
        active: 'ma-tele',
      },
    });
    assert.deepEqual(
      c.tv.services.map((t) => t.id),
      [...DEFAULT_TV.map((t) => t.id), 'ma-tele'],
    );
    const fb = c.tv.services[0];
    assert.equal(fb.url, 'http://box/playlist.m3u');
    assert.equal(fb.quality, 'sd');
    assert.equal(fb.name, 'Freebox TV');
    assert.equal(fb.kind, 'playlist');
    assert.equal(c.tv.services.at(-1)?.kind, 'web');
    assert.equal(c.tv.active, 'ma-tele');
  });

  test('service TV actif inexistant : remis à vide', () => {
    assert.equal(normalizeConfig({ tv: { active: 'inconnu' } }).tv.active, '');
  });

  test('marque-pages, jeux et consoles nettoyés', () => {
    const c = normalizeConfig({
      bookmarks: [{ url: 'ftp://x' }, { url: 'https://site/film', type: 'tv', added: 1 }],
      gameBookmarks: [{ title: 'Sans source' }, { source: 'magnet:?x', kind: 'torrent', console: '2', added: 1 }],
      games: [{ name: 'Sans chemin' }, { path: '/jeu' }],
      emulators: [{ path: '/emu', sources: [' /roms ', '', 4], romSites: [{ url: 'ftp://x' }, { url: 'https://roms/' }] }, { name: 'Sans chemin' }],
      freebox: { playlist: 'x' },
    });
    assert.equal(c.bookmarks.length, 1);
    assert.equal(c.bookmarks[0].type, 'tv');
    assert.equal(c.gameBookmarks.length, 1);
    // Depuis la v6, la console est un identifiant : la normalisation ne la convertit plus en position.
    assert.equal(c.gameBookmarks[0].console, '2');
    assert.equal(c.gameBookmarks[0].kind, 'torrent');
    assert.deepEqual(c.games, [{ path: '/jeu' }]);
    assert.match(c.emulators[0].id, /^console-[0-9a-f]{6}$/);
    assert.deepEqual(c.emulators, [
      { path: '/emu', sources: ['/roms'], romSites: [{ name: 'https://roms/', url: 'https://roms/', search: '' }], id: c.emulators[0].id },
    ]);
    assert.equal('freebox' in c, false);
  });
});

test.describe('migrateConfig', () => {
  // Les identifiants des sources créées par la migration sont aléatoires : on les remplace pour comparer.
  const stableIds = (res: Any) => {
    for (const s of res.raw?.library?.sources || []) {
      if (ID_RE.test(s.id)) s.id = '<id>';
    }
    return res;
  };

  for (const v of [1, 2, 3, 4, 5, 8, 9]) {
    test(`version ${v} : résultat figé`, () => {
      const { config, from, changed } = migrate(readFixture(`config-v${v}.json`));
      assert.equal(from, v);
      assert.deepEqual(stableIds({ raw: config, changed }), readFixture(`config-v${v}.migrated.json`));
    });

    test(`version ${v} : normalizeConfig accepte le résultat`, () => {
      const c = normalizeConfig(migrate(readFixture(`config-v${v}.json`)).config);
      assert.equal(c.version, CONFIG_VERSION);
    });
  }

  test('valeur qui n’est pas un objet : rendue telle quelle', () => {
    assert.deepEqual(migrate(null), { config: null, from: null, changed: false });
    assert.deepEqual(migrate('x'), { config: 'x', from: null, changed: false });
  });

  test('registre : une étape par version, dans l’ordre, jusqu’à la version courante', () => {
    assert.deepEqual(
      MIGRATIONS.map((m) => m.version),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(MIGRATIONS.at(-1)?.version, CONFIG_VERSION);
  });

  test('G1 : les sites connus absents ne sont pas ajoutés, ceux présents sont complétés', () => {
    const { config } = migrate({ web: [{ id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/fr/', search: '' }] }) as Any;
    assert.equal(config.web.length, 1);
    assert.equal(config.web[0].search, 'https://www.deezer.com/search/{q}');
    assert.equal(config.web[0].background, true);
    assert.equal(config.web[0].group, 'music');
  });
});

test.describe('migration v9 (P2-11)', () => {
  const v8 = () => readFixture('config-v8.json');
  const migrated = () => migrate(v8()).config as Any;

  test('aucune donnée perdue : seuls la version, les rangées de l’accueil, la clé TMDB (P5-15) et la langue des fiches (plugins TMDB et Steam) changent', () => {
    const out = migrated();
    assert.deepEqual(out.ui.home.rows, [
      { kind: 'bars', targets: ['games', 'movies', 'series', 'screen:search', 'tv'] },
      { kind: 'sites', keys: ['web:netflix', 'web:arte'] },
      { kind: 'recent' },
    ]);
    delete out.ui.home.rows;
    // Clé TMDB et pays : réglages du plugin mire.tmdb (règle de continuité P5-15) ; langue des fiches copiée aussi
    // dans le réglage de mire.steam (des jeux PC, P5-16), qui la retire du cœur.
    assert.deepEqual(out.plugins, {
      'mire.tmdb': { token: { $secret: 'jeton-tmdb', encrypted: false }, region: 'be', language: 'en-US' },
      'mire.steam': { language: 'en-US' },
    });
    // File de la continuité (v10, P5-01) : celle des fixtures, TMDB (P5-15) et les services de streaming (P5-05) compris.
    assert.ok(out.continuity.includes('P5-15') && out.continuity.includes('P5-05-netflix'));
    assert.deepEqual(out.continuity, readFixture('config-v8.migrated.json').raw.continuity);
    delete out.plugins;
    delete out.continuity;
    const { tmdbToken: _token, region: _region, language: _language, ...search } = v8().search;
    // L'ordre choisi des fournisseurs suit TMDB dans son plugin.
    assert.deepEqual(out.catalog.metadataProviders, ['mire.tmdb/tmdb']);
    const catalog = { ...v8().catalog, metadataProviders: ['mire.tmdb/tmdb'] };
    assert.deepEqual(out, { ...v8(), search, catalog, version: CONFIG_VERSION });
  });

  test('l’interface historique retrouve ses réglages (accueil, menu, page de démarrage)', () => {
    const c = normalizeConfig(migrated());
    assert.deepEqual(c.ui.menu, { position: 'right', autohide: true });
    assert.equal(c.ui.start, 'music');
    assert.deepEqual(
      { clock: c.ui.home.clock, recent: c.ui.home.recent, bars: c.ui.home.bars, services: c.ui.home.services },
      { clock: false, recent: true, bars: ['games', 'videos', 'search', 'tv'], services: ['netflix', 'arte'] },
    );
  });

  test('une seule fois : une deuxième migration ne change rien', () => {
    const once = migrated();
    const again = migrate(structuredClone(once));
    assert.equal(again.changed, false);
    assert.deepEqual(again.config, once);
    // Des rangées déjà là (configuration écrite à la main en v8) ne sont pas remplacées.
    const own = { version: 8, ui: { home: { bars: ['tv'], rows: [{ kind: 'recent' }] } } };
    assert.deepEqual((migrate(own).config as Any).ui.home.rows, [{ kind: 'recent' }]);
  });

  test('accueil partiel ou absent : rangées tirées des valeurs par défaut de la v8', () => {
    assert.deepEqual((migrate({ version: 8, ui: { home: { recent: false } } }).config as Any).ui.home.rows, [DEFAULT_CONFIG.ui.home.rows[0]]);
    assert.deepEqual(normalizeConfig(migrate({ version: 8 }).config).ui.home.rows, DEFAULT_CONFIG.ui.home.rows);
    assert.deepEqual(homeRowsFromV8(DEFAULT_CONFIG.ui.home as Any), DEFAULT_CONFIG.ui.home.rows);
    // Un service dont le site n'existe plus n'était pas affiché : il ne devient pas un site épinglé.
    const gone = migrate({ version: 8, web: [{ id: 'a', url: 'https://a/' }], ui: { home: { bars: [], services: ['a', 'b'] } } }).config as Any;
    assert.deepEqual(gone.ui.home.rows, [{ kind: 'sites', keys: ['web:a'] }, { kind: 'recent' }]);
  });

  test('rangées : normalisées sans doublon ni cible invalide, les autres réglages de l’accueil n’y touchent pas', () => {
    const rows = [
      { kind: 'recent' },
      { kind: 'recent' },
      { kind: 'page', id: 'movies' },
      { kind: 'list', id: 'favorites' },
      { kind: 'page', id: 'movies' },
      { kind: 'sites', keys: ['web:x', 'x', 'web:x'] },
      { kind: 'bars', targets: ['tv', '', 3, 'list:a', 'screen:search', 'screen:inconnu', 'Films', 'web:x', 'tv'] },
      { kind: 'page', id: 'list:a' },
      { kind: 'list', id: 'Mauvais' },
      { kind: 'inconnue' },
      null,
    ];
    assert.deepEqual(normalizeConfig({ ui: { home: { bars: [], rows } } }).ui.home.rows, [
      { kind: 'recent' },
      { kind: 'page', id: 'movies' },
      { kind: 'list', id: 'favorites' },
      { kind: 'sites', keys: ['web:x'] },
      { kind: 'bars', targets: ['tv', 'list:a', 'screen:search'] },
    ]);
  });

  test('la configuration migrée se réimporte (« remplacer » et « compléter »)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-v9-'));
    try {
      const config = createConfigService({ file: path.join(dir, 'config.json'), log: () => {} });
      config.load();
      // Import « remplacer » d'un fichier v8, puis de son résultat (export d'une installation migrée).
      const replaced = config.replace(migrate(v8()).config);
      assert.deepEqual(replaced, normalizeConfig(migrated()));
      assert.deepEqual(config.replace(migrate(structuredClone(replaced)).config), replaced);
      // Relu depuis le disque : identique.
      const reread = createConfigService({ file: path.join(dir, 'config.json'), log: () => {} });
      assert.deepEqual(reread.load(), replaced);
      // « Compléter » avec le même fichier : rien en double.
      assert.deepEqual(config.replace(mergeConfig(config.get(), migrate(v8()).config)), replaced);
      // « Compléter » une installation neuve : sites, consoles, jeux et sources ajoutés ; ses réglages gardés.
      const fresh = normalizeConfig({});
      const merged = normalizeConfig(mergeConfig(fresh, migrated()));
      assert.deepEqual(
        merged.web.map((w) => w.id),
        ['netflix', 'arte', 'mon-site'],
      );
      assert.equal(merged.emulators.length, 1);
      assert.equal(merged.library.sources.length, 3);
      assert.deepEqual(merged.ui, fresh.ui);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('mergeConfig', () => {
  const current = (): Any => ({
    web: [{ id: 'a', url: 'https://a/' }],
    emulators: [{ path: '/emu/snes' }],
    games: [{ path: '/jeux/un' }],
    library: { sources: [{ id: '1', kind: 'video', location: '/films' }] },
    gameSources: [{ id: 'g', location: '/jeux' }],
    tv: { services: [{ id: 'freebox', url: 'http://box/' }] },
  });

  test('ajoute sans doublon ni suppression', () => {
    const incoming = {
      web: [{ id: 'a', url: 'https://autre/' }, { id: 'b', url: 'https://b/' }, { url: 'https://sans-id/' }],
      emulators: [{ path: '/emu/snes', name: 'doublon' }, { path: '/emu/nes' }, {}],
      games: [{ path: '/jeux/un' }, { path: '/jeux/deux' }],
      library: {
        sources: [
          { kind: 'video', location: '/films' },
          { kind: 'audio', location: '/films' },
          { kind: 'video', location: '' },
        ],
      },
      gameSources: [{ location: '/jeux' }, { location: '/autres-jeux' }],
      tv: {
        services: [
          { id: 'freebox', url: 'http://autre/' },
          { id: 'orange', url: 'http://o/' },
        ],
      },
    };
    const out = mergeConfig(current(), incoming);
    assert.deepEqual(
      out.web.map((w) => [w.id, w.url]),
      [
        ['a', 'https://a/'],
        ['b', 'https://b/'],
      ],
    );
    assert.deepEqual(
      out.emulators.map((e) => e.path),
      ['/emu/snes', '/emu/nes'],
    );
    assert.equal(out.emulators[0].name, undefined);
    assert.deepEqual(
      out.games.map((g) => g.path),
      ['/jeux/un', '/jeux/deux'],
    );
    assert.deepEqual(
      out.library.sources.map((x) => `${x.kind}:${x.location}`),
      ['video:/films', 'audio:/films'],
    );
    assert.deepEqual(
      out.gameSources.map((x) => x.location),
      ['/jeux', '/autres-jeux'],
    );
    assert.deepEqual(
      out.tv.services.map((t) => [t.id, t.url]),
      [
        ['freebox', 'http://box/'],
        ['orange', 'http://o/'],
      ],
    );
  });

  test('ne modifie pas la config actuelle ; fichier vide ou invalide sans effet', () => {
    const cur = current();
    const before = structuredClone(cur);
    mergeConfig(cur, { web: [{ id: 'z', url: 'https://z/' }] });
    assert.deepEqual(cur, before);
    assert.deepEqual(mergeConfig(cur, null), before);
    assert.deepEqual(mergeConfig(cur, { web: 'x', library: {} }), before);
  });
});
