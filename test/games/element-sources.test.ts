// Jeux → éléments (P2-03) : jeux de console (jeux sur disque compris), jeux PC des dossiers, jeux ajoutés à la main,
// marque-pages de jeux ; les listes de l'interface historique alimentent le catalogue sans changer de réponse.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, Emulator, GameBookmark } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { gameBookmarkKey, pcGameKey, romKey } from '../../src/main/catalog/keys.ts';
import { syncFeeds } from '../../src/main/catalog/sync.ts';
import { gameBookmarkElement, gameConfigFeed, manualGameElement, pcSource, romInstance, romSource } from '../../src/main/games/element-sources.ts';
import { createGames, localPcProvider } from '../../src/main/games/index.ts';
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
// Jeux PC : un dossier de jeu avec son programme, un programme posé dans le dossier.
const exe = P === 'win32' ? '.exe' : P === 'darwin' ? '.app' : '.sh';
touch(`pc/Celeste/Celeste${exe}`, 'x'.repeat(10));
touch(`pc/Tetris${exe}`);

const SNES: Emulator = {
  id: 'snes-1',
  name: 'Super Nintendo',
  path: '/emu',
  sources: [at('extra'), at('absent')],
  romsDir: at('snes'),
  imagesDir: at('images'),
  extensions: ['.sfc', '.m3u', '.cue'],
} as Emulator;

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
    onCatalogError: (err: Error) => errors.push(err),
  } as unknown as GamesDeps;
  return { catalog, cfg, games: createGames(deps), errors };
}

describe('jeux de console → éléments (`jeux-roms`)', () => {
  it('une liste de jeux alimente le catalogue : un élément par jeu listé, disques cités écartés', async () => {
    const { catalog, games, errors } = setup();
    const r = await games.listRoms('snes-1', { online: true });
    assert.ok(r.ok);
    assert.deepEqual(errors, []);
    // L'interface reçoit la même liste qu'avant ; le catalogue a un élément par jeu listé.
    assert.deepEqual(catalog.keys().sort(), r.roms.map((rom) => romKey('snes-1', rom.path, P)).sort());
    assert.ok(!catalog.keys().some((k) => k.includes('Disc 1')), 'les disques cités par la liste .m3u ne sont pas des jeux');
    const zelda = catalog.element(romKey('snes-1', at('snes', 'Zelda (France).sfc'), P))!;
    assert.deepEqual(
      { ...zelda, added: 0 },
      {
        key: romKey('snes-1', at('snes', 'Zelda (France).sfc'), P),
        source: { plugin: 'jeux-roms', instance: romInstance('snes-1', at('snes'), P) },
        name: 'Zelda',
        open: { kind: 'game', console: 'snes-1', path: at('snes', 'Zelda (France).sfc') },
        tags: ['game'],
        infos: { system: 'Nintendo - Super Nintendo Entertainment System' },
        images: { poster: at('images', 'Zelda (France).png') },
        added: 0,
      },
    );
    // Un emplacement par dossier : celui des sources en plus a le sien.
    assert.equal(catalog.element(romKey('snes-1', at('extra', 'Metroid.sfc'), P))?.source.instance, romInstance('snes-1', at('extra'), P));
  });

  it('`scan` d\u2019un emplacement rend les mêmes éléments ; un emplacement inaccessible lève une erreur', async () => {
    const { catalog, games } = setup();
    await games.listRoms('snes-1');
    const src = romSource(async () => '', P);
    const scanned = await src.scan({ console: SNES, location: at('snes') });
    const ref = { plugin: 'jeux-roms', instance: src.instance({ console: SNES, location: at('snes') }) };
    const inCatalog = catalog.keys().filter((k) => catalog.get(k)!.source.instance === ref.instance);
    assert.deepEqual(scanned.map((e) => e.key).sort(), inCatalog.sort());
    await assert.rejects(src.scan({ console: SNES, location: at('absent') }));
  });

  it('un emplacement devenu inaccessible garde ses jeux ; une console retirée de la configuration les retire', async () => {
    const { catalog, games, cfg } = setup();
    await games.listRoms('snes-1', { online: true });
    const before = catalog.keys().length;
    fs.renameSync(at('extra'), at('extra-off'));
    try {
      await games.listRoms('snes-1', { online: true });
      assert.equal(catalog.keys().length, before);
    } finally {
      fs.renameSync(at('extra-off'), at('extra'));
    }
    syncFeeds(catalog, [gameConfigFeed(cfg, P)]);
    assert.equal(catalog.keys().length, before, 'console encore configurée : rien ne bouge');
    syncFeeds(catalog, [gameConfigFeed({ ...cfg, emulators: [] }, P)]);
    assert.deepEqual(catalog.keys(), []);
  });
});

describe('jeux PC → éléments (`jeux-pc`, `jeux-pc-manuel`)', () => {
  it('l\u2019analyse des dossiers de jeux alimente le catalogue', async () => {
    const { catalog, games } = setup();
    const { games: found } = await games.scanGameSources();
    assert.equal(found.length, 2);
    for (const g of found) {
      const e = catalog.element(pcGameKey(g.path, P))!;
      assert.deepEqual([e.source.plugin, e.name, e.open, e.tags, e.infos], ['jeux-pc', g.name, { kind: 'program', path: g.path }, ['game'], { system: 'pc' }]);
    }
    const scanned = await pcSource([localPcProvider(P)], P).scan({ id: 'g1', location: at('pc') });
    assert.deepEqual(scanned.map((e) => e.key).sort(), catalog.keys().sort());
  });

  it('un dossier de jeux inaccessible garde ses jeux ; retiré de la configuration, il les retire', async () => {
    const { catalog, games, cfg } = setup();
    await games.scanGameSources();
    cfg.gameSources[0] = { id: 'g1', location: at('pc-absent') };
    await games.scanGameSources();
    assert.equal(catalog.keys().length, 2);
    syncFeeds(catalog, [gameConfigFeed({ ...cfg, gameSources: [] }, P)]);
    assert.deepEqual(catalog.keys(), []);
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
      games: [{ name: 'Tetris', path: at('pc', `Tetris${exe}`) }],
      gameBookmarks: [bm({ id: 'b1' }), bm({ id: 'b2', done: true })],
    });
    syncFeeds(catalog, [gameConfigFeed(cfg, P)]);
    assert.deepEqual(catalog.keys().sort(), [gameBookmarkKey('b1'), pcGameKey(at('pc', `Tetris${exe}`), P)].sort());
    assert.equal(catalog.element(gameBookmarkKey('b1'))?.source.plugin, 'jeux-marque');
    syncFeeds(catalog, [gameConfigFeed({ ...cfg, games: [], gameBookmarks: [] }, P)]);
    assert.deepEqual(catalog.keys(), []);
  });
});
