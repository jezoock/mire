// Parcours des pages d'index d'un serveur web (`net/crawl.ts`), sur un serveur local (127.0.0.1) : pages de style
// Apache et nginx, sans sortir du dossier de départ. Il sert aux sources en ligne d'une console (jusqu'à P5-14b) ;
// la bibliothèque passe par le plugin `mire.source.http` (P5-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlHttp } from '../../src/main/net/crawl.ts';
import { indexServer } from '../library/fixtures.ts';

const { base, close } = await indexServer();
test.after(close);

test('crawlHttp : chaque page visitée une fois, avec ses fichiers, sans sortir du dossier', async () => {
  const seen: [string, string, string[]][] = [];
  await crawlHttp(`${base}/films`, (dirUrl, dirName, files) => {
    seen.push([dirUrl, dirName, files.map((u) => u.pathname)]);
  });
  assert.deepEqual(seen, [
    [
      `${base}/films/`,
      'films',
      [
        '/films/Am%C3%A9lie%20(2001).mkv',
        '/films/Am%C3%A9lie%20(2001).jpg',
        '/films/Am%C3%A9lie%20(2001).fr.srt',
        '/films/Am%C3%A9lie%20(2001).en.vtt',
        '/films/fanart.jpg',
      ],
    ],
    [`${base}/films/S%C3%A9rie/`, 'Série', ['/films/S%C3%A9rie/S%C3%A9rie%20S01E04.mp4', '/films/S%C3%A9rie/cover.jpg', '/films/S%C3%A9rie/Photo.png']],
  ]);
});

test('crawlHttp : première page inaccessible → message affichable', async () => {
  await assert.rejects(
    crawlHttp(`${base}/absent/`, () => {}),
    { message: 'Adresse inaccessible (le serveur a répondu avec le code 404).' },
  );
});
