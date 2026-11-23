// Packs de données (P5-07) : lecture des packs `romSites` et `freeGames` des plugins actifs, avec un plugin factice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContributionRegistry, type ContributionEntry } from '../../src/main/plugins/registry.ts';
import {
  checkHttpsUrl,
  checkText,
  freeGamesOf,
  MAX_GAMES,
  MAX_SITES_PER_SYSTEM,
  readFreeGamesPack,
  readRomSitesPack,
  romSitesFor,
} from '../../src/main/plugins/packs.ts';
import { consoleSites } from '../../src/main/web/entries.ts';
import { createStore } from '../../src/main/store/index.ts';
import { pluginTextPrefix } from '../../src/main/plugins/service.ts';

type Any = any;
// Les sites sont rangés dans un objet sans prototype : on le compare comme un objet simple.
const plain = (o: object) => ({ ...o });
const pack = (pluginId: string, id: string, data: unknown): ContributionEntry => ({
  pluginId,
  kind: 'packs',
  id,
  declaration: { id, file: `packs/${id}.json` },
  data,
});

const SYS = 'Nintendo - Game Boy';
const site = { name: 'PDRoms', url: 'https://pdroms.example/gb/', search: 'https://pdroms.example/?s={q}' };
const game = {
  id: 'nova',
  name: 'Nova',
  system: 'nes',
  author: 'Auteur',
  url: 'https://github.com/x/y/releases/latest/download/nova.nes',
  file: 'Nova.nes',
  desc: 'freeGames.nova.desc',
};

test.describe('packs romSites', () => {
  test('lit les sites par système', () => {
    const data = { kind: 'romSites', systems: { [SYS]: [site, { name: 'Sans recherche', url: 'https://x.example/' }] } };
    assert.deepEqual(readRomSitesPack(data)[SYS], [site, { name: 'Sans recherche', url: 'https://x.example/', search: '' }]);
  });

  test('adresses refusées : tout sauf https, identifiants, espaces', () => {
    for (const url of [
      'http://x.example/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,x',
      'ftp://x.example/',
      'https://u:p@x.example/',
      'https:// x.example',
      'media://x',
      '',
      42,
      null,
      'https://' + 'a'.repeat(600) + '.example',
    ]) {
      assert.equal(checkHttpsUrl(url), null, String(url));
      assert.deepEqual(plain(readRomSitesPack({ kind: 'romSites', systems: { [SYS]: [{ name: 'X', url }] } })), {}, String(url));
    }
    // Adresse de recherche refusée : le site reste, sans recherche.
    const r = readRomSitesPack({ kind: 'romSites', systems: { [SYS]: [{ name: 'X', url: 'https://x.example/', search: 'http://x.example/?q={q}' }] } });
    assert.equal(r[SYS][0].search, '');
    assert.equal(
      readRomSitesPack({ kind: 'romSites', systems: { [SYS]: [{ name: 'X', url: 'https://x.example/', search: 'https://x.example/?q=1' }] } })[SYS][0].search,
      '',
    );
  });

  test('textes : jamais de balises ni de caractères de contrôle', () => {
    for (const name of ['<img src=x onerror=alert(1)>', 'a<b', 'a\u0000b', 'a‮b', '', '   ', 'x'.repeat(200), 5])
      assert.equal(checkText(name), null, String(name));
    assert.equal(checkText('  Homebrew Hub  '), 'Homebrew Hub');
  });

  test('forme mal formée : rien, sans exception', () => {
    for (const d of [
      null,
      'x',
      [],
      {},
      { kind: 'freeGames' },
      { kind: 'romSites' },
      { kind: 'romSites', systems: [] },
      { kind: 'romSites', systems: { [SYS]: 'x' } },
      { kind: 'romSites', systems: { '<b>': [site] } },
    ]) {
      assert.deepEqual(plain(readRomSitesPack(d)), {});
    }
    assert.deepEqual(plain(readRomSitesPack(JSON.parse('{"kind":"romSites","systems":{"__proto__":[{"name":"X","url":"https://x.example/"}]}}'))), {});
  });

  test('bornes : nombre de sites par système', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, url: `https://x${i}.example/` }));
    assert.equal(readRomSitesPack({ kind: 'romSites', systems: { [SYS]: many } })[SYS].length, MAX_SITES_PER_SYSTEM);
  });

  test('plugins actifs : ordre d’activation, une adresse une seule fois, autres natures ignorées', () => {
    const reg = createContributionRegistry();
    reg.set('mire.a', [pack('mire.a', 'a', { kind: 'romSites', systems: { [SYS]: [site] } })]);
    reg.set('mire.b', [
      pack('mire.b', 'b', { kind: 'romSites', systems: { [SYS]: [site, { name: 'B', url: 'https://b.example/' }] } }),
      { ...pack('mire.b', 'c', { kind: 'romSites', systems: { [SYS]: [{ name: 'Z', url: 'https://z.example/' }] } }), kind: 'pages' },
    ]);
    assert.deepEqual(
      romSitesFor(reg.list('packs'), SYS).map((s) => s.name),
      ['PDRoms', 'B'],
    );
    assert.deepEqual(romSitesFor(reg.list('packs'), 'Autre'), []);
    assert.deepEqual(romSitesFor(reg.list('packs'), '__proto__'), []);
    reg.remove('mire.a');
    reg.remove('mire.b');
    assert.deepEqual(romSitesFor(reg.list('packs'), SYS), []);
  });

  test('absence de plugin : la console garde sa liste ou n’a aucun site (l’écran reste utilisable)', () => {
    const none = { defaultRomSites: () => [], guessSystem: () => SYS };
    const config: Any = {
      emulators: [
        { id: 'gb-1', name: 'GB' },
        { id: 'gb-2', name: 'GB2', romSites: [{ name: 'Mien', url: 'https://mien.example/' }] },
      ],
      pcSites: [],
    };
    assert.deepEqual(consoleSites(config, 'gb-1', none), []);
    assert.deepEqual(consoleSites(config, 'gb-2', none), [{ name: 'Mien', url: 'https://mien.example/' }]);
    const reg = createContributionRegistry();
    reg.set('mire.a', [pack('mire.a', 'a', { kind: 'romSites', systems: { [SYS]: [site] } })]);
    assert.deepEqual(consoleSites(config, 'gb-1', { ...none, defaultRomSites: (s) => romSitesFor(reg.list('packs'), s) }), [site]);
  });
});

test.describe('packs freeGames', () => {
  const entry = pack('mire.free-games', 'free', {
    kind: 'freeGames',
    games: [game, { ...game, id: 'jeu2', name: 'Deux', basedOn: 'Original', file: 'Deux.nes' }],
  });

  test('lit les jeux, texte du plugin désigné par sa clé complète', () => {
    const games = readFreeGamesPack(entry);
    assert.equal(games.length, 2);
    assert.equal(games[0].descKey, `${pluginTextPrefix('mire.free-games')}freeGames.nova.desc`);
    assert.equal(games[1].basedOn, 'Original');
    assert.equal('desc' in games[0], false);
  });

  test('refuse adresse non https, nom de fichier avec chemin, identifiant ou système mal formé', () => {
    const bad = [
      { url: 'http://x.example/a.nes' },
      { url: 'file:///a.nes' },
      { file: '../evil.nes' },
      { file: 'a/b.nes' },
      { file: 'a\\b.nes' },
      { file: '.hidden.nes' },
      { file: 'sans-extension' },
      { id: '../x' },
      { id: 'A' },
      { system: '../nes' },
      { name: '<b>x</b>' },
      { author: '' },
      { basedOn: '<i>' },
    ];
    for (const b of bad) assert.deepEqual(readFreeGamesPack(pack('mire.x', 'x', { kind: 'freeGames', games: [{ ...game, ...b }] })), [], JSON.stringify(b));
    // Clé de texte invalide : le jeu reste, sans description.
    const g = readFreeGamesPack(pack('mire.x', 'x', { kind: 'freeGames', games: [{ ...game, desc: '../a b' }] }));
    assert.equal(g.length, 1);
    assert.equal(g[0].descKey, undefined);
  });

  test('forme mal formée et bornes', () => {
    for (const d of [null, 'x', {}, { kind: 'romSites', games: [game] }, { kind: 'freeGames', games: 'x' }])
      assert.deepEqual(readFreeGamesPack(pack('mire.x', 'x', d)), []);
    const many = Array.from({ length: 200 }, (_, i) => ({ ...game, id: `j${i}` }));
    assert.equal(readFreeGamesPack(pack('mire.x', 'x', { kind: 'freeGames', games: many })).length, MAX_GAMES);
  });

  test('plugins actifs : le premier activé l’emporte à identifiant égal', () => {
    const reg = createContributionRegistry();
    reg.set('mire.a', [pack('mire.a', 'a', { kind: 'freeGames', games: [game] })]);
    reg.set('mire.b', [
      pack('mire.b', 'b', {
        kind: 'freeGames',
        games: [
          { ...game, name: 'Autre' },
          { ...game, id: 'jeu2' },
        ],
      }),
    ]);
    assert.deepEqual(
      freeGamesOf(reg.list('packs')).map((g) => [g.id, g.name]),
      [
        ['nova', 'Nova'],
        ['jeu2', 'Nova'],
      ],
    );
  });

  test('boutique : sans plugin, aucun jeu libre et téléchargement refusé ; avec plugin, la liste vient du pack', async () => {
    const mk = (freeGames?: () => ReturnType<typeof freeGamesOf>) =>
      createStore({
        dataDir: '/tmp/mire-p507-inexistant',
        defaultRomsRoot: '/tmp/mire-p507-roms',
        getConfig: () => ({ emulators: [] }),
        saveConfig: () => {},
        onProgress: () => {},
        extract: async () => {},
        freeGames,
      });
    const empty = await mk().catalog();
    assert.deepEqual(empty.games, []);
    assert.equal((await mk().getGame('nova')).ok, false);
    const full = await mk(() => readFreeGamesPack(entry)).catalog();
    assert.deepEqual(
      full.games.map((g: Any) => g.id),
      ['nova', 'jeu2'],
    );
    assert.equal(full.games[0].ready, false);
  });
});
