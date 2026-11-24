// Jeux des dossiers d'une console (repris de test/games/roms.test.ts de Mire, avant P5-14a) : extensions de la
// console, profondeur, fichiers cachés, disques cités par une liste .m3u masqués, jaquettes, tri ; contrat attendu par
// Mire : manifeste, emplacements acceptés, clés `rom:` d'avant l'extraction, rien hors des dossiers accordés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import createSource, { romElement } from '../src/source.mjs';
import { cleanRomName, nameOf, pathKey, romKey } from '../src/names.mjs';
import { decode, m3uRefs, safeRel } from '../src/playlists.mjs';
import { fakeContext } from './helpers.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-games-roms-')));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (rel, text = 'x') => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const manifest = JSON.parse(fs.readFileSync(new URL('../mire-plugin.json', import.meta.url), 'utf8'));
const SYSTEM = 'Nintendo - Super Nintendo Entertainment System';
const at = (dir, console = {}) => ({
  location: dir,
  path: dir,
  network: false,
  kinds: ['rom'],
  console: { id: 'snes', system: SYSTEM, extensions: ['.sfc', '.cue', '.m3u'], ...console },
});

test('manifeste : code limité, dossiers seulement, une source', () => {
  assert.equal(manifest.id, 'mire.games.roms');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.level, 'code');
  assert.deepEqual(manifest.permissions, { folders: true });
  assert.deepEqual(
    manifest.contributes.sources.map((s) => s.id),
    ['consoles'],
  );
});

test('emplacements acceptés : un dossier de console (type `rom` et console), rien d’autre', () => {
  const source = createSource(fakeContext().ctx);
  assert.equal(source.handles(at(root)), true);
  assert.equal(source.handles({ ...at(root), kinds: ['game'] }), false, 'dossier de jeux PC');
  assert.equal(source.handles({ ...at(root), kinds: ['video'] }), false, 'dossier de la bibliothèque');
  assert.equal(source.handles({ ...at(root), console: undefined }), false, 'sans console');
  assert.equal(
    source.handles({
      location: 'https://exemple.org/roms/',
      url: 'https://exemple.org/roms/',
      network: false,
      kinds: ['rom'],
      console: { id: 'snes', extensions: [] },
    }),
    false,
  );
  assert.equal(source.handles(null), false);
  assert.equal(source.instance(at(root)), root);
});

test('dossier de console : extensions, profondeur, fichiers cachés, disques d’un .m3u masqués, jaquettes, tri', async () => {
  const local = path.join(root, 'local');
  write('local/Zelda (Europe).sfc');
  write('local/Mario_World.sfc');
  write('local/notes.txt');
  write('local/.cache/Cache.sfc');
  write('local/.Cache.sfc');
  write('local/ps/Jeu.m3u', 'Jeu (Disque 1).cue\nDisques/Jeu (Disque 2).cue\n');
  write('local/ps/Jeu (Disque 1).cue');
  write('local/ps/Disques/Jeu (Disque 2).cue');
  write('local/ps/Autre.cue');
  write('local/1/2/3/4/Profond.sfc');
  write('local/1/2/3/4/5/TropProfond.sfc');
  const cover = write('images/Zelda (Europe).png');
  write('images/Mario World.jpg');
  const images = path.join(root, 'images');
  const { ctx } = fakeContext([local, images]);
  const els = await createSource(ctx).scan(at(local, { extensions: ['sfc', '.CUE', 'm3u'], images }));
  assert.deepEqual(
    els.map((e) => [e.name, path.relative(root, e.open.path)]),
    [
      ['Autre', path.join('local', 'ps', 'Autre.cue')],
      ['Jeu', path.join('local', 'ps', 'Jeu.m3u')],
      ['Mario World', path.join('local', 'Mario_World.sfc')],
      ['Profond', path.join('local', '1', '2', '3', '4', 'Profond.sfc')],
      ['Zelda', path.join('local', 'Zelda (Europe).sfc')],
    ],
  );
  const zelda = els.find((e) => e.name === 'Zelda');
  assert.deepEqual(zelda, {
    key: romKey('snes', path.join(local, 'Zelda (Europe).sfc')),
    name: 'Zelda',
    open: { kind: 'game', console: 'snes', path: path.join(local, 'Zelda (Europe).sfc') },
    tags: ['game'],
    infos: { system: SYSTEM },
    images: { poster: cover },
  });
  // Jaquette au nom nettoyé du jeu (« Mario World »).
  assert.equal(els.find((e) => e.name === 'Mario World').images.poster, path.join(images, 'Mario World.jpg'));
});

test('console sans extensions : tous les fichiers ; sans système ni jaquettes : ni info ni image', async () => {
  write('tout/A.bin');
  write('tout/B.iso');
  const els = await createSource(fakeContext().ctx).scan(at(path.join(root, 'tout'), { extensions: [], system: undefined }));
  assert.deepEqual(
    els.map((e) => [e.name, e.infos, e.images]),
    [
      ['A', {}, {}],
      ['B', {}, {}],
    ],
  );
});

test('dossier introuvable : erreur (Mire garde alors les jeux de l’analyse précédente)', async () => {
  await assert.rejects(createSource(fakeContext().ctx).scan(at(path.join(root, 'nulle-part'))));
});

test('rien hors des dossiers accordés : la liste .m3u qui cite un autre dossier ne fait rien lire de plus', async () => {
  const dir = path.join(root, 'accorde');
  write('accorde/Jeu.m3u', '../secret/Disque.cue\n/etc/passwd\nhttps://exemple.org/d.cue\n');
  write('secret/Disque.cue');
  const { ctx } = fakeContext([dir]);
  const els = await createSource(ctx).scan(at(dir));
  assert.deepEqual(
    els.map((e) => e.name),
    ['Jeu'],
  );
});

test('clés : celles du cœur de Mire (`rom:<console>|<chemin>`), Windows en minuscules avec des `/`', () => {
  assert.equal(romKey('snes', '/jeux/snes/Zelda.sfc'), 'rom:snes|/jeux/snes/Zelda.sfc');
  assert.equal(romKey('a|b', '/x/y.sfc'), 'rom:a%7Cb|/x/y.sfc');
  assert.equal(romKey('snes', 'D:\\Jeux\\SNES\\Zelda.SFC'), 'rom:snes|d:/jeux/snes/zelda.sfc');
  assert.equal(romKey('snes', '\\\\NAS\\Jeux\\Zelda.sfc'), 'rom:snes|//nas/jeux/zelda.sfc');
  assert.equal(pathKey('C:\\'), 'c:/');
  assert.equal(romElement({ id: 'snes', extensions: [] }, 'D:\\Jeux\\Zelda (Europe).sfc').name, 'Zelda');
});

test('noms et listes : nom nettoyé, chemins sûrs, Latin-1 des vieux fichiers', () => {
  assert.equal(nameOf('/a/b/Jeu (Disque 1).cue'), 'Jeu (Disque 1)');
  assert.equal(nameOf('C:\\a\\.cache'), '.cache');
  assert.equal(cleanRomName('Super Mario World (Europe) (En,Fr) [!]'), 'Super Mario World');
  assert.equal(safeRel('../x.cue'), null);
  assert.equal(safeRel('C:\\x.cue'), null);
  assert.equal(safeRel('./a\\b.cue'), 'a/b.cue');
  assert.deepEqual(m3uRefs('#EXTM3U\n"Disque 1.cue"\r\nhttps://x.org/d.cue\nDisque 1.cue\n'), ['Disque 1.cue']);
  assert.equal(decode(new Uint8Array([0x45, 0x74, 0xe9])), 'Eté');
  assert.equal(decode(new TextEncoder().encode('\uFEFFÉté')), 'Été');
});
