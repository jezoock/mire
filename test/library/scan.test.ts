// Analyse de la bibliothèque (P1-14) : regroupement des sources, nombre maximal d'éléments, état des sources (dossier
// ou partage introuvable), marque-pages, fichiers ouverts. Les dossiers et les partages réseau sont lus par les plugins
// inclus `mire.source.local` (P5-11c) et `mire.source.network` (P5-11d), testés dans plugins/<id>/test/ et
// test/library/plugin-folders.test.ts ; ici, le cœur est vérifié avec un fournisseur factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanLibrary as scanWith, DEFAULT_PROVIDERS, itemFromPath, MAX_ITEMS, resolveLocation } from '../../src/main/library/index.ts';
import type { ScanOptions } from '../../src/main/library/index.ts';
import type { Bookmark, LibrarySource } from '@mire/shared';
import { fakeFolderProvider, libraryTree } from './fixtures.ts';

const { root, remove } = libraryTree();
const scanLibrary = (o: ScanOptions) => scanWith({ providers: [fakeFolderProvider], ...o });
test.after(remove);

const src = (id: string, kind: LibrarySource['kind'], rel: string): LibrarySource => ({ id, kind, location: path.join(root, rel) });

test('une même source pour deux types n’est parcourue qu’une fois ; chaque type compte les siens', async () => {
  let scans = 0;
  const counting = { ...fakeFolderProvider, scan: (...a: Parameters<typeof fakeFolderProvider.scan>) => (scans++, fakeFolderProvider.scan(...a)) };
  const { items, status } = await scanWith({ providers: [counting], sources: [src('films', 'video', 'Films'), src('photos', 'image', 'Films')] });
  assert.equal(scans, 1);
  // Le fournisseur factice ne met pas les affiches à part : toutes les images comptent.
  assert.deepEqual(
    items.filter((i) => i.kind === 'video').map((i) => i.name),
    ['Amélie (2001)', 'Sans affiche (1999)'],
  );
  assert.deepEqual(status, { films: { ok: true, error: null, count: 2 }, photos: { ok: true, error: null, count: 5 } });
});

test('nombre maximal d’éléments', async () => {
  const { items } = await scanLibrary({ sources: [src('films', 'video', 'Films')], maxItems: 1 });
  assert.equal(items.length, 1);
  assert.equal(MAX_ITEMS, 150000);
});

test('source en échec : erreur affichable, les autres sources continuent', async () => {
  const { items, status } = await scanLibrary({ sources: [src('x', 'video', 'Absent'), src('m', 'audio', 'Musique')] });
  assert.equal(items.length, 1);
  assert.deepEqual(status.x, { ok: false, error: `Introuvable : ${path.join(root, 'Absent')}`, count: 0 });
  assert.equal(status.m.count, 1);
});

test('dossier ou partage qu’aucune source ne lit (plugin désactivé) : ni élément ni erreur', async () => {
  assert.deepEqual(DEFAULT_PROVIDERS.map((p) => p.id).sort(), ['http-index', 'm3u']);
  const { items, status } = await scanWith({ sources: [src('films', 'video', 'Films'), { id: 'nas', kind: 'video', location: '\\\\NAS-absent\\Films' }] });
  assert.deepEqual(items, []);
  assert.deepEqual(status, { films: { ok: true, error: null, count: 0 }, nas: { ok: true, error: null, count: 0 } });
});

test('emplacement lu par un plugin : le cœur donne son état (dossier introuvable, partage inaccessible)', async () => {
  const nas = 'smb://nas-absent.invalid/films';
  const sources: LibrarySource[] = [src('x', 'video', 'Absent'), src('films', 'video', 'Films'), { id: 'nas', kind: 'video', location: nas }];
  const { status } = await scanWith({ sources, pluginItems: () => [] });
  assert.deepEqual(status.x, { ok: false, error: `Dossier introuvable : ${path.join(root, 'Absent')}`, count: 0 });
  assert.deepEqual(status.films, { ok: true, error: null, count: 0 });
  assert.equal(resolveLocation(nas).type, 'path');
  assert.deepEqual(status.nas, {
    ok: false,
    error: `Partage réseau inaccessible : ${nas}. Vérifiez que l’ordinateur du partage est allumé et que vous y êtes connecté.`,
    count: 0,
  });
  // État déjà vérifié (pendant les analyses des plugins) : pas de seconde vérification.
  const asked: string[] = [];
  const again = await scanWith({ sources, pluginItems: () => [], unreachable: async (t) => (asked.push(t.location), null) });
  assert.deepEqual(asked, [path.join(root, 'Absent'), path.join(root, 'Films'), nas]);
  assert.ok(Object.values(again.status).every((s) => s.ok));
});

test('marque-pages de streaming ajoutés comme des vidéos', async () => {
  const bookmarks: Bookmark[] = [
    { id: 'b1', url: 'https://site/serie', title: 'Une série', type: 'tv', season: 2, episode: 3, site: 'Site', added: 0 },
    { id: 'b2', url: 'https://site/film', title: '', type: 'movie', season: null, episode: null, site: '', added: 0 },
  ];
  const { items } = await scanLibrary({ sources: [], bookmarks });
  assert.deepEqual(items[0], {
    path: 'https://site/serie',
    name: 'Une série',
    ext: '',
    kind: 'video',
    folder: 'Site',
    dir: 'Site',
    native: false,
    cover: null,
    fanart: null,
    bookmark: true,
    bookmarkId: 'b1',
    series: true,
    seriesTitle: 'Une série',
    season: 2,
    episode: 3,
    bookmarkType: 'tv',
  });
  assert.equal(items[1].name, 'https://site/film');
  assert.equal(items[1].folder, 'Streaming');
  assert.equal(items[1].seriesTitle, undefined);
  assert.equal(items[1].season, null);
});

// Sous-titres posés à côté d'une vidéo : plugin inclus mire.subtitles (P5-11b), testé dans
// plugins/mire.subtitles/test/ et test/plugins/subtitles.test.ts.

test('fichier ouvert : élément, pochette autorisée avec lui', async () => {
  const allowed: string[] = [];
  const allowFile = (f: string) => allowed.push(f);
  const item = await itemFromPath(path.join(root, 'Musique/Album/01 - Début.mp3'), { allowFile });
  assert.equal(item?.kind, 'audio');
  assert.equal(item?.cover, path.join(root, 'Musique/Album/cover.jpg'));
  assert.deepEqual(allowed, [path.join(root, 'Musique/Album/01 - Début.mp3'), path.join(root, 'Musique/Album/cover.jpg')]);
  assert.equal(await itemFromPath(path.join(root, 'Films/notes.txt'), { allowFile }), null);
  assert.equal(await itemFromPath(path.join(root, 'Films'), { allowFile }), null);
  assert.equal(await itemFromPath(42, { allowFile }), null);
});

// Bibliothèque factice du test de fumée (P0-09) : lue par le plugin `mire.source.local`
// (test/library/plugin-folders.test.ts).
