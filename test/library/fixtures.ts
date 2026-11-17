// Dossiers de test de la bibliothèque, partagés par ses tests : une arborescence de fichiers vides (affiches, fanart,
// épisodes, images d'illustration, fichiers cachés, profondeur) et un serveur d'index local (Apache, nginx, M3U).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LibraryTree {
  root: string;
  /** Crée un fichier sous la racine et rend son chemin. */
  touch(rel: string, content?: string): string;
  remove(): void;
}

/** Arborescence de test dans un dossier temporaire. */
export function libraryTree(): LibraryTree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-library-'));
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
  return { root, touch, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

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

/** Serveur d'index sur 127.0.0.1 (port libre). */
export async function indexServer(): Promise<{ base: string; close(): void }> {
  const server = createServer((req, res) => {
    const body = pages[req.url as string];
    if (body === undefined) {
      res.writeHead(404).end('absent');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
