// Listes de jeux déplacées de src/renderer/app.js vers src/renderer/domain/games.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS } from '@mire/shared';
import { allLocalGames, allRoms, gameSystems, pcGameEntries, SYSTEM_IDS } from '../../../src/renderer/domain/games.ts';
import type { Infos, Item } from '../../../src/renderer/domain/types.ts';

const none: Infos = { scrape: {}, meta: {} };
const pick = (list: Item[], ...keys: string[]) => list.map((g) => Object.fromEntries(keys.map((k) => [k, g[k]])));

describe('domain/games : SYSTEM_IDS', () => {
  it('reprend les identifiants libretro du référentiel, dans le même ordre que l’ancienne liste de l’interface', () => {
    assert.deepEqual(
      SYSTEM_IDS,
      SYSTEMS.map((s) => s.id),
    );
    assert.equal(SYSTEM_IDS.length, 22);
    assert.equal(SYSTEM_IDS[0], 'Nintendo - Nintendo Entertainment System');
    assert.equal(SYSTEM_IDS[21], 'SNK - Neo Geo Pocket Color');
  });
});

describe('domain/games : pcGameEntries', () => {
  it('jeux ajoutés à la main puis trouvés dans les dossiers, sans doublon, par ordre alphabétique', () => {
    const games = [
      { name: 'Zelda-like', path: 'C:/z.exe', args: ['-f'] },
      { name: 'alpha', path: 'C:/a.exe', image: 'C:/a.png' },
    ];
    const autoGames = [
      { name: 'Doublon', path: 'C:/a.exe' },
      { name: 'Beta', path: 'D:/b.exe', image: 'ignorée' },
    ];
    const out = pcGameEntries(games, autoGames, none);
    assert.deepEqual(pick(out, 'name', 'path', 'dir', 'kind', 'manualIndex', 'auto', 'image', 'args'), [
      { name: 'alpha', path: 'C:/a.exe', dir: 'C:/a.exe', kind: 'game', manualIndex: 1, auto: undefined, image: 'C:/a.png', args: undefined },
      { name: 'Beta', path: 'D:/b.exe', dir: 'D:/b.exe', kind: 'game', manualIndex: undefined, auto: true, image: null, args: undefined },
      { name: 'Zelda-like', path: 'C:/z.exe', dir: 'C:/z.exe', kind: 'game', manualIndex: 0, auto: undefined, image: null, args: ['-f'] },
    ]);
  });

  it('trie selon le titre récupéré', () => {
    const out = pcGameEntries(
      [
        { name: 'zz', path: '/z' },
        { name: 'mm', path: '/m' },
      ],
      [],
      { scrape: { 'g:zz': { title: 'Aaa' } }, meta: {} },
    );
    assert.deepEqual(
      out.map((g) => g.sTitle || g.name),
      ['Aaa', 'mm'],
    );
  });

  it('liste vide sans jeu', () => {
    assert.deepEqual(pcGameEntries([], [], none), []);
  });
});

describe('domain/games : allLocalGames', () => {
  const emulators = [
    { id: 'snes', name: 'Super Nintendo' },
    { id: 'gb', name: 'Game Boy' },
  ];

  it('jeux PC, jeux de console et marque-pages en attente, avec leur système', () => {
    const out = allLocalGames(
      {
        games: [{ name: 'Pc', path: '/pc' }],
        autoGames: [],
        emulators,
        localRoms: { snes: [{ name: 'Mario', displayName: 'Mario', path: '/r/mario.sfc' }], absente: [{ name: 'X', path: '/x' }] },
        gameBookmarks: [
          { id: 'b1', title: 'Attente PC', console: 'pc' },
          { id: 'b2', title: 'Attente GB', console: 'gb', source: 'site' },
          { id: 'b3', title: 'Attente inconnue', console: 'supprimee' },
          { id: 'b4', title: 'Attente sans console' },
          { id: 'b5', title: 'Fini', console: 'pc', done: true },
        ],
      },
      none,
    );
    assert.deepEqual(pick(out, 'name', 'kind', 'systemKey', 'systemName', 'consoleId'), [
      { name: 'Attente GB', kind: 'gamebm', systemKey: 'emu:gb', systemName: 'Game Boy', consoleId: undefined },
      { name: 'Attente inconnue', kind: 'gamebm', systemKey: 'emu:supprimee', systemName: 'Console', consoleId: undefined },
      { name: 'Attente PC', kind: 'gamebm', systemKey: 'pc', systemName: 'Jeux PC', consoleId: undefined },
      { name: 'Attente sans console', kind: 'gamebm', systemKey: 'pending', systemName: 'À télécharger', consoleId: undefined },
      { name: 'Mario', kind: 'rom', systemKey: 'emu:snes', systemName: 'Super Nintendo', consoleId: 'snes' },
      { name: 'Pc', kind: 'game', systemKey: 'pc', systemName: 'Jeux PC', consoleId: undefined },
    ]);
    const bm = out[0];
    assert.equal(bm.path, 'gbm:b2');
    assert.equal(bm.bookmarkId, 'b2');
    assert.equal(bm.dlSource, 'site');
    assert.equal(bm.pending, true);
  });

  it('applique les infos aux jeux de console et aux marque-pages', () => {
    const infos: Infos = { scrape: { 'r:/r/1.gb': { genre: 'Puzzle' }, 'b:b1': { title: 'Titre' } }, meta: {} };
    const out = allLocalGames(
      { games: [], autoGames: [], emulators, localRoms: { gb: [{ name: '1', path: '/r/1.gb' }] }, gameBookmarks: [{ id: 'b1', title: 'zz' }] },
      infos,
    );
    assert.deepEqual(pick(out, 'name', 'sTitle', 'sGenre'), [
      { name: '1', sTitle: undefined, sGenre: 'Puzzle' },
      { name: 'zz', sTitle: 'Titre', sGenre: '' },
    ]);
  });

  it('liste vide sans jeu ni marque-page', () => {
    assert.deepEqual(allLocalGames({ games: [], autoGames: [], emulators, localRoms: {} }, none), []);
  });
});

describe('domain/games : gameSystems', () => {
  it('jeux PC d’abord s’il y en a, puis chaque console même vide', () => {
    const all = [{ systemKey: 'pc' }, { systemKey: 'emu:gb' }, { systemKey: 'pc' }, { systemKey: 'pending' }];
    assert.deepEqual(
      gameSystems(all, [
        { id: 'snes', name: 'SNES' },
        { id: 'gb', name: 'GB' },
      ]),
      [
        { key: 'pc', name: 'Jeux PC', count: 2 },
        { key: 'emu:snes', name: 'SNES', count: 0, consoleId: 'snes' },
        { key: 'emu:gb', name: 'GB', count: 1, consoleId: 'gb' },
      ],
    );
  });

  it('sans jeu PC ni console : liste vide', () => {
    assert.deepEqual(gameSystems([{ systemKey: 'pending' }], []), []);
  });
});

describe('domain/games : allRoms', () => {
  it('jeux de chaque console, avec la console, dans l’ordre des consoles', () => {
    const out = allRoms(
      [
        { id: 'b', name: 'B' },
        { id: 'a', name: 'A' },
      ],
      { a: [{ name: 'a1' }], b: [{ name: 'b1' }, { name: 'b2' }], orpheline: [{ name: 'o' }] },
    );
    assert.deepEqual(out, [
      { name: 'b1', emu: 'b', emuName: 'B' },
      { name: 'b2', emu: 'b', emuName: 'B' },
      { name: 'a1', emu: 'a', emuName: 'A' },
    ]);
    assert.deepEqual(allRoms([{ id: 'x', name: 'X' }], {}), []);
  });
});
