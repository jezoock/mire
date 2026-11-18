// Parcours par source et par dossier (explorateur, P4-08) : racines, arbre des dossiers tiré du catalogue, tranches,
// et refus des chemins qui sortent d'une source (forme du chemin, lien symbolique).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createFolders, FOLDER_PAGE_SIZE, relativeSegments } from '../../src/main/catalog/folders.ts';
import { localFileKey, remoteFileKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

function file(p: string, extra: Partial<ElementInput> = {}): ElementInput {
  return {
    key: localFileKey(p, 'linux'),
    name: path.basename(p, path.extname(p)),
    open: { kind: 'file', path: p },
    tags: ['local'],
    infos: {},
    images: {},
    ...extra,
  };
}

/** Bibliothèque sur le disque : `bib/Films/…`, `bib/Séries/S1/…`, et `bib/dehors`, lien vers un dossier hors de `bib`. */
function setup(roots: string[] = []) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-folders-')));
  const bib = path.join(dir, 'bib');
  const outside = path.join(dir, 'ailleurs');
  for (const d of ['Films', 'Séries/S1']) fs.mkdirSync(path.join(bib, d), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(bib, 'dehors'), 'dir');
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const { t } = builtinTranslator('fr');
  const engine = createTagEngine({ catalog, overrides, registry: createRegistry(t), rules: () => fileTagRules(undefined), contributors: [] });
  const folders = createFolders({ catalog, engine, roots: () => roots.map((r) => r.replace('<bib>', bib)), platform: 'linux', fs: fs.promises });
  const lib: ElementSourceRef = { plugin: 'src-local', instance: bib };
  catalog.setSource(lib, [
    file(`${bib}/Accueil.mkv`),
    file(`${bib}/Films/Zorro.mkv`),
    file(`${bib}/Films/Alien.mkv`),
    file(`${bib}/Séries/S1/E01.mkv`),
    file(`${bib}/dehors/Secret.mkv`),
    file(`${bib}/Disparu/Vieux.mkv`),
  ]);
  return { dir, bib, catalog, engine, folders, lib };
}

const idOf = (f: ReturnType<typeof setup>['folders'], place: string) =>
  f.sources().sources.find((s) => s.place === place)?.id ?? assert.fail(`source ${place}`);

describe('Explorateur : sources et dossiers (P4-08)', () => {
  it('liste les sources du catalogue avec un identifiant opaque, et les dossiers autorisés', () => {
    const { folders, bib } = setup(['<bib>/Films', '<bib>/Films/']);
    const { sources, folders: roots } = folders.sources();
    assert.deepEqual(
      sources.map(({ plugin, place, count }) => ({ plugin, place, count })),
      [{ plugin: 'src-local', place: bib, count: 6 }],
    );
    assert.ok(!sources[0].id.includes('/'), 'aucun chemin dans l’identifiant');
    // Deux écritures du même dossier : une seule racine.
    assert.deepEqual(
      roots.map(({ place, count, plugin }) => ({ place, count, plugin })),
      [{ place: `${bib}/Films`, count: 2, plugin: undefined }],
    );
  });

  it('rend les sous-dossiers puis les éléments, triés par nom, avec leur chemin relatif', async () => {
    const { folders, bib } = setup();
    const id = idOf(folders, bib);
    const top = await folders.folder(id, '');
    assert.deepEqual(top?.folders, [
      { name: 'dehors', path: 'dehors', count: 1 },
      { name: 'Disparu', path: 'Disparu', count: 1 },
      { name: 'Films', path: 'Films', count: 2 },
      { name: 'Séries', path: 'Séries', count: 1 },
    ]);
    assert.deepEqual(
      top?.elements.map((e) => e.name),
      ['Accueil'],
    );
    assert.equal(top?.total, 5);
    const films = await folders.folder(id, 'Films');
    assert.deepEqual(
      films?.elements.map((e) => e.name),
      ['Alien', 'Zorro'],
    );
    const s1 = await folders.folder(id, 'Séries/S1');
    assert.equal(s1?.path, 'Séries/S1');
    assert.deepEqual(
      s1?.elements.map((e) => e.key),
      [localFileKey(`${bib}/Séries/S1/E01.mkv`, 'linux')],
    );
  });

  it('refuse les chemins qui sortent de la source, et les sources inconnues', async () => {
    const { folders, bib } = setup();
    const id = idOf(folders, bib);
    for (const bad of [
      '..',
      'Films/..',
      '../bib/Films',
      './Films',
      'Films/.',
      '/Films',
      'Films/',
      'Films//S1',
      'Films\\..',
      'Fi\0lms',
      bib,
      `${bib}/Films`,
      42,
      {},
      ['Films'],
    ])
      assert.equal(await folders.folder(id, bad), null, `refusé : ${JSON.stringify(bad)}`);
    assert.equal(await folders.folder('inconnue', 'Films'), null);
    assert.equal(await folders.folder(null, ''), null);
    // Un dossier qui n'a aucun élément n'existe pas, même sur le disque.
    fs.mkdirSync(path.join(bib, 'Vide'));
    assert.equal(await folders.folder(id, 'Vide'), null);
  });

  it('refuse un dossier lien symbolique qui mène hors de la source (contrôle de chemin de P0-06)', async () => {
    const { folders, bib } = setup();
    assert.equal(await folders.folder(idOf(folders, bib), 'dehors'), null);
  });

  it('garde parcourable un dossier absent du disque (ses éléments viennent du catalogue)', async () => {
    const { folders, bib } = setup();
    const gone = await folders.folder(idOf(folders, bib), 'Disparu');
    assert.deepEqual(
      gone?.elements.map((e) => e.name),
      ['Vieux'],
    );
  });

  it('un dossier autorisé montre les éléments de toutes les sources qui sont sous lui, et applique le même contrôle', async () => {
    const { folders, bib, catalog } = setup(['<bib>']);
    catalog.setSource({ plugin: 'src-local', instance: `${bib}/Films` }, [file(`${bib}/Films/Brazil.mkv`)]);
    const root = folders.sources().folders[0];
    assert.equal(root.count, 7);
    const films = await folders.folder(root.id, 'Films');
    assert.deepEqual(
      films?.elements.map((e) => e.name),
      ['Alien', 'Brazil', 'Zorro'],
    );
    assert.equal(await folders.folder(root.id, 'dehors'), null);
    assert.equal(await folders.folder(root.id, '..'), null);
  });

  it('découpe un grand dossier en tranches : sous-dossiers, puis éléments', async () => {
    const { folders, catalog } = setup();
    const many: ElementInput[] = [];
    for (let i = 0; i < 3; i++) many.push(file(`/grand/d${i}/x.mkv`));
    for (let i = 0; i < 150; i++) many.push(file(`/grand/f${String(i).padStart(3, '0')}.mkv`));
    catalog.setSource({ plugin: 'src-local', instance: '/grand' }, many);
    const id = idOf(folders, '/grand');
    const first = await folders.folder(id, '');
    assert.equal(first?.total, 153);
    assert.equal(first?.folders.length, 3);
    assert.equal(first?.elements.length, FOLDER_PAGE_SIZE - 3);
    assert.equal(first?.next, String(FOLDER_PAGE_SIZE));
    const second = await folders.folder(id, '', first?.next);
    assert.equal(second?.folders.length, 0);
    assert.equal(second?.elements[0]?.name, `f${String(FOLDER_PAGE_SIZE - 3).padStart(3, '0')}`);
    assert.equal(second?.next, null);
  });

  it('serveur web, console et source sans dossier', async () => {
    const { folders, catalog } = setup();
    const url = 'https://nas.local/films/Action%20et%20aventure/Heat.mkv';
    catalog.setSource({ plugin: 'src-http', instance: 'https://nas.local/films/' }, [
      { key: remoteFileKey(url), name: 'Heat', open: { kind: 'file', path: url }, tags: ['remote'], infos: {}, images: {} },
    ]);
    catalog.setSource({ plugin: 'jeux-roms', instance: 'snes|/roms' }, [
      {
        key: 'rom:snes|/roms/Rpg/zelda.sfc',
        name: 'Zelda',
        open: { kind: 'game', console: 'snes', path: '/roms/Rpg/zelda.sfc' },
        tags: [],
        infos: {},
        images: {},
      },
    ]);
    catalog.setSource({ plugin: 'tv-m3u', instance: 'box' }, [
      { key: 'tv:box|1', name: 'Une', open: { kind: 'stream', url: 'http://box/1' }, tags: [], infos: {}, images: {} },
    ]);
    const web = idOf(folders, 'https://nas.local/films/');
    assert.deepEqual((await folders.folder(web, ''))?.folders, [{ name: 'Action et aventure', path: 'Action et aventure', count: 1 }]);
    assert.deepEqual(
      (await folders.folder(web, 'Action et aventure'))?.elements.map((e) => e.name),
      ['Heat'],
    );
    assert.equal(await folders.folder(web, 'Action et aventure/..'), null);
    const roms = idOf(folders, '/roms');
    assert.deepEqual(
      (await folders.folder(roms, 'Rpg'))?.elements.map((e) => e.name),
      ['Zelda'],
    );
    const tv = idOf(folders, 'box');
    const lvl = await folders.folder(tv, '');
    assert.deepEqual([lvl?.folders, lvl?.elements.map((e) => e.name)], [[], ['Une']]);
  });

  it('suit les changements du catalogue et les annonce', async () => {
    const { folders, catalog, lib, bib } = setup();
    let calls = 0;
    folders.onChange(() => calls++);
    const id = idOf(folders, bib);
    await folders.folder(id, 'Films');
    catalog.setSource(lib, [file(`${bib}/Films/Alien.mkv`)]);
    assert.ok(calls > 0);
    assert.deepEqual(
      (await folders.folder(id, 'Films'))?.elements.map((e) => e.name),
      ['Alien'],
    );
    assert.equal(await folders.folder(id, 'Séries'), null);
  });

  it('forme d’un chemin relatif, selon le système', () => {
    assert.deepEqual(relativeSegments('', 'linux'), []);
    assert.deepEqual(relativeSegments('a/b c', 'linux'), ['a', 'b c']);
    assert.deepEqual(relativeSegments('a:b', 'linux'), ['a:b']);
    assert.equal(relativeSegments('c:', 'win32'), null);
    assert.equal(relativeSegments('a\\b', 'win32'), null);
    assert.equal(relativeSegments('x'.repeat(5000), 'linux'), null);
  });

  it('IPC : catalogSources et catalogFolder passent par le service', async () => {
    const { folders, bib } = setup();
    const h = catalogHandlers({ folders } as unknown as MainContext);
    const { sources } = h.catalogSources();
    assert.equal(sources[0].place, bib);
    assert.equal((await h.catalogFolder(sources[0].id, 'Films', null))?.total, 2);
    assert.equal(await h.catalogFolder(sources[0].id, '../..', null), null);
  });
});
