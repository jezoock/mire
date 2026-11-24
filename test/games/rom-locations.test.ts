// Dossiers des consoles proposés aux sources des plugins (P5-14a) : emplacements `rom` avec leur console, clés `rom:`
// identiques dans le cœur et dans le plugin, jeux de console d'un plugin de code limité vérifiés par le pont (console
// connue, fichier accordé, chemin réel), puis le vrai plugin inclus `mire.games.roms` branché au cœur : jeux lus par
// l'interface historique, jaquettes, plugin désactivé puis réactivé.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, Emulator } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { romKey } from '../../src/main/catalog/keys.ts';
import { createGames } from '../../src/main/games/index.ts';
import { romLocationKey, romLocations } from '../../src/main/games/roms/locations.ts';
import type { GamesDeps } from '../../src/main/games/types.ts';
import { checkElements, keepReal } from '../../src/main/plugins/bridges.ts';
import { romKey as pluginRomKey } from '../../plugins/mire.games.roms/src/names.mjs';
import { wireRomsPlugin } from './plugin-roms.ts';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-rom-locations-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const at = (...parts: string[]) => path.join(root, ...parts);
function touch(rel: string, text = 'x') {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
  fs.writeFileSync(at(rel), text);
  return at(rel);
}

const SNES = {
  id: 'snes-1',
  name: 'Super Nintendo',
  path: '/emu',
  romsDir: at('snes'),
  sources: [at('extra'), 'https://jeux.exemple.org/snes/', 'relatif/jeux', at('snes')],
  imagesDir: at('images'),
  extensions: ['SFC', '.m3u', 'cue', ''],
} as Emulator;

describe('dossiers des consoles → emplacements `rom`', () => {
  it('un emplacement par dossier local, avec sa console ; ni adresse, ni chemin relatif, ni doublon', () => {
    const list = romLocations([SNES, { id: '', sources: [at('x')] } as unknown as Emulator]);
    const console = {
      id: 'snes-1',
      system: 'Nintendo - Super Nintendo Entertainment System',
      extensions: ['.sfc', '.m3u', '.cue'],
      images: at('images'),
    };
    assert.deepEqual(list, [
      { key: romLocationKey('snes-1', at('snes')), location: { location: at('snes'), path: at('snes'), network: false, kinds: ['rom'], console } },
      { key: romLocationKey('snes-1', at('extra')), location: { location: at('extra'), path: at('extra'), network: false, kinds: ['rom'], console } },
    ]);
    assert.equal(list[0].key, `rom:snes-1|${at('snes')}`);
  });

  it('partage réseau Windows : chemin UNC, marqué réseau ; dossier d’images relatif ignoré', () => {
    const emu = { id: 'ps', name: 'PS', path: 'x', sources: ['\\\\NAS\\Jeux\\PS'], imagesDir: 'images', extensions: [] } as unknown as Emulator;
    const [loc] = romLocations([emu], 'win32');
    assert.equal(loc.key, 'rom:ps|//nas/jeux/ps');
    assert.equal(loc.location.network, true);
    assert.deepEqual(loc.location.console, { id: 'ps', extensions: [] });
  });

  it('clés : le plugin donne exactement celles du cœur (favoris, fiches, temps de jeu retrouvés)', () => {
    for (const [file, platform] of [
      [at('snes', 'Zelda (France).sfc'), process.platform],
      ['/jeux/a|b/%20.sfc', 'linux'],
      ['D:\\Jeux\\SNES\\Zelda.SFC', 'win32'],
      ['\\\\NAS\\Jeux\\Zelda.sfc', 'win32'],
    ] as const) {
      assert.equal(pluginRomKey('snes-1', file), romKey('snes-1', file, platform), file);
      assert.equal(pluginRomKey('a|b', file), romKey('a|b', file, platform), file);
    }
  });
});

describe('pont : jeux de console d’un plugin de code limité', () => {
  const P = 'mire.games.test';
  const snes = at('snes');
  const zelda = touch('snes/Zelda.sfc');
  const secret = touch('prive/Secret.sfc');
  fs.symlinkSync(secret, at('snes', 'Lien.sfc'));
  const game = (file: string, extra: object = {}) => ({
    key: romKey('snes-1', file),
    name: path.basename(file),
    open: { kind: 'game', console: 'snes-1', path: file },
    ...extra,
  });
  const rights = { consoles: new Set(['snes-1']) };

  it('console connue et fichier accordé : gardé avec sa clé `rom:` ; toute autre clé préfixée', () => {
    const r = checkElements(P, 'code', [snes], [game(zelda), { ...game(zelda), key: romKey('snes-1', at('snes', 'Autre.sfc')) }], process.platform, rights);
    assert.deepEqual(
      r.elements.map((e) => e.key),
      [romKey('snes-1', zelda), `plugin:${P}|${romKey('snes-1', at('snes', 'Autre.sfc'))}`],
    );
    assert.deepEqual(r.elements[0].open, { kind: 'game', console: 'snes-1', path: zelda });
  });

  it('refusé : console inconnue, adresse en ligne, fichier hors des dossiers accordés, chemin relatif', () => {
    const raw = [
      { ...game(zelda), open: { kind: 'game', console: 'autre', path: zelda } },
      { ...game(zelda), open: { kind: 'game', console: 'snes-1', path: 'https://jeux.exemple.org/snes/Zelda.sfc' } },
      game(secret),
      { ...game(zelda), open: { kind: 'game', console: 'snes-1', path: 'Zelda.sfc' } },
      { ...game(zelda), open: { kind: 'game', path: zelda } },
    ];
    const r = checkElements(P, 'code', [snes], raw, process.platform, rights);
    assert.deepEqual(r.elements, []);
    assert.equal(r.dropped, raw.length);
    // Sans consoles connues (aucun dossier de console proposé) : aucun jeu.
    assert.equal(checkElements(P, 'code', [snes], [game(zelda)]).elements.length, 0);
    // Le code sensible garde son droit d'avant (adresse comprise), sans préfixe de clé.
    assert.equal(checkElements(P, 'privileged', [], raw.slice(0, 4)).elements.length, 4);
  });

  it('chemin réel : un jeu qui mène hors des dossiers accordés par un lien est écarté', async () => {
    const written = checkElements(P, 'code', [snes], [game(zelda), game(at('snes', 'Lien.sfc'))], process.platform, rights);
    assert.equal(written.elements.length, 2);
    const real = await keepReal(written.elements, 'code', [snes]);
    assert.deepEqual(
      real.elements.map((e) => e.name),
      ['Zelda.sfc'],
    );
  });
});

describe('plugin inclus `mire.games.roms` branché au cœur', () => {
  const base = at('demo');
  const file = (rel: string, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), text);
    return path.join(base, rel);
  };
  file('snes/Zelda (France).sfc');
  file('snes/Multi/Jeu.m3u', 'Jeu (Disc 1).cue\nJeu (Disc 2).cue\n');
  file('snes/Multi/Jeu (Disc 1).cue');
  file('snes/Multi/Jeu (Disc 2).cue');
  const cover = file('images/Zelda (France).png');
  const outside = file('ailleurs/Cache.png');
  fs.symlinkSync(outside, path.join(base, 'images', 'Jeu.png'));
  const emu = {
    id: 'snes-1',
    name: 'Super Nintendo',
    path: '/emu',
    romsDir: path.join(base, 'snes'),
    sources: [],
    imagesDir: path.join(base, 'images'),
    extensions: ['.sfc', '.m3u', '.cue'],
  } as Emulator;

  async function setup() {
    const catalog = createCatalog({ dir: path.join(fs.mkdtempSync(path.join(root, 'cat-')), 'sources'), debounceMs: 0, onIgnored: () => {} });
    const cfg = { emulators: [emu], gameSources: [], games: [], gameBookmarks: [] } as unknown as Config;
    const config = { get: () => cfg };
    const logs: string[] = [];
    const plugin = await wireRomsPlugin({ config, catalog, log: (m) => logs.push(m) });
    const games = createGames({
      config,
      access: { isAllowed: () => true, isInside: () => true },
      downloads: () => ({ fetchText: async () => '' }),
      scraper: () => null,
      platform: process.platform,
      catalog,
      romFolders: plugin.romFolders,
    } as unknown as GamesDeps);
    return { catalog, games, plugin, logs };
  }

  it('l’interface historique reçoit les jeux du plugin, avec leurs jaquettes et les clés d’avant ; dossiers accordés', async () => {
    const { catalog, games, plugin } = await setup();
    const r = await games.listRoms('snes-1');
    assert.ok(r.ok);
    assert.deepEqual(
      r.roms.map((x) => [x.displayName, x.image]),
      [
        ['Jeu', null],
        ['Zelda', cover],
      ],
    );
    const zelda = catalog.element(romKey('snes-1', path.join(base, 'snes', 'Zelda (France).sfc')));
    assert.equal(zelda?.source.plugin, 'mire.games.roms');
    assert.equal(zelda?.source.instance, romLocationKey('snes-1', path.join(base, 'snes')));
    assert.deepEqual(plugin.bridges.assignedFolders('mire.games.roms').sort(), [path.join(base, 'images'), path.join(base, 'snes')]);
  });

  it('plugin désactivé : ses jeux disparaissent sans erreur ; ils reviennent à la réactivation', async () => {
    const { catalog, games, plugin, logs } = await setup();
    await games.listRoms('snes-1');
    const keys = catalog.keys().sort();
    assert.equal(keys.length, 2);
    await plugin.setEnabled(false);
    assert.deepEqual(catalog.keys(), []);
    const off = await games.listRoms('snes-1');
    assert.equal(off.ok, false);
    assert.match((off as { error: string }).error, /Aucun plugin actif|No active plugin/);
    assert.deepEqual(plugin.bridges.assignedFolders('mire.games.roms'), []);
    await plugin.setEnabled(true);
    const on = await games.listRoms('snes-1');
    assert.ok(on.ok);
    assert.deepEqual(catalog.keys().sort(), keys);
    assert.deepEqual(logs, []);
  });
});
