// Règles des clés stables des éléments (P2-01) : une clé ne dépend ni du rang ni du nom affiché, reste la même
// après une nouvelle analyse, et suit les règles de chemin de Windows et de POSIX.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookmarkKey,
  fileKey,
  gameBookmarkKey,
  joinKey,
  keyGenre,
  localFileKey,
  m3uEntryKey,
  normalizePath,
  normalizeUrl,
  pcGameKey,
  remoteFileKey,
  romKey,
  siteKey,
  tvChannelKey,
} from '../../src/main/catalog/keys.ts';

describe('clés : chemins', () => {
  it('chemin POSIX : normalisé, casse gardée', () => {
    assert.equal(localFileKey('/films/Intouchables.mkv', 'linux'), 'local:/films/Intouchables.mkv');
    assert.equal(localFileKey('/films//./séries/../Intouchables.mkv', 'linux'), 'local:/films/Intouchables.mkv');
    assert.notEqual(localFileKey('/films/a.mkv', 'linux'), localFileKey('/films/A.mkv', 'linux'));
    assert.equal(normalizePath('/films/', 'darwin'), '/films');
    assert.equal(normalizePath('/', 'linux'), '/');
  });

  it('chemin Windows : sans casse, séparateurs « / », quelle que soit la façon de l’écrire', () => {
    const key = 'local:c:/films/intouchables.mkv';
    assert.equal(localFileKey('C:\\Films\\Intouchables.mkv', 'win32'), key);
    assert.equal(localFileKey('c:/films/INTOUCHABLES.mkv', 'win32'), key);
    assert.equal(localFileKey('C:\\Films\\Séries\\..\\.\\Intouchables.mkv', 'win32'), key);
    assert.equal(normalizePath('C:\\', 'win32'), 'c:/');
    assert.equal(normalizePath('D:\\Jeux\\', 'win32'), 'd:/jeux');
  });

  it('partage réseau Windows : même clé avec des barres obliques ou inverses', () => {
    assert.equal(localFileKey('\\\\NAS\\Films\\A.mkv', 'win32'), 'local://nas/films/a.mkv');
    assert.equal(localFileKey('//nas/films/a.mkv', 'win32'), 'local://nas/films/a.mkv');
  });

  it('refuse un chemin vide', () => {
    assert.throws(() => localFileKey('  ', 'linux'), /chemin manquant/);
  });
});

describe('clés : adresses', () => {
  it('fichier d’un serveur web : schéma et hôte sans casse, port par défaut et fragment retirés', () => {
    const key = 'remote:https://nas.local/Films/A%20b.mkv';
    assert.equal(remoteFileKey('https://nas.local/Films/A%20b.mkv'), key);
    assert.equal(remoteFileKey('HTTPS://NAS.local:443/Films/A b.mkv#t=10'), key);
    assert.equal(normalizeUrl('http://nas/a/../b.mkv'), 'http://nas/b.mkv');
  });

  it('fileKey choisit la règle d’après le chemin', () => {
    assert.equal(fileKey('https://nas/a.mkv', 'linux'), 'remote:https://nas/a.mkv');
    assert.equal(fileKey('/films/a.mkv', 'linux'), 'local:/films/a.mkv');
  });
});

describe('clés : genres d’éléments', () => {
  it('entrée M3U : la liste et l’adresse du flux, sans le titre ni la position', () => {
    const a = m3uEntryKey('https://box/liste.m3u', 'http://box/stream?id=1', 'linux');
    assert.equal(a, 'm3u:https://box/liste.m3u|http://box/stream?id=1');
    assert.equal(m3uEntryKey('C:\\Listes\\TV.m3u', 'http://box/1', 'win32'), 'm3u:c:/listes/tv.m3u|http://box/1');
    assert.notEqual(a, m3uEntryKey('https://box/autre.m3u', 'http://box/stream?id=1', 'linux'));
  });

  it('jeu de console : console et fichier, local ou en ligne', () => {
    assert.equal(romKey('retroarch:snes', 'D:\\ROMs\\SNES\\Zelda.sfc', 'win32'), 'rom:retroarch:snes|d:/roms/snes/zelda.sfc');
    assert.equal(romKey('snes-4f2a', 'https://roms.example/snes/Zelda.zip', 'linux'), 'rom:snes-4f2a|https://roms.example/snes/Zelda.zip');
    assert.throws(() => romKey('', '/a.sfc', 'linux'), /console manquant/);
  });

  it('jeu PC : chemin du programme, que le jeu soit trouvé dans un dossier ou ajouté à la main', () => {
    assert.equal(pcGameKey('C:\\Games\\Celeste\\Celeste.exe', 'win32'), 'pc:c:/games/celeste/celeste.exe');
    assert.equal(pcGameKey('c:/games/celeste/Celeste.exe', 'win32'), pcGameKey('C:\\Games\\Celeste\\Celeste.exe', 'win32'));
  });

  it('chaîne de télévision : numéro chez le service, sinon la plus petite adresse de ses flux', () => {
    assert.equal(tvChannelKey('freebox', { number: 2, urls: ['rtsp://x/sd', 'rtsp://x/hd'] }), 'tv:freebox|2');
    const sans = tvChannelKey('m3u-1', { number: null, urls: ['http://b/2', 'http://a/1'] });
    assert.equal(sans, 'tv:m3u-1|http://a/1');
    assert.equal(tvChannelKey('m3u-1', { number: null, urls: ['http://a/1', 'http://b/2'] }), sans);
  });

  it('site et marque-pages : leur identifiant stable', () => {
    assert.equal(siteKey('netflix'), 'web:netflix');
    assert.equal(bookmarkKey('a1b2c3'), 'bm:a1b2c3');
    assert.equal(gameBookmarkKey('d4e5f6'), 'gamebm:d4e5f6');
  });

  it('échappe % et | sauf dans la dernière partie : deux suites de parties différentes ne donnent jamais la même clé', () => {
    assert.equal(joinKey('rom', 'a|b', 'c'), 'rom:a%7Cb|c');
    assert.notEqual(joinKey('rom', 'a|b', 'c'), joinKey('rom', 'a', 'b|c'));
    assert.notEqual(joinKey('rom', 'a%7Cb', 'c'), joinKey('rom', 'a|b', 'c'));
    assert.equal(joinKey('m3u', 'https://box/a%20b.m3u', 'http://box/1|2'), 'm3u:https://box/a%2520b.m3u|http://box/1|2');
    assert.equal(joinKey('local', '/films/100%.mkv'), 'local:/films/100%.mkv');
  });

  it('keyGenre retrouve le genre d’une clé', () => {
    assert.equal(keyGenre('web:netflix'), 'site');
    assert.equal(keyGenre('local:/a'), 'local');
    assert.equal(keyGenre('inconnu:a'), null);
  });
});

describe('clés : stabilité', () => {
  // Ce que donne une analyse : les mêmes fichiers, dans un autre ordre, avec d'autres noms affichés.
  const scan = (files: { path: string; name: string }[]) => new Map(files.map((f) => [fileKey(f.path, 'win32'), f.name]));

  it('mêmes clés après une nouvelle analyse, quel que soit l’ordre et le nom affiché', () => {
    const first = scan([
      { path: 'C:\\Films\\Alien.mkv', name: 'Alien' },
      { path: 'C:\\Films\\Brazil.mkv', name: 'Brazil' },
      { path: 'https://nas/films/Casino.mkv', name: 'Casino' },
    ]);
    const again = scan([
      { path: 'https://NAS/films/Casino.mkv', name: 'Casino (1995)' },
      { path: 'c:/films/brazil.mkv', name: 'Brazil, director’s cut' },
      { path: 'C:\\Films\\Alien.mkv', name: 'Le huitième passager' },
    ]);
    assert.deepEqual([...again.keys()].sort(), [...first.keys()].sort());
  });
});
