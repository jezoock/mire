// Recherche des sous-titres posés à côté d'une vidéo (reprise du test « sous-titres locaux » de
// test/library/local.test.ts de Mire, avant P5-11b) : le contexte simulé rend les fichiers d'un dossier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import createSubtitles, { describe, splitPath, stemOf } from '../src/subtitles.mjs';

const manifest = JSON.parse(readFileSync(new URL('../mire-plugin.json', import.meta.url), 'utf8'));

/** Contexte : `walk` rend les fichiers de `files` (chemin → rien) sous le dossier demandé ; les appels sont notés. */
function fakeContext(files, { fail = false } = {}) {
  const calls = [];
  const ctx = {
    id: 'mire.subtitles',
    files: {
      async walk(root, options) {
        calls.push({ root, options });
        if (fail) throw new Error('This folder has not been granted to the plugin.');
        return files.filter((p) => splitPath(p).dir === root).map((p) => ({ path: p, size: 10, modified: 0 }));
      },
    },
  };
  return { ctx, calls };
}

test('manifeste : niveau code, une seule permission (dossiers), la contribution de la règle P5-11b', () => {
  assert.equal(manifest.id, 'mire.subtitles');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.level, 'code');
  assert.deepEqual(manifest.permissions, { folders: true });
  assert.deepEqual(manifest.contributes, { subtitles: [{ id: 'sidecar', main: 'src/subtitles.mjs' }] });
  assert.equal(createSubtitles(fakeContext([]).ctx).id, 'sidecar');
});

test('sous-titres du dossier de la vidéo : nom qui commence par celui de la vidéo, langue, libellé', async () => {
  const { ctx, calls } = fakeContext(['/films/Film.mkv', '/films/Film.fr.srt', '/films/Film.vtt', '/films/Film.nfo', '/films/film_EN.SRT', '/films/Autre.srt']);
  const found = await createSubtitles(ctx).find('/films/Film.mkv');
  assert.deepEqual(found, [
    { path: '/films/Film.fr.srt', lang: 'fr', label: 'fr' },
    { path: '/films/Film.vtt', lang: '', label: '' },
    { path: '/films/film_EN.SRT', lang: 'en', label: 'EN' },
  ]);
  // Seulement le dossier de la vidéo, sans ses sous-dossiers, et seulement les .srt et .vtt.
  assert.deepEqual(calls, [{ root: '/films', options: { extensions: ['srt', 'vtt'], depth: 0, limit: 10000 } }]);
});

test('chemins Windows et fichier à la racine', async () => {
  const { ctx, calls } = fakeContext(['D:\\Films\\Alien.mkv', 'D:\\Films\\Alien.forced.fr.srt']);
  assert.deepEqual(await createSubtitles(ctx).find('D:\\Films\\Alien.mkv'), [{ path: 'D:\\Films\\Alien.forced.fr.srt', lang: '', label: 'forced.fr' }]);
  assert.equal(calls[0].root, 'D:\\Films');
  assert.deepEqual(splitPath('C:\\Film.mkv'), { dir: 'C:\\', name: 'Film.mkv' });
  assert.deepEqual(splitPath('/Film.mkv'), { dir: '/', name: 'Film.mkv' });
  assert.deepEqual(splitPath('\\\\NAS\\films\\Film.mkv'), { dir: '\\\\NAS\\films', name: 'Film.mkv' });
});

test('nom et langue', () => {
  assert.equal(stemOf('Film.fr.srt'), 'Film.fr');
  assert.equal(stemOf('.cache'), '.cache');
  assert.deepEqual(describe(''), { lang: '', label: '' });
  assert.deepEqual(describe('pt-BR'), { lang: 'pt', label: 'pt-BR' });
  assert.deepEqual(describe('francais'), { lang: '', label: 'francais' });
});

test('dossier refusé ou illisible, chemin invalide : aucun sous-titre, sans erreur', async () => {
  assert.deepEqual(await createSubtitles(fakeContext([], { fail: true }).ctx).find('/films/Film.mkv'), []);
  const { ctx, calls } = fakeContext([]);
  for (const bad of [undefined, null, 42, '']) assert.deepEqual(await createSubtitles(ctx).find(bad), []);
  assert.equal(calls.length, 0);
});
