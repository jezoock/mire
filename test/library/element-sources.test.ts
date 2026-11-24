// Sources de la bibliothèque → éléments (P2-02) : un élément par fichier avec ses tags de source, sous-titres,
// analyses répétées sans doublon ni réécriture, emplacements qui se recouvrent, emplacement inaccessible ou retiré,
// et `library.scan` qui rend les mêmes `LibraryItem` qu'avant.
//
// Les dossiers de cet ordinateur et les partages réseau sont lus par les plugins `mire.source.local` (P5-11c) et
// `mire.source.network` (P5-11d) (test/library/plugin-folders.test.ts) : la mécanique du catalogue est vérifiée ici
// avec une source factice du cœur (`dossier-factice`, test/library/fixtures.ts), sur des dossiers temporaires.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, LibrarySource } from '@mire/shared';
import { createCatalog, type CatalogChange } from '../../src/main/catalog/index.ts';
import { localFileKey, m3uEntryKey, remoteFileKey } from '../../src/main/catalog/keys.ts';
import { sourceFileName } from '../../src/main/catalog/persistence.ts';
import { DEFAULT_PROVIDERS, librarySources, resolveLocation, scanLibrary } from '../../src/main/library/index.ts';
import type { ScannedLocation, ScanOptions } from '../../src/main/library/index.ts';
import { createLibraryService } from '../../src/main/library/service.ts';
import { fakeFolderProvider, fakeFolderSource, indexServer, libraryTree } from './fixtures.ts';

const tree = libraryTree();
const { root, touch } = tree;
touch('Films/Amélie (2001).fr.srt');
touch('Films/Amélie (2001).en.vtt');
touch('Films/Autre.srt');
const server = await indexServer();
after(() => {
  tree.remove();
  server.close();
});

const PLATFORM = process.platform;
const at = (rel: string) => path.join(root, rel);
const src = (id: string, kind: LibrarySource['kind'], location: string): LibrarySource => ({ id, kind, location });

/** Analyse où chaque dossier temporaire est lu par le fournisseur factice. */
const asShares = (o: ScanOptions) => scanLibrary({ ...o, providers: [...DEFAULT_PROVIDERS, fakeFolderProvider] });
/** Sources d'éléments du cœur, plus la source factice. */
const withFake = () => [...librarySources(), fakeFolderSource()];

function setup(sources: LibrarySource[]) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-catalog-')), 'sources');
  const changes: CatalogChange[] = [];
  const catalog = createCatalog({ dir, debounceMs: 0, onIgnored: () => {} });
  catalog.onChange((c) => changes.push(c));
  const cfg = { library: { sources }, bookmarks: [] } as unknown as Config;
  const errors: Error[] = [];
  const library = createLibraryService({
    config: { get: () => cfg },
    access: { allowFile: () => {}, isAllowed: () => true },
    catalog,
    onCatalogError: (err) => errors.push(err),
    scan: asShares,
    sources: withFake(),
  });
  return { dir, catalog, changes, cfg, library, errors };
}

describe('sources de la bibliothèque : dossiers (source factice)', () => {
  it('un élément par fichier, avec ses tags de source et son dossier', async () => {
    const { catalog, library } = setup([src('films', 'video', at('Films')), src('photos', 'image', at('Films'))]);
    const { items } = await library.scan();
    assert.deepEqual(catalog.keys().sort(), items.map((i) => localFileKey(i.path, PLATFORM)).sort());
    const amelie = catalog.element(localFileKey(at('Films/Amélie (2001).mkv'), PLATFORM));
    assert.deepEqual(amelie && { ...amelie, added: 0 }, {
      key: localFileKey(at('Films/Amélie (2001).mkv'), PLATFORM),
      source: { plugin: 'dossier-factice', instance: localFileKey(at('Films'), PLATFORM).slice('local:'.length) },
      name: 'Amélie (2001)',
      open: { kind: 'file', path: at('Films/Amélie (2001).mkv') },
      tags: ['factice'],
      infos: { folder: 'Films' },
      images: {},
      added: 0,
    });
  });

  it('analyses répétées : mêmes éléments, aucun doublon, aucun changement annoncé, fichier non réécrit', async () => {
    const { dir, catalog, changes, library } = setup([src('films', 'video', at('Films')), src('m', 'audio', at('Musique'))]);
    await library.scan();
    await catalog.flush();
    const size = catalog.size();
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 2);
    // Fichiers supprimés : une analyse qui ne change rien ne doit pas les réécrire.
    for (const f of files) fs.rmSync(path.join(dir, f));
    changes.splice(0);
    await library.scan();
    await library.scan();
    await catalog.flush();
    assert.equal(catalog.size(), size);
    assert.deepEqual(changes, []);
    assert.deepEqual(fs.readdirSync(dir), []);
    // Un fichier ajouté : seul l'emplacement concerné est réécrit.
    const added = touch('Musique/Album/02 - Suite.mp3');
    await library.scan();
    await catalog.flush();
    assert.deepEqual(changes, [{ added: [localFileKey(added, PLATFORM)], changed: [], removed: [] }]);
    assert.equal(fs.readdirSync(dir).length, 1);
    fs.rmSync(added);
  });

  it('emplacements qui se recouvrent (dossier inclus dans un autre) : ni doublon, ni retrait intempestif', async () => {
    const { catalog, changes, cfg, library } = setup([src('tout', 'video', root), src('films', 'video', at('Films'))]);
    const { items } = await library.scan();
    // Les vidéos de Films sont deux fois dans les `LibraryItem` (comportement inchangé), une fois dans le catalogue.
    assert.ok(items.length > new Set(items.map((i) => i.path)).size);
    assert.equal(catalog.size(), new Set(items.map((i) => i.path)).size);
    assert.equal(catalog.sources().length, 2);
    const filmKey = localFileKey(at('Films/Amélie (2001).mkv'), PLATFORM);
    // Le dossier englobant quitte la configuration : les vidéos de Films restent, les autres partent.
    cfg.library.sources = [src('films', 'video', at('Films'))];
    changes.splice(0);
    await library.scan();
    assert.ok(catalog.element(filmKey));
    assert.equal(changes.length, 1);
    assert.ok(changes[0].removed.length > 0);
    assert.ok(changes[0].removed.every((k) => !k.startsWith(localFileKey(at('Films'), PLATFORM) + '/')));
    assert.deepEqual(changes[0].added, []);
    // Il revient : les vidéos de Films ne sont ni ajoutées une deuxième fois ni retirées.
    cfg.library.sources = [src('films', 'video', at('Films')), src('tout', 'video', root)];
    changes.splice(0);
    await library.scan();
    assert.equal(catalog.size(), new Set(items.map((i) => i.path)).size);
    const back = changes.at(-1) as CatalogChange;
    assert.ok(back.added.every((k) => !k.startsWith(localFileKey(at('Films'), PLATFORM) + '/')));
    assert.deepEqual(back.removed, []);
  });

  it('un emplacement inaccessible garde ses éléments ; retiré de la configuration, il les retire', async () => {
    const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-moved-'));
    fs.writeFileSync(path.join(moved, 'Film.mkv'), '');
    const { catalog, cfg, library } = setup([src('x', 'video', moved)]);
    await library.scan();
    const key = localFileKey(path.join(moved, 'Film.mkv'), PLATFORM);
    assert.ok(catalog.element(key));
    fs.renameSync(moved, `${moved}-ailleurs`);
    const { status } = await library.scan();
    assert.equal(status.x.ok, false);
    assert.ok(catalog.element(key));
    cfg.library.sources = [];
    await library.scan();
    assert.equal(catalog.element(key), null);
    assert.deepEqual(catalog.sources(), []);
    fs.rmSync(`${moved}-ailleurs`, { recursive: true, force: true });
  });

  it('nombre maximal d’éléments atteint : la liste coupée ne retire rien du catalogue', async () => {
    const seen: ScannedLocation[] = [];
    await asShares({ sources: [src('films', 'video', at('Films'))], maxItems: 1, onScanned: (s) => seen.push(s) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].complete, false);
    await asShares({ sources: [src('films', 'video', at('Films'))], onScanned: (s) => seen.push(s) });
    assert.equal(seen[1].complete, true);
  });

  it('une erreur du catalogue n’empêche pas la bibliothèque de répondre', async () => {
    const errors: Error[] = [];
    const library = createLibraryService({
      config: { get: () => ({ library: { sources: [src('films', 'video', at('Films'))] }, bookmarks: [] }) as never },
      access: { allowFile: () => {}, isAllowed: () => true },
      catalog: {
        setSource: () => {
          throw new Error('disque plein');
        },
        removeSource: () => ({ added: [], changed: [], removed: [] }),
        sources: () => [],
        keysOf: () => [],
        get: () => undefined,
      },
      onCatalogError: (err) => errors.push(err),
      scan: asShares,
      sources: withFake(),
    });
    const { items } = await library.scan();
    assert.equal(items.length, 2);
    assert.deepEqual(
      errors.map((e) => e.message),
      ['disque plein'],
    );
  });
});

describe('sources de la bibliothèque : `library.scan` inchangé', () => {
  it('mêmes `LibraryItem` et même état avec ou sans catalogue', async () => {
    const sources = [
      src('films', 'video', at('Films')),
      src('photos', 'image', at('Films')),
      src('series', 'video', at('Séries')),
      src('musique', 'audio', at('Musique')),
      src('images', 'image', at('Images')),
      src('absent', 'video', at('Absent')),
      src('web', 'video', `${server.base}/films/`),
      src('liste', 'video', `${server.base}/listes/chaines.m3u`),
    ];
    const cfg = { library: { sources }, bookmarks: [{ id: 'b', url: 'https://site/x', title: 'X', type: 'movie' }] } as unknown as Config;
    const access = { allowFile: () => {}, isAllowed: () => true };
    const without = await createLibraryService({ config: { get: () => cfg }, access, scan: asShares, sources: withFake() }).scan();
    const { catalog } = setup([]);
    const withCatalog = await createLibraryService({ config: { get: () => cfg }, access, catalog, scan: asShares, sources: withFake() }).scan();
    assert.deepEqual(withCatalog, without);
    const { items, status } = await asShares({ sources, bookmarks: cfg.bookmarks });
    assert.deepEqual(withCatalog, { items, status });
    assert.ok(catalog.size() > 0);
  });
});

describe('sources de la bibliothèque : serveur web et liste M3U', () => {
  it('serveur web : tag `remote`, serveur, sous-titres et images en ligne', async () => {
    const { catalog: c, library } = setup([src('web', 'video', `${server.base}/films/`)]);
    await library.scan();
    const video = `${server.base}/films/Am%C3%A9lie%20(2001).mkv`;
    const el = c.element(remoteFileKey(video));
    assert.equal(el?.source.plugin, 'src-http');
    assert.equal(el?.source.instance, `${server.base}/films/`);
    assert.deepEqual(el?.tags, ['remote']);
    assert.deepEqual(el?.open, { kind: 'file', path: video });
    assert.deepEqual(el?.infos, {
      folder: 'films',
      server: new URL(server.base).host,
      subtitles: [`${server.base}/films/Am%C3%A9lie%20(2001).fr.srt`, `${server.base}/films/Am%C3%A9lie%20(2001).en.vtt`],
    });
    assert.deepEqual(el?.images, { poster: `${server.base}/films/Am%C3%A9lie%20(2001).jpg`, background: `${server.base}/films/fanart.jpg` });
    assert.equal(c.size(), 2);
  });

  it('liste M3U : une entrée par flux, ouverte comme un flux, avec son logo', async () => {
    const list = `${server.base}/listes/chaines.m3u`;
    const { catalog, library } = setup([src('v', 'video', list), src('a', 'audio', list)]);
    await library.scan();
    assert.deepEqual(
      catalog.keys().sort(),
      [
        m3uEntryKey(list, 'http://flux/a', PLATFORM),
        m3uEntryKey(list, `${server.base}/listes/musique/b.mp3`, PLATFORM),
        m3uEntryKey(list, `${server.base}/listes/video/c.mkv`, PLATFORM),
      ].sort(),
    );
    const chaine = catalog.element(m3uEntryKey(list, 'http://flux/a', PLATFORM));
    assert.equal(chaine?.source.plugin, 'src-m3u');
    assert.equal(chaine?.name, 'Chaîne A');
    assert.deepEqual(chaine?.tags, ['remote']);
    assert.deepEqual(chaine?.open, { kind: 'stream', url: 'http://flux/a' });
    // Sans extension : le type de média vient de celui de la source (P2-04) ; avec, le moteur de tags le déduit.
    assert.deepEqual(chaine?.infos, { playlist: 'chaines', mediaType: 'video' });
    assert.deepEqual(catalog.element(m3uEntryKey(list, `${server.base}/listes/musique/b.mp3`, PLATFORM))?.infos, { playlist: 'chaines' });
    assert.deepEqual(chaine?.images, { logo: 'http://logo/a.png' });
  });

  it('liste inaccessible : rien n’est ajouté ni retiré', async () => {
    const { catalog, changes, library } = setup([src('y', 'video', `${server.base}/absente.m3u`)]);
    await library.scan();
    assert.equal(catalog.size(), 0);
    assert.deepEqual(changes, []);
    assert.deepEqual(catalog.sources(), []);
  });
});

describe('sources de la bibliothèque : `ElementSource`', () => {
  const target = (location: string, platform: NodeJS.Platform) => ({ location, resolved: resolveLocation(location, { platform, uid: 1000 }) });
  const sourceFor = (location: string, platform: NodeJS.Platform) => {
    const loc = { target: target(location, platform), kinds: new Set(['video'] as const) };
    const s = librarySources(platform).find((x) => x.handles(loc));
    return s && { id: s.id, tags: s.tags, instance: s.instance(loc) };
  };

  it('chaque emplacement a sa source, et un identifiant d’emplacement stable', () => {
    // Dossier de cet ordinateur, partage réseau : lus par les plugins `mire.source.local` et `mire.source.network`.
    assert.equal(sourceFor('D:\\Films\\', 'win32'), undefined);
    assert.equal(sourceFor('\\\\NAS\\Films', 'win32'), undefined);
    assert.equal(sourceFor('smb://nas/Films', 'win32'), undefined);
    assert.equal(sourceFor('smb://nas/Films', 'linux'), undefined);
    assert.equal(sourceFor('/home/moi/Films/', 'linux'), undefined);
    assert.deepEqual(sourceFor('HTTPS://Nas.local/films/', 'linux'), { id: 'src-http', tags: ['remote'], instance: 'https://nas.local/films/' });
    assert.deepEqual(sourceFor('https://box/liste.m3u#x', 'linux'), { id: 'src-m3u', tags: ['remote'], instance: 'https://box/liste.m3u' });
  });

  it('`scan` d’un emplacement seul rend les mêmes éléments que l’analyse de la bibliothèque', async () => {
    for (const location of [`${server.base}/films/`, `${server.base}/listes/chaines.m3u`]) {
      const kinds = new Set(['video', 'image'] as const);
      const loc = { target: target(location, PLATFORM), kinds };
      const source = librarySources(PLATFORM).find((s) => s.handles(loc));
      assert.ok(source, location);
      const scanned: ScannedLocation[] = [];
      await scanLibrary({ sources: [src('v', 'video', location), src('i', 'image', location)], onScanned: (s) => scanned.push(s) });
      assert.deepEqual(await source.scan(loc), source.elementsOf(scanned[0]), location);
    }
  });

  it('nom du fichier d’un emplacement : lisible', () => {
    assert.match(sourceFileName({ plugin: 'src-local', instance: '/home/moi/Films' }), /^src-local--home-moi-films-[0-9a-f]{10}\.json$/);
  });
});
