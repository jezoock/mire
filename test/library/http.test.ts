// Bibliothèque (P1-14) sur un serveur HTTP local (127.0.0.1) : pages d'index de style Apache et nginx,
// sous-titres à côté des vidéos, listes M3U, erreurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scanLibrary, findSubtitles, crawlHttp } from '../../src/main/library/index.ts';
import type { LibrarySource } from '@mire/shared';

const apache = (title: string, links: string[]) =>
  `<html><head><title>Index of ${title}</title></head><body><h1>Index of ${title}</h1><table>` +
  `<tr><td><a href="?C=N;O=D">Name</a></td></tr><tr><td><a href="/">Parent Directory</a></td></tr>` +
  links.map((l) => `<tr><td><a href="${l}">${decodeURIComponent(l)}</a></td></tr>`).join('') +
  '</table></body></html>';
const nginx = (title: string, links: string[]) =>
  `<html><head><title>Index of ${title}</title></head><body><h1>Index of ${title}</h1><hr><pre><a href="../">../</a>\n` +
  links.map((l) => `<a href='${l}'>${l}</a>  01-Jan-2026 10:00  1234\n`).join('') +
  '</pre><hr></body></html>';

const pages: Record<string, string> = {
  '/films/': apache('/films', [
    'Am%C3%A9lie%20(2001).mkv',
    'Am%C3%A9lie%20(2001).jpg',
    'Am%C3%A9lie%20(2001).fr.srt',
    'Am%C3%A9lie%20(2001).en.vtt',
    'fanart.jpg',
    'S%C3%A9rie/',
    'http://ailleurs/x.mkv',
    '/autre/y.mkv',
  ]),
  '/films/S%C3%A9rie/': nginx('/films/Série/', ['S%C3%A9rie%20S01E04.mp4', 'cover.jpg', 'Photo.png']),
  '/films/Am%C3%A9lie%20(2001).fr.srt': '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n',
  '/films/Am%C3%A9lie%20(2001).en.vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n',
  '/listes/chaines.m3u': '#EXTM3U\n#EXTINF:-1 tvg-logo="http://logo/a.png",Chaîne A\nhttp://flux/a\n#EXTINF:-1,Morceau\nmusique/b.mp3\nvideo/c.mkv\n',
};

const server = createServer((req, res) => {
  const body = pages[req.url as string];
  if (body === undefined) {
    res.writeHead(404).end('absent');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => server.close());

const src = (id: string, kind: LibrarySource['kind'], location: string): LibrarySource => ({ id, kind, location });

test('pages d’index Apache et nginx : sous-dossiers, affiches, fanart, épisodes, sans sortir du dossier', async () => {
  const { items, status } = await scanLibrary({ sources: [src('v', 'video', `${base}/films`), src('i', 'image', `${base}/films/`)] });
  // Deux sources sur le même dossier, déclarées avec et sans barre finale : deux emplacements distincts.
  assert.deepEqual(Object.keys(status), ['v', 'i']);
  const videos = items.filter((i) => i.kind === 'video');
  assert.deepEqual(
    videos.map((i) => i.name),
    ['Amélie (2001)', 'Série S01E04'],
  );
  const amelie = videos[0];
  assert.equal(amelie.path, `${base}/films/Am%C3%A9lie%20(2001).mkv`);
  assert.equal(amelie.remote, true);
  assert.equal(amelie.folder, 'films');
  assert.equal(amelie.cover, `${base}/films/Am%C3%A9lie%20(2001).jpg`);
  assert.equal(amelie.fanart, `${base}/films/fanart.jpg`);
  const ep = videos[1];
  assert.equal(ep.folder, 'Série');
  assert.equal(ep.dir, `${base}/films/S%C3%A9rie/`);
  assert.equal(ep.cover, `${base}/films/S%C3%A9rie/cover.jpg`);
  assert.deepEqual([ep.seriesTitle, ep.season, ep.episode], ['Série', 1, 4]);
  // Images : l'affiche d'Amélie, le fanart et la pochette sont écartés.
  assert.deepEqual(
    items.filter((i) => i.kind === 'image').map((i) => i.name),
    ['Photo'],
  );
  assert.equal(status.v.count, 2);
});

test('sous-titres trouvés à côté d’une vidéo en ligne, rendus avec le résultat de l’analyse', async () => {
  const { items, subtitles } = await scanLibrary({ sources: [src('v', 'video', `${base}/films/`)] });
  const video = items[0].path;
  assert.deepEqual(
    subtitles.get(video)?.map((s) => s.name),
    ['Amélie (2001).fr.srt', 'Amélie (2001).en.vtt'],
  );
  const subs = await findSubtitles(video, { remote: subtitles, isAllowed: () => false });
  assert.deepEqual(
    subs.map((s) => [s.label, s.lang]),
    [
      ['fr', 'fr'],
      ['en', 'en'],
    ],
  );
  assert.match(subs[0].vtt, /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000/);
  assert.deepEqual(await findSubtitles(`${base}/inconnue.mkv`, { remote: subtitles, isAllowed: () => true }), []);
});

// Une ligne sans #EXTINF a pour titre l'adresse telle qu'écrite dans la liste.
test('liste M3U : titres, logos, adresses relatives, type d’après l’extension', async () => {
  const url = `${base}/listes/chaines.m3u`;
  const { items, status } = await scanLibrary({ sources: [src('v', 'video', url), src('a', 'audio', url)] });
  assert.deepEqual(
    items.map((i) => [i.name, i.kind, i.path, i.native]),
    [
      ['Chaîne A', 'video', 'http://flux/a', true],
      ['Morceau', 'audio', `${base}/listes/musique/b.mp3`, true],
      ['video/c.mkv', 'video', `${base}/listes/video/c.mkv`, true],
    ],
  );
  assert.equal(items[0].cover, 'http://logo/a.png');
  assert.equal(items[0].folder, 'chaines');
  assert.deepEqual(status, { v: { ok: true, error: null, count: 2 }, a: { ok: true, error: null, count: 1 } });
});

test('erreurs : page d’index ou liste inaccessible', async () => {
  const { status } = await scanLibrary({ sources: [src('x', 'video', `${base}/absent/`), src('y', 'video', `${base}/absente.m3u`)] });
  assert.deepEqual(status.x, { ok: false, error: 'Adresse inaccessible (le serveur a répondu avec le code 404).', count: 0 });
  assert.deepEqual(status.y, { ok: false, error: 'Liste de lecture inaccessible.', count: 0 });
});

test('crawlHttp : chaque page visitée une fois, avec ses fichiers', async () => {
  const seen: [string, string, number][] = [];
  await crawlHttp(`${base}/films`, (dirUrl, dirName, files) => {
    seen.push([dirUrl, dirName, files.length]);
  });
  assert.deepEqual(seen, [
    [`${base}/films/`, 'films', 5],
    [`${base}/films/S%C3%A9rie/`, 'Série', 3],
  ]);
});
