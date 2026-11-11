// Normalisation, migrations et fusion de la configuration (tests de caractérisation de P0-03, repris pour
// src/main/config/). Les fixtures gardent la forme `{ raw, changed }` de l'ancien `migrateConfig`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_VERSION, DEFAULT_CONFIG, DEFAULT_TV, MIGRATIONS, mergeConfig, migrate, normalizeConfig } from '../../src/main/config/index.ts';

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
    assert.deepEqual(c.ui.home, { clock: false, recent: false, bars: ['tv', 'games'], services: ['netflix'] });
    assert.deepEqual(c.gamesOpts, { autoOnline: true });
    assert.deepEqual(c.pcSites, raw.pcSites);
    assert.equal(c.tv.active, 'orange');
    assert.equal(c.tv.detected, true);
  });

  test('thème et position de menu inconnus : valeurs par défaut', () => {
    const c = normalizeConfig({ ui: { theme: 'fluo', start: 3, menu: { position: 'milieu', autohide: 'oui' } } });
    assert.equal(c.ui.theme, 'ecran');
    assert.equal(c.ui.start, 'home');
    assert.deepEqual(c.ui.menu, { position: 'left', autohide: false });
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
    assert.equal(c.gameBookmarks[0].console, 2);
    assert.equal(c.gameBookmarks[0].kind, 'torrent');
    assert.deepEqual(c.games, [{ path: '/jeu' }]);
    assert.deepEqual(c.emulators, [{ path: '/emu', sources: ['/roms'], romSites: [{ name: 'https://roms/', url: 'https://roms/', search: '' }] }]);
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

  for (let v = 1; v <= 5; v++) {
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
      [2, 3, 4, 5],
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
