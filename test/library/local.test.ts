// Bibliothèque (P1-14) sur dossiers temporaires : affiches, fanart, épisodes, images d'illustration ignorées,
// profondeur, dossiers cachés ; regroupement des sources, marque-pages, sous-titres locaux, fichiers ouverts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanLibrary, findSubtitles, itemFromPath, MAX_ITEMS } from '../../src/main/library/index.ts';
import type { LibraryItem } from '../../src/main/library/index.ts';
import type { Bookmark, LibrarySource } from '@mire/shared';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-library-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function touch(rel: string, content = '') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const deep = Array.from({ length: 17 }, (_, i) => `n${i + 1}`);
[
  'Films/Amélie (2001).mkv',
  'Films/Amélie (2001).jpg',
  'Films/Amélie (2001)-fanart.jpg',
  'Films/Sans affiche (1999).mp4',
  'Films/poster.jpg',
  'Films/fanart.jpg',
  'Films/Photo de tournage.png',
  'Films/notes.txt',
  'Films/.cachée.mkv',
  'Films/.cache/Caché.mkv',
  'Films/$RECYCLE.BIN/Supprimé.mkv',
  'Séries/Ma Série/Saison 1/Ma Série S01E02.mkv',
  'Musique/Album/01 - Début.mp3',
  'Musique/Album/cover.jpg',
  'Images/Vacances/Plage.png',
  'Images/Vacances/folder.jpg',
  'Images/Vacances/Plage-thumb.png',
  `Profond/${deep.slice(0, 16).join('/')}/Niveau 16.mkv`,
  `Profond/${deep.join('/')}/Niveau 17.mkv`,
].forEach((rel) => touch(rel));

const src = (id: string, kind: LibrarySource['kind'], rel: string): LibrarySource => ({ id, kind, location: path.join(root, rel) });
const byName = (items: LibraryItem[]) => new Map(items.map((i) => [i.name, i]));

test('vidéos : affiche et fanart du même nom, sinon ceux du dossier ; images d’illustration et cachés ignorés', async () => {
  const { items, status } = await scanLibrary({ sources: [src('films', 'video', 'Films'), src('photos', 'image', 'Films')] });
  const m = byName(items);
  assert.deepEqual([...m.keys()].sort(), ['Amélie (2001)', 'Photo de tournage', 'Sans affiche (1999)']);
  const amelie = m.get('Amélie (2001)') as LibraryItem;
  assert.equal(amelie.cover, path.join(root, 'Films/Amélie (2001).jpg'));
  assert.equal(amelie.fanart, path.join(root, 'Films/Amélie (2001)-fanart.jpg'));
  assert.equal(amelie.native, true);
  assert.equal(amelie.folder, 'Films');
  const other = m.get('Sans affiche (1999)') as LibraryItem;
  assert.equal(other.cover, path.join(root, 'Films/poster.jpg'));
  assert.equal(other.fanart, path.join(root, 'Films/fanart.jpg'));
  // Une même source pour deux types n'est parcourue qu'une fois ; chaque type compte les siens.
  assert.deepEqual(status, { films: { ok: true, error: null, count: 2 }, photos: { ok: true, error: null, count: 1 } });
});

test('épisodes : titre de la série, saison et épisode', async () => {
  const { items } = await scanLibrary({ sources: [src('series', 'video', 'Séries')] });
  assert.equal(items.length, 1);
  assert.equal(items[0].seriesTitle, 'Ma Série');
  assert.equal(items[0].season, 1);
  assert.equal(items[0].episode, 2);
});

test('musique et images : pochette de dossier, illustrations écartées', async () => {
  const { items } = await scanLibrary({ sources: [src('m', 'audio', 'Musique'), src('i', 'image', 'Images')] });
  const m = byName(items);
  assert.deepEqual([...m.keys()].sort(), ['01 - Début', 'Plage', 'Plage-thumb']);
  assert.equal(m.get('01 - Début')?.cover, path.join(root, 'Musique/Album/cover.jpg'));
});

test('profondeur : 16 niveaux sous la source au plus', async () => {
  const { items } = await scanLibrary({ sources: [src('p', 'video', 'Profond')] });
  assert.deepEqual(
    items.map((i) => i.name),
    ['Niveau 16'],
  );
});

test('nombre maximal d’éléments', async () => {
  const { items } = await scanLibrary({ sources: [src('films', 'video', 'Films')], maxItems: 1 });
  assert.equal(items.length, 1);
  assert.equal(MAX_ITEMS, 150000);
});

test('source introuvable : erreur affichable, les autres sources continuent', async () => {
  const { items, status } = await scanLibrary({ sources: [src('x', 'video', 'Absent'), src('m', 'audio', 'Musique')] });
  assert.equal(items.length, 1);
  assert.deepEqual(status.x, { ok: false, error: `Dossier introuvable : ${path.join(root, 'Absent')}`, count: 0 });
  assert.equal(status.m.count, 1);
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

test('sous-titres locaux : langue, conversion SRT, vidéo hors des dossiers autorisés', async () => {
  const video = path.join(root, 'Sous-titres/Film.mkv');
  touch('Sous-titres/Film.mkv');
  touch('Sous-titres/Film.fr.srt', '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n');
  touch('Sous-titres/Film.vtt', 'WEBVTT\n');
  touch('Sous-titres/Autre.srt', '');
  const subs = await findSubtitles(video, { remote: new Map(), isAllowed: () => true });
  const fr = subs.find((s) => s.lang === 'fr');
  assert.equal(subs.length, 2);
  assert.equal(fr?.label, 'fr');
  assert.match(fr?.vtt as string, /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000/);
  assert.equal(subs.find((s) => !s.lang)?.label, 'Sous-titres');
  assert.deepEqual(await findSubtitles(video, { remote: new Map(), isAllowed: () => false }), []);
});

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

// Bibliothèque factice du test de fumée (P0-09) : 8 éléments avec le code d'avant la refacto (src/main/index.js).
test('bibliothèque factice du test de fumée : mêmes éléments qu’avant', async () => {
  const fixtures = path.join(import.meta.dirname, '../e2e/fixtures/bibliotheque');
  const sources: LibrarySource[] = [
    { id: 'v', kind: 'video', location: path.join(fixtures, 'Vidéos') },
    { id: 'a', kind: 'audio', location: path.join(fixtures, 'Musique') },
    { id: 'i', kind: 'image', location: path.join(fixtures, 'Images') },
  ];
  const { items, status } = await scanLibrary({ sources });
  assert.equal(items.length, 8);
  assert.deepEqual(
    Object.values(status).map((s) => s.count),
    [4, 2, 2],
  );
  const series = items.filter((i) => i.seriesTitle === 'Série').map((i) => [i.season, i.episode]);
  assert.deepEqual(series, [
    [1, 1],
    [1, 2],
  ]);
});
