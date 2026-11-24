// Jeux → éléments (P2-03) : jeux de console, jeux ajoutés à la main, marque-pages de jeux. Jeux PC des dossiers
// (P5-13) et jeux des dossiers locaux d'une console (P5-14a) : trouvés par la source d'un plugin (factice ici), lus du
// catalogue par l'interface historique ; plugin désactivé puis réactivé ; continuité des éléments rangés par le cœur.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, Emulator, GameBookmark } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { gameBookmarkKey, pcGameKey, romKey } from '../../src/main/catalog/keys.ts';
import { syncFeeds } from '../../src/main/catalog/sync.ts';
import { gameBookmarkElement, gameConfigFeed, manualGameElement, romInstance } from '../../src/main/games/element-sources.ts';
import { createGames } from '../../src/main/games/index.ts';
import { gameLocationKey } from '../../src/main/games/pc/locations.ts';
import { romLocationKey } from '../../src/main/games/roms/locations.ts';
import type { GamesDeps } from '../../src/main/games/types.ts';

const P = process.platform;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-games-elements-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const at = (...parts: string[]) => path.join(root, ...parts);
function touch(rel: string, text = '') {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), text);
}

// Console : deux jeux, un jeu sur deux disques (liste .m3u qui cite ses .cue), une jaquette.
touch('snes/Zelda (France).sfc');
touch('snes/Mario Kart (Europe).sfc');
touch('snes/Multi/Jeu (Disc 1).cue');
touch('snes/Multi/Jeu (Disc 2).cue');
touch('snes/Multi/Jeu.m3u', 'Jeu (Disc 1).cue\nJeu (Disc 2).cue\n');
touch('images/Zelda (France).png');
touch('extra/Metroid.sfc');
// Dossier de jeux PC (ses jeux viennent de la source factice d'un plugin).
touch('pc/Celeste/Celeste.exe');

const SNES: Emulator = {
  id: 'snes-1',
  name: 'Super Nintendo',
  path: '/emu',
  sources: [at('extra'), at('absent')],
  romsDir: at('snes'),
  imagesDir: at('images'),
  extensions: ['.sfc', '.m3u', '.cue'],
} as Emulator;

/** Pont des sources factice : le plugin `mire.games.test` lit les dossiers de jeux tant qu'il est actif. */
const PLUGIN = 'mire.games.test';
function fakeFolders(catalog: ReturnType<typeof createCatalog>, active: { on: boolean }) {
  const key = gameLocationKey(at('pc'), P);
  const games = [
    {
      key: pcGameKey(at('pc', 'Tetris.exe'), P),
      name: 'Tetris',
      open: { kind: 'program' as const, path: at('pc', 'Tetris.exe') },
      tags: ['game'],
      infos: {},
      images: {},
    },
    {
      key: pcGameKey(at('pc', 'Celeste', 'Celeste.exe'), P),
      name: 'Celeste',
      open: { kind: 'program' as const, path: at('pc', 'Celeste', 'Celeste.exe') },
      tags: ['game'],
      infos: {},
      images: {},
    },
  ];
  let rescans = 0;
  return {
    get rescans() {
      return rescans;
    },
    rescan: async () => {
      rescans++;
      if (active.on) catalog.setSource({ plugin: PLUGIN, instance: key }, games);
      else catalog.removeSource({ plugin: PLUGIN, instance: key });
    },
    claimed: (k: string) => active.on && k === key,
    catalog,
  };
}

/** Source factice d'un plugin de consoles (`mire.games.roms.test`) : ce que rendrait `mire.games.roms` pour SNES. */
const ROM_PLUGIN = 'mire.games.roms.test';
function fakeRomFolders(catalog: ReturnType<typeof createCatalog>, active: { on: boolean }) {
  const game = (rel: string, name: string, poster?: string) => ({
    key: romKey('snes-1', at(rel), P),
    name,
    open: { kind: 'game' as const, console: 'snes-1', path: at(rel) },
    tags: ['game'],
    infos: { system: 'Nintendo - Super Nintendo Entertainment System' },
    images: poster ? { poster } : {},
  });
  const byKey = new Map([
    [
      romLocationKey('snes-1', at('snes'), P),
      [
        game('snes/Zelda (France).sfc', 'Zelda', at('images', 'Zelda (France).png')),
        game('snes/Mario Kart (Europe).sfc', 'Mario Kart'),
        game('snes/Multi/Jeu.m3u', 'Jeu'),
      ],
    ],
    [romLocationKey('snes-1', at('extra'), P), [game('extra/Metroid.sfc', 'Metroid')]],
    [romLocationKey('snes-1', at('absent'), P), []],
  ]);
  const rescans: string[][] = [];
  return {
    rescans,
    rescan: async (keys: string[]) => {
      rescans.push(keys);
      for (const k of keys) {
        if (active.on) catalog.setSource({ plugin: ROM_PLUGIN, instance: k }, byKey.get(k) ?? []);
        else catalog.removeSource({ plugin: ROM_PLUGIN, instance: k });
      }
    },
    claimed: (k: string) => active.on && byKey.has(k),
    catalog,
  };
}

function setup(over: Partial<Config> = {}) {
  const catalog = createCatalog({ dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-games-cat-')), 'sources'), debounceMs: 0, onIgnored: () => {} });
  const cfg = { emulators: [SNES], gameSources: [{ id: 'g1', location: at('pc') }], games: [], gameBookmarks: [], ...over } as unknown as Config;
  const config = { get: () => cfg, update: (fn: (c: Config) => Config) => fn(cfg) };
  const errors: Error[] = [];
  const deps = {
    config,
    access: { isAllowed: () => true, isInside: () => true },
    launcher: {},
    downloads: () => ({ fetchText: async () => '' }),
    scraper: () => null,
    romCacheDir: () => at('cache'),
    pickFile: async () => null,
    toUi: () => {},
    platform: P,
    catalog,
    pcFolders: undefined as unknown,
    romFolders: undefined as unknown,
    onCatalogError: (err: Error) => errors.push(err),
  } as unknown as GamesDeps;
  const active = { on: true };
  const folders = fakeFolders(catalog, active);
  deps.pcFolders = folders;
  const roms = fakeRomFolders(catalog, active);
  deps.romFolders = roms;
  return { catalog, cfg, games: createGames(deps), errors, active, folders, roms };
}

describe('jeux de console → éléments (`jeux-roms`)', () => {
  it('dossiers locaux : l\u2019interface historique lit les jeux que la source du plugin a rangés, dossier absent signalé', async () => {
    const { catalog, games, errors, roms } = setup();
    const r = await games.listRoms('snes-1');
    assert.ok(r.ok);
    assert.deepEqual(errors, []);
    // Seuls les dossiers présents sont analysés de nouveau ; le dossier absent donne une erreur, pas une panne.
    assert.deepEqual(roms.rescans, [[romLocationKey('snes-1', at('snes'), P), romLocationKey('snes-1', at('extra'), P)]]);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /absent/);
    assert.deepEqual(
      r.roms.map((rom) => [rom.displayName, rom.name, rom.path, rom.dir, rom.image, rom.remote]),
      [
        ['Jeu', 'Jeu', at('snes', 'Multi', 'Jeu.m3u'), at('snes', 'Multi'), null, false],
        ['Mario Kart', 'Mario Kart (Europe)', at('snes', 'Mario Kart (Europe).sfc'), at('snes'), null, false],
        ['Metroid', 'Metroid', at('extra', 'Metroid.sfc'), at('extra'), null, false],
        ['Zelda', 'Zelda (France)', at('snes', 'Zelda (France).sfc'), at('snes'), at('images', 'Zelda (France).png'), false],
      ],
    );
    // Le cœur ne range plus rien sous `jeux-roms` pour un dossier local : les éléments sont ceux du plugin.
    assert.ok(catalog.keys().every((k) => catalog.get(k)!.source.plugin !== 'jeux-roms'));
    assert.equal(catalog.element(romKey('snes-1', at('snes', 'Zelda (France).sfc'), P))?.source.plugin, ROM_PLUGIN);
  });

  it('au démarrage, la liste attend que les plugins aient pris leurs dossiers', async () => {
    const { games, active, roms } = setup();
    active.on = false;
    let release = () => {};
    const started = new Promise<void>((resolve) => (release = resolve));
    Object.assign(roms, { ready: () => started });
    const list = games.listRoms('snes-1');
    active.on = true;
    release();
    const r = await list;
    assert.ok(r.ok && r.roms.length === 4);
  });

  it('plugin désactivé : plus de jeux des dossiers, sans erreur, un message qui le dit ; ils reviennent à la réactivation', async () => {
    const { catalog, games, active, errors } = setup();
    await games.listRoms('snes-1');
    const before = catalog.keys().length;
    active.on = false;
    const off = await games.listRoms('snes-1');
    assert.equal(off.ok, false);
    assert.match((off as { error: string }).error, /Aucun plugin actif ne lit le dossier|No active plugin reads the folder/);
    // Le pont retire les éléments d'un plugin désactivé (simulé ici) ; la liste ne plante pas.
    catalog.removeSource({ plugin: ROM_PLUGIN, instance: romLocationKey('snes-1', at('snes'), P) });
    catalog.removeSource({ plugin: ROM_PLUGIN, instance: romLocationKey('snes-1', at('extra'), P) });
    assert.equal(catalog.keys().length, 0);
    active.on = true;
    const on = await games.listRoms('snes-1');
    assert.ok(on.ok && on.roms.length === 4);
    assert.equal(catalog.keys().length, before);
    assert.deepEqual(errors, []);
  });

  it('continuité : les jeux rangés par le cœur pour un dossier local sont retirés, ceux d\u2019une source en ligne gardés', () => {
    const url = 'https://jeux.exemple.org/snes/';
    const { catalog, cfg } = setup({ emulators: [{ ...SNES, sources: [at('extra'), url] }] });
    const old = (instance: string, key: string) =>
      catalog.setSource({ plugin: 'jeux-roms', instance }, [
        { key, name: 'Ancien', open: { kind: 'game', console: 'snes-1', path: at('snes', 'x.sfc') }, tags: ['game'], infos: {}, images: {} },
      ]);
    old(romInstance('snes-1', at('snes'), P), romKey('snes-1', at('snes', 'x.sfc'), P));
    old(romInstance('snes-1', url, P), romKey('snes-1', `${url}y.sfc`, P));
    syncFeeds(catalog, [gameConfigFeed(cfg, P)]);
    assert.deepEqual(catalog.keys(), [romKey('snes-1', `${url}y.sfc`, P)]);
    syncFeeds(catalog, [gameConfigFeed({ ...cfg, emulators: [] }, P)]);
    assert.deepEqual(catalog.keys(), []);
  });
});

describe('jeux PC → éléments (`jeux-pc`, `jeux-pc-manuel`)', () => {
  it('dossiers de jeux : l\u2019interface historique lit les jeux que la source du plugin a rangés, avec l\u2019état de chaque dossier', async () => {
    const { games, folders } = setup({
      gameSources: [
        { id: 'g1', location: at('pc') },
        { id: 'g2', location: at('absent') },
        { id: 'g3', location: 'https://x.org/jeux/' },
      ],
    });
    const { games: found, status } = await games.scanGameSources();
    assert.equal(folders.rescans, 1);
    assert.deepEqual(
      found.map((g) => [g.name, g.path, g.source]),
      [
        ['Celeste', at('pc', 'Celeste', 'Celeste.exe'), 'g1'],
        ['Tetris', at('pc', 'Tetris.exe'), 'g1'],
      ],
    );
    assert.deepEqual(status.g1, { ok: true, error: null, count: 2 });
    assert.equal(status.g2.ok, false);
    assert.match(status.g3.error!, /disque ou un partage/);
  });

  it('plugin désactivé : plus de jeux des dossiers, sans erreur, et un état qui le dit ; ils reviennent à la réactivation', async () => {
    const { catalog, games, active, errors } = setup();
    await games.scanGameSources();
    active.on = false;
    const off = await games.scanGameSources();
    assert.deepEqual(off.games, []);
    assert.match(off.status.g1.error!, /Aucun plugin actif/);
    assert.deepEqual(catalog.keys(), []);
    active.on = true;
    assert.equal((await games.scanGameSources()).games.length, 2);
    assert.deepEqual(errors, []);
  });

  it('continuité : les jeux que le cœur avait rangés sous `jeux-pc` sont retirés, ceux du plugin gardent leur clé', async () => {
    const { catalog, games, cfg } = setup();
    const key = pcGameKey(at('pc', 'Tetris.exe'), P);
    catalog.setSource({ plugin: 'jeux-pc', instance: at('pc') }, [
      { key, name: 'Tetris', open: { kind: 'program', path: at('pc', 'Tetris.exe') }, tags: ['game'], infos: {}, images: {} },
    ]);
    syncFeeds(catalog, [gameConfigFeed(cfg, P)]);
    assert.equal(catalog.element(key), null);
    await games.scanGameSources();
    assert.equal(catalog.element(key)?.source.plugin, PLUGIN);
  });

  it('jeu ajouté à la main : même clé que le même jeu trouvé dans un dossier ; adresse de lanceur gardée telle quelle', () => {
    const e = manualGameElement({ path: at('pc', 'Tetris.sh'), args: ['-f'], image: '/i.png' }, 'linux');
    assert.deepEqual(e, {
      key: pcGameKey(at('pc', 'Tetris.sh'), 'linux'),
      name: 'Tetris.sh',
      open: { kind: 'program', path: at('pc', 'Tetris.sh'), args: ['-f'] },
      tags: ['game'],
      infos: { system: 'pc' },
      images: { poster: '/i.png' },
    });
    assert.equal(manualGameElement({ name: 'Portal', path: 'C:\\Jeux\\Portal.exe' }, 'win32').key, 'pc:c:/jeux/portal.exe');
    assert.equal(manualGameElement({ name: 'Hades', path: 'steam://rungameid/1145360' }, 'win32').key, 'pc:steam://rungameid/1145360');
  });
});

describe('marque-pages de jeux → éléments (`jeux-marque`)', () => {
  const bm = (o: Partial<GameBookmark>): GameBookmark =>
    ({
      id: 'b1',
      source: 'https://jeux/zelda.zip',
      kind: 'http',
      title: 'Zelda',
      console: null,
      system: '',
      downloadId: null,
      done: false,
      added: 1,
      ...o,
    }) as GameBookmark;

  it('ouvert comme son lien, avec le système du marque-page, de sa console, ou `pc`', () => {
    assert.deepEqual(gameBookmarkElement(bm({ system: 'Sega - Mega Drive - Genesis' }), []), {
      key: gameBookmarkKey('b1'),
      name: 'Zelda',
      open: { kind: 'site', url: 'https://jeux/zelda.zip' },
      tags: ['game'],
      infos: { system: 'Sega - Mega Drive - Genesis' },
      images: {},
    });
    assert.deepEqual(gameBookmarkElement(bm({ console: 'snes-1' }), [SNES]).infos, { system: 'Nintendo - Super Nintendo Entertainment System' });
    assert.deepEqual(gameBookmarkElement(bm({ console: 'pc' }), []).infos, { system: 'pc' });
    assert.deepEqual(gameBookmarkElement(bm({}), []).infos, {});
  });

  it('la configuration donne les jeux ajoutés à la main et les marque-pages en attente (pas ceux déjà téléchargés)', () => {
    const { catalog, cfg } = setup({
      games: [{ name: 'Tetris', path: at('pc', 'Tetris.exe') }],
      gameBookmarks: [bm({ id: 'b1' }), bm({ id: 'b2', done: true })],
    });
    syncFeeds(catalog, [gameConfigFeed(cfg, P)]);
    assert.deepEqual(catalog.keys().sort(), [gameBookmarkKey('b1'), pcGameKey(at('pc', 'Tetris.exe'), P)].sort());
    assert.equal(catalog.element(gameBookmarkKey('b1'))?.source.plugin, 'jeux-marque');
    syncFeeds(catalog, [gameConfigFeed({ ...cfg, games: [], gameBookmarks: [] }, P)]);
    assert.deepEqual(catalog.keys(), []);
  });
});
