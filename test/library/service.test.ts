// Bibliothèque vue du reste de l'application (reprise de scanLibrary / findSubtitles / itemFromPath de l'ancien
// index.js) : l'analyse garde les sous-titres des vidéos en ligne pour la recherche de sous-titres.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLibraryService } from '../../src/main/library/service.ts';

// Seule adresse servie pendant ces tests : le sous-titre trouvé par l'analyse ; tout autre accès réseau échoue.
const SRT = 'https://ex.org/films/Alien.fr.srt';
globalThis.fetch = (async (url: string) => {
  if (String(url) !== SRT) throw new Error('accès réseau interdit pendant les tests');
  return new Response('1\n00:00:01,000 --> 00:00:02,000\nBonjour\n');
}) as typeof fetch;

describe('createLibraryService', () => {
  it('analyse les sources et marque-pages de la configuration, et garde les sous-titres en ligne', async () => {
    const seen: unknown[] = [];
    const sub = { url: SRT, name: 'Alien.fr.srt', base: 'Alien' };
    const library = createLibraryService({
      config: { get: () => ({ library: { sources: [{ location: 'https://ex.org/films/' }] }, bookmarks: [{ id: 'b' }] }) as never },
      access: { allowFile: () => {}, isAllowed: () => false },
      scan: async (opts) => {
        seen.push(opts);
        return { items: [], status: { s: { count: 0 } } as never, subtitles: new Map([['https://ex.org/films/Alien.mkv', [sub]]]) as never };
      },
    });
    assert.deepEqual(await library.findSubtitles('https://ex.org/films/Alien.mkv'), []);
    assert.deepEqual(await library.scan(), { items: [], status: { s: { count: 0 } } });
    assert.deepEqual(seen, [{ sources: [{ location: 'https://ex.org/films/' }], bookmarks: [{ id: 'b' }] }]);
    const found = await library.findSubtitles('https://ex.org/films/Alien.mkv');
    assert.equal(found.length, 1);
    assert.match(JSON.stringify(found[0]), /WEBVTT/);
  });

  it('vidéo locale hors des dossiers autorisés : pas de sous-titres ; fichier ouvert : autorisé', async () => {
    const allowed: string[] = [];
    const library = createLibraryService({
      config: { get: () => ({ library: { sources: [] }, bookmarks: [] }) as never },
      access: { allowFile: (f) => allowed.push(f), isAllowed: () => false },
    });
    assert.deepEqual(await library.findSubtitles('/home/moi/.ssh/film.mkv'), []);
    assert.equal(await library.itemFromPath(42), null);
    assert.equal(await library.itemFromPath('/chemin/introuvable.mkv'), null);
    assert.deepEqual(allowed, []);
  });

  it('emplacement lu par un plugin : son état est vérifié pendant les analyses des plugins, pas après (un partage absent n’attend qu’une fois)', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-etat-')), 'Partage');
    const sources = [{ id: 'nas', kind: 'video', location: dir }];
    const catalog = { setSource: () => {}, removeSource: () => {}, sources: () => [], keysOf: () => [], get: () => undefined };
    const library = createLibraryService({
      config: { get: () => ({ library: { sources }, bookmarks: [] }) as never },
      access: { allowFile: () => {}, isAllowed: () => true },
      catalog: catalog as never,
      claimed: () => true,
      // Le partage apparaît pendant l'analyse du plugin : l'état, vérifié en même temps, est celui du début.
      pluginScans: async () => {
        await sleep(50);
        fs.mkdirSync(dir);
      },
    });
    const { status } = await library.scan();
    assert.equal(status.nas.ok, false);
    assert.match(status.nas.error!, /introuvable/);
    // Analyse suivante : il est là.
    assert.equal((await library.scan({ plugins: false })).status.nas.ok, true);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });
});
