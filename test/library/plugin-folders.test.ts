// Dossiers de cet ordinateur et partages réseau lus par les plugins inclus `mire.source.local` (P5-11c) et
// `mire.source.network` (P5-11d), branchés au cœur : continuité d'une installation existante (mêmes clés
// `local:<chemin>`, mêmes éléments, rien de retiré), mêmes fichiers et même état des sources pour l'interface
// historique, plugin désactivé puis réactivé, dossier atteint par un lien symbolique, liens qui sortent des dossiers
// accordés, bibliothèque de démonstration du test de fumée. Les tests du code déplacé sont dans plugins/<id>/test/.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ART_RE, COVER_RE, EXT, FANART_RE, type Config, type LibrarySource } from '@mire/shared';
import { createCatalog, type CatalogChange } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import type { LibraryItem } from '../../src/main/library/index.ts';
import { libraryTree } from './fixtures.ts';
import { bundledSubtitles } from '../plugins/bundled-subtitles.ts';
import { PLUGIN_DIR, PLUGIN_DIRS, wireLocalPlugin } from './plugin-folders.ts';

const DEMO = path.join(import.meta.dirname, '../e2e/fixtures/bibliotheque');
const tree = libraryTree();
const { touch } = tree;
// Chemin réel : sous macOS, le dossier temporaire passe par un lien (/var → /private/var).
const root = fs.realpathSync(tree.root);
touch('Films/Amélie (2001).fr.srt');
touch('Films/Amélie (2001).en.vtt');
after(tree.remove);

const at = (rel: string) => path.join(root, rel);
const src = (id: string, kind: LibrarySource['kind'], location: string): LibrarySource => ({ id, kind, location });
const SOURCES = [
  src('films', 'video', at('Films')),
  src('photos', 'image', at('Films')),
  src('series', 'video', at('Séries')),
  src('musique', 'audio', at('Musique')),
  src('images', 'image', at('Images')),
  src('profond', 'video', at('Profond')),
  src('absent', 'video', at('Absent')),
];

function setup(sources: LibrarySource[]) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-catalog-')), 'sources');
  const catalog = createCatalog({ dir, debounceMs: 0, onIgnored: () => {} });
  const changes: CatalogChange[] = [];
  catalog.onChange((c) => changes.push(c));
  const cfg = { library: { sources }, bookmarks: [] } as unknown as Config;
  return { catalog, changes, cfg, config: { get: () => cfg } };
}

/**
 * Ce que l'analyse du cœur rendait avant P5-11c et P5-11d, figé dans test/fixtures/library-avant-p5-11d.json (calculé
 * par le parcours du cœur, `walkLibrary`, avant son retrait ; chemins POSIX) : fichiers et état des sources, et
 * éléments du catalogue, rangés sous `src-local` (tag `local`) pour un dossier, `src-smb` (tag `network`) pour un
 * partage. `arborescence` : les sources `SOURCES` ; `demonstration` : la bibliothèque du test de fumée.
 */
const AVANT = readFileSync(path.join(import.meta.dirname, '../fixtures/library-avant-p5-11d.json'), 'utf8');
type Before = { items: LibraryItem[]; status: Record<string, unknown>; sources: { instance: string; elements: ElementInput[] }[] };

function before(which: 'arborescence' | 'demonstration', kind: 'local' | 'network' = 'local', from = root) {
  const all = JSON.parse(AVANT.split('<racine>').join(from).split('<demonstration>').join(DEMO))[which] as Before;
  const plugin = kind === 'local' ? 'src-local' : 'src-smb';
  const tags = kind === 'local' ? ['local'] : ['network'];
  const sources = all.sources.map((x) => ({ ref: { plugin, instance: x.instance }, elements: x.elements.map((e) => ({ ...e, tags })) }));
  return { items: all.items, status: all.status, sources };
}

const byPath = (items: LibraryItem[]) => [...items].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));

describe('mire.source.local branché au cœur', () => {
  it('installation existante : mêmes clés et mêmes éléments, rien de retiré ni d’ajouté, l’ancienne source part', async () => {
    const { catalog, changes, config } = setup(SOURCES);
    const old = before('arborescence');
    for (const s of old.sources) if (s.elements.length) catalog.setSource(s.ref, s.elements);
    const oldKeys = catalog.keys().sort();
    const oldElements = new Map(oldKeys.map((k) => [k, catalog.get(k)!]));
    assert.ok(oldKeys.length > 0);
    changes.splice(0);

    const logs: string[] = [];
    const { library } = await wireLocalPlugin({ config, catalog, log: (m) => logs.push(m) });
    await library.scan();

    assert.deepEqual(catalog.keys().sort(), oldKeys);
    for (const k of oldKeys) {
      const e = catalog.get(k)!;
      const was = oldElements.get(k)!;
      assert.equal(e.source.plugin, 'mire.source.local', k);
      assert.equal(e.source.instance, was.source.instance, k);
      // Sous-titres : ordre de lecture du disque.
      const subs = (x: typeof e) => ({ ...x.infos, subtitles: x.infos.subtitles ? [...(x.infos.subtitles as string[])].sort() : undefined });
      assert.deepEqual([e.name, e.open, e.tags, subs(e), e.images], [was.name, was.open, was.tags, subs(was), was.images], k);
    }
    assert.ok(catalog.sources().every((r) => r.plugin === 'mire.source.local'));
    for (const c of changes) {
      assert.deepEqual(c.removed, []);
      assert.deepEqual(c.added, []);
    }
    // Le dossier absent : journal de l'analyse du plugin, rien d'autre.
    assert.ok(
      logs.every((m) => m.includes('Dossier introuvable')),
      logs.join('\n'),
    );
  });

  it('interface historique : mêmes fichiers et même état des sources qu’avant', async () => {
    const { catalog, config } = setup(SOURCES);
    const old = before('arborescence');
    const { library } = await wireLocalPlugin({ config, catalog });
    const now = await library.scan();
    assert.deepEqual(byPath(now.items), byPath(old.items));
    assert.deepEqual(now.status, old.status);
    assert.equal(now.status.absent.error, `Dossier introuvable : ${at('Absent')}`);
  });

  it('plugin désactivé : ses éléments disparaissent sans erreur, et reviennent à la réactivation', async () => {
    const { catalog, config } = setup(SOURCES.slice(0, 4));
    const logs: string[] = [];
    const plugin = await wireLocalPlugin({ config, catalog, log: (m) => logs.push(m) });
    const first = await plugin.library.scan();
    const keys = catalog.keys().sort();
    assert.ok(keys.length > 0);

    await plugin.setEnabled(false);
    const off = await plugin.library.scan();
    assert.deepEqual(catalog.keys(), []);
    assert.deepEqual(off.items, []);
    assert.ok(Object.values(off.status).every((s) => s.ok && s.count === 0));

    await plugin.setEnabled(true);
    const on = await plugin.library.scan();
    assert.deepEqual(catalog.keys().sort(), keys);
    assert.deepEqual(byPath(on.items), byPath(first.items));
    assert.deepEqual(logs, []);
  });

  it('dossier retiré de la configuration : ses éléments partent, il n’est plus accordé', async () => {
    const { catalog, cfg, config } = setup(SOURCES.slice(0, 1));
    const plugin = await wireLocalPlugin({ config, catalog });
    await plugin.library.scan();
    assert.ok(catalog.size() > 0);
    assert.deepEqual(plugin.bridges.assignedFolders('mire.source.local'), [at('Films')]);
    cfg.library.sources = [];
    await plugin.syncLocations();
    await plugin.library.scan();
    assert.equal(catalog.size(), 0);
    assert.deepEqual(plugin.bridges.assignedFolders('mire.source.local'), []);
  });

  it('dossier atteint par un lien symbolique : chemins et clés de la configuration', async (t) => {
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-lien-')), 'Films');
    try {
      fs.symlinkSync(at('Films'), link, 'dir');
    } catch {
      return t.skip('liens symboliques indisponibles');
    }
    const sources = [src('films', 'video', link)];
    const { catalog, config } = setup(sources);
    const films = (i: LibraryItem) => i.kind === 'video' && i.dir.startsWith(`${link}`);
    const old = { items: before('arborescence', 'local', path.dirname(link)).items.filter(films) };
    const { library } = await wireLocalPlugin({ config, catalog });
    const now = await library.scan();
    assert.ok(now.items.length > 0);
    assert.deepEqual(byPath(now.items), byPath(old.items));
    assert.ok(catalog.keys().every((k) => k.startsWith(localFileKey(link) + '/')));
  });

  it('lien à l’intérieur d’un dossier qui mène hors des dossiers accordés : écarté (fichier, dossier, affiche)', async (t) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-prive-'));
    fs.writeFileSync(path.join(outside, 'secret.mkv'), '');
    fs.writeFileSync(path.join(outside, 'secret.jpg'), '');
    const lib = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-liens-')));
    fs.writeFileSync(path.join(lib, 'Film.mkv'), '');
    try {
      fs.symlinkSync(path.join(outside, 'secret.mkv'), path.join(lib, 'lien.mkv'));
      fs.symlinkSync(path.join(outside, 'secret.jpg'), path.join(lib, 'Film.jpg'));
      fs.symlinkSync(outside, path.join(lib, 'Ailleurs'), 'dir');
    } catch {
      return t.skip('liens symboliques indisponibles');
    }
    const { catalog, config } = setup([src('films', 'video', lib)]);
    const { library } = await wireLocalPlugin({ config, catalog });
    const { items } = await library.scan();
    assert.deepEqual(
      items.map((i) => [i.path, i.cover]),
      [[path.join(lib, 'Film.mkv'), null]],
    );
    assert.deepEqual(catalog.keys(), [localFileKey(path.join(lib, 'Film.mkv'))]);
    assert.deepEqual(catalog.get(localFileKey(path.join(lib, 'Film.mkv')))?.images, {});
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(lib, { recursive: true, force: true });
  });

  it('bibliothèque de démonstration du test de fumée : mêmes 8 éléments', async () => {
    const sources: LibrarySource[] = [
      { id: 'v', kind: 'video', location: path.join(DEMO, 'Vidéos') },
      { id: 'a', kind: 'audio', location: path.join(DEMO, 'Musique') },
      { id: 'i', kind: 'image', location: path.join(DEMO, 'Images') },
    ];
    const { catalog, config } = setup(sources);
    const { library } = await wireLocalPlugin({ config, catalog });
    const { items, status } = await library.scan();
    assert.equal(items.length, 8);
    assert.deepEqual(
      Object.values(status).map((s) => s.count),
      [4, 2, 2],
    );
    assert.deepEqual(byPath(items), byPath(before('demonstration').items));
  });

  it('formats du plugin : ceux du cœur', async () => {
    const formats = await import(pathToFileURL(path.join(PLUGIN_DIR, 'src', 'formats.mjs')).href);
    assert.deepEqual(formats.EXT, EXT);
    for (const [name, re] of Object.entries({ COVER_RE, ART_RE, FANART_RE })) assert.equal(String(formats[name]), String(re), name);
  });
});

describe('mire.source.network branché au cœur (dossiers temporaires présentés comme des partages)', () => {
  const wire = (o: { config: { get(): Config }; catalog: ReturnType<typeof createCatalog>; log?: (m: string) => void }) =>
    wireLocalPlugin({ ...o, plugin: 'network', asShares: true });

  it('installation existante : mêmes clés et mêmes éléments, rien de retiré ni d’ajouté, l’ancienne source `src-smb` part', async () => {
    const { catalog, changes, config } = setup(SOURCES);
    const old = before('arborescence', 'network');
    for (const s of old.sources) if (s.elements.length) catalog.setSource(s.ref, s.elements);
    const oldKeys = catalog.keys().sort();
    const oldElements = new Map(oldKeys.map((k) => [k, catalog.get(k)!]));
    assert.ok(oldKeys.length > 0);
    assert.ok(catalog.sources().every((r) => r.plugin === 'src-smb'));
    changes.splice(0);

    const logs: string[] = [];
    const { library } = await wire({ config, catalog, log: (m) => logs.push(m) });
    await library.scan();

    assert.deepEqual(catalog.keys().sort(), oldKeys);
    for (const k of oldKeys) {
      const e = catalog.get(k)!;
      const was = oldElements.get(k)!;
      assert.equal(e.source.plugin, 'mire.source.network', k);
      assert.equal(e.source.instance, was.source.instance, k);
      const subs = (x: typeof e) => ({ ...x.infos, subtitles: x.infos.subtitles ? [...(x.infos.subtitles as string[])].sort() : undefined });
      assert.deepEqual([e.name, e.open, e.tags, subs(e), e.images], [was.name, was.open, ['network'], subs(was), was.images], k);
    }
    assert.ok(catalog.sources().every((r) => r.plugin === 'mire.source.network'));
    for (const c of changes) {
      assert.deepEqual(c.removed, []);
      assert.deepEqual(c.added, []);
    }
    // Le partage absent : journal de l'analyse du plugin, rien d'autre.
    assert.ok(logs.length > 0 && logs.every((m) => m.includes('Partage réseau inaccessible')), logs.join('\n'));
  });

  it('interface historique : mêmes fichiers et même état des sources qu’avant', async () => {
    const { catalog, config } = setup(SOURCES);
    const old = before('arborescence', 'network');
    const { library } = await wire({ config, catalog });
    const now = await library.scan();
    assert.deepEqual(byPath(now.items), byPath(old.items));
    assert.deepEqual(now.status, old.status);
  });

  it('plugin désactivé : ses éléments disparaissent sans erreur, et reviennent à la réactivation', async () => {
    const { catalog, config } = setup(SOURCES.slice(0, 4));
    const logs: string[] = [];
    const plugin = await wire({ config, catalog, log: (m) => logs.push(m) });
    const first = await plugin.library.scan();
    const keys = catalog.keys().sort();
    assert.ok(keys.length > 0);

    await plugin.setEnabled(false);
    const off = await plugin.library.scan();
    assert.deepEqual(catalog.keys(), []);
    assert.deepEqual(off.items, []);
    assert.ok(Object.values(off.status).every((s) => s.ok && s.count === 0));

    await plugin.setEnabled(true);
    const on = await plugin.library.scan();
    assert.deepEqual(catalog.keys().sort(), keys);
    assert.deepEqual(byPath(on.items), byPath(first.items));
    assert.deepEqual(logs, []);
  });

  it('un partage n’est pas lu par `mire.source.local`, un dossier pas par `mire.source.network`', async () => {
    const shares = setup(SOURCES.slice(0, 1));
    await (await wireLocalPlugin({ ...shares, plugin: 'local', asShares: true })).library.scan();
    assert.equal(shares.catalog.size(), 0);
    const folders = setup(SOURCES.slice(0, 1));
    await (await wireLocalPlugin({ ...folders, plugin: 'network' })).library.scan();
    assert.equal(folders.catalog.size(), 0);
  });

  it('lien à l’intérieur d’un partage qui mène hors des dossiers accordés : écarté (fichier, dossier, affiche)', async (t) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-prive-'));
    fs.writeFileSync(path.join(outside, 'secret.mkv'), '');
    fs.writeFileSync(path.join(outside, 'secret.jpg'), '');
    const lib = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-partage-')));
    fs.writeFileSync(path.join(lib, 'Film.mkv'), '');
    try {
      fs.symlinkSync(path.join(outside, 'secret.mkv'), path.join(lib, 'lien.mkv'));
      fs.symlinkSync(path.join(outside, 'secret.jpg'), path.join(lib, 'Film.jpg'));
      fs.symlinkSync(outside, path.join(lib, 'Ailleurs'), 'dir');
    } catch {
      return t.skip('liens symboliques indisponibles');
    }
    const { catalog, config } = setup([src('films', 'video', lib)]);
    const { library } = await wire({ config, catalog });
    const { items } = await library.scan();
    assert.deepEqual(
      items.map((i) => [i.path, i.cover]),
      [[path.join(lib, 'Film.mkv'), null]],
    );
    assert.deepEqual(catalog.keys(), [localFileKey(path.join(lib, 'Film.mkv'))]);
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(lib, { recursive: true, force: true });
  });

  it('formats du plugin : ceux du cœur ; code commun identique à celui de `mire.source.local` (au tag près)', async () => {
    const dir = PLUGIN_DIRS.network;
    const formats = await import(pathToFileURL(path.join(dir, 'src', 'formats.mjs')).href);
    assert.deepEqual(formats.EXT, EXT);
    for (const [name, re] of Object.entries({ COVER_RE, ART_RE, FANART_RE })) assert.equal(String(formats[name]), String(re), name);
    const code = (d: string) =>
      fs.readFileSync(path.join(d, 'src', 'folder.mjs'), 'utf8').slice(fs.readFileSync(path.join(d, 'src', 'folder.mjs'), 'utf8').indexOf('import'));
    assert.equal(code(dir).replace("tags: ['network']", "tags: ['local']"), code(PLUGIN_DIR));
  });
});

describe('sous-titres : ceux trouvés à l’analyse sont ceux que la vidéo propose à l’ouverture', () => {
  it('dossier lu par mire.source.local, sous-titres par mire.subtitles', async () => {
    const { catalog, config } = setup(SOURCES.slice(0, 1));
    const { library } = await wireLocalPlugin({ config, catalog });
    await library.scan();
    const video = at('Films/Amélie (2001).mkv');
    const subs = catalog.get(localFileKey(video))?.infos.subtitles as string[];
    const found = await bundledSubtitles().bridges.subtitles(video);
    assert.equal(subs.length, 2);
    assert.equal(found.length, subs.length);
    assert.equal(catalog.get(localFileKey(at('Films/Sans affiche (1999).mp4')))?.infos.subtitles, undefined);
  });
});
