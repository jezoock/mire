// Jeux PC des dossiers de jeux (repris de test/games/pc.test.ts de Mire, avant P5-13) : raccourcis et exécutables
// posés dans le dossier, choix de l'exécutable d'un sous-dossier, utilitaires ignorés, extensions de chaque système ;
// contrat attendu par Mire : manifeste, emplacements acceptés, clés `pc:` d'avant l'extraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import createFolders, { pcGameKey } from '../src/folders.mjs';
import { gamesIn, similarity } from '../src/scan.mjs';
import { fakeContext } from './helpers.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-games-pc-')));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (rel, size = 1) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size));
  return file;
};
const manifest = JSON.parse(fs.readFileSync(new URL('../mire-plugin.json', import.meta.url), 'utf8'));
const at = (dir) => ({ location: dir, path: dir, network: false, kinds: ['game'] });
const scan = async (dir, platform) => createFolders(fakeContext().ctx, platform).scan(at(dir));

test('manifeste : code sensible (programmes), dossiers, une source', () => {
  assert.equal(manifest.id, 'mire.games.pc');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.level, 'privileged');
  assert.deepEqual(manifest.permissions, { folders: true, launch: true });
  assert.deepEqual(manifest.contributes, { sources: [{ id: 'folders', main: 'src/folders.mjs' }] });
});

test('handles : seulement un dossier de jeux (type `game`), ni un dossier de films, ni une adresse', () => {
  const src = createFolders(fakeContext().ctx, 'linux');
  assert.equal(src.handles(at('/jeux')), true);
  assert.equal(src.handles({ location: '/films', path: '/films', network: false, kinds: ['video'] }), false);
  assert.equal(src.handles({ location: 'https://x.org/', url: 'https://x.org/', network: false, kinds: ['game'] }), false);
  assert.equal(src.handles(null), false);
});

test('meilleur exécutable : nom proche du dossier, puis le plus gros ; utilitaires, raccourcis et redistribuables écartés', async () => {
  write('choix/Super Jeu/unins000.exe', 5000);
  write('choix/Super Jeu/UnityCrashHandler64.exe', 5000);
  write('choix/Super Jeu/Super Jeu.lnk', 5000);
  write('choix/Super Jeu/_CommonRedist/vcredist.exe', 9000);
  write('choix/Super Jeu/redist/autre.exe', 9000);
  write('choix/Super Jeu/outil.exe', 100);
  const main = write('choix/Super Jeu/bin/SuperJeu.exe', 10);
  write('choix/Zzz/a.exe', 10);
  const big = write('choix/Zzz/b.exe', 500);
  // Trop profond (plus de trois niveaux) : ignoré.
  write('choix/Profond/1/2/3/Profond.exe');
  const games = await scan(path.join(root, 'choix'), 'win32');
  assert.deepEqual(
    games.map((g) => [g.name, g.open.path]),
    [
      ['Super Jeu', main],
      ['Zzz', big],
    ],
  );
});

test('un jeu par raccourci, par exécutable ou par sous-dossier, triés ; éléments et clés comme avant', async () => {
  write('jeux/Mon_jeu.exe');
  write('jeux/Raccourci.lnk');
  write('jeux/setup.exe');
  write('jeux/.cache/x.exe');
  write('jeux/lisezmoi.txt');
  const exe = write('jeux/Aventure/Aventure.exe');
  fs.mkdirSync(path.join(root, 'jeux', 'Vide'), { recursive: true });
  const games = await scan(path.join(root, 'jeux'), 'win32');
  assert.deepEqual(
    games.map((g) => [g.name, path.relative(root, g.open.path)]),
    [
      ['Aventure', path.relative(root, exe)],
      ['Mon jeu', path.join('jeux', 'Mon_jeu.exe')],
      ['Raccourci', path.join('jeux', 'Raccourci.lnk')],
    ],
  );
  assert.deepEqual(games[0], {
    key: pcGameKey(exe, 'win32'),
    name: 'Aventure',
    open: { kind: 'program', path: exe },
    tags: ['game'],
    infos: { system: 'pc' },
    images: {},
  });
});

test('extensions propres à Linux et à macOS', async () => {
  write('linux/Jeu.appimage');
  write('linux/Jeu.exe');
  const linux = await scan(path.join(root, 'linux'), 'linux');
  assert.deepEqual(
    linux.map((g) => [g.name, path.extname(g.open.path)]),
    [['Jeu', '.appimage']],
  );
  write('mac/Jeu Mac.app/Contents/Info.plist');
  write('mac/Outil.txt');
  const mac = await scan(path.join(root, 'mac'), 'darwin');
  assert.deepEqual(
    mac.map((g) => [g.name, path.basename(g.open.path)]),
    [['Jeu Mac', 'Jeu Mac.app']],
  );
});

test('parcours borné : trois niveaux, extensions du système ; sans emplacement, rien', async () => {
  const { ctx, walked } = fakeContext();
  const src = createFolders(ctx, 'win32');
  await src.scan(at(path.join(root, 'jeux')));
  assert.deepEqual(walked[0].options, { extensions: ['exe', 'lnk', 'url', 'bat'], depth: 3, limit: 150000 });
  assert.deepEqual(await src.scan(null), []);
});

test('clés : celles de Mire avant P5-13 (`pc:<chemin>`, sans casse sous Windows)', () => {
  assert.equal(pcGameKey('C:\\Jeux\\Celeste\\Celeste.exe', 'win32'), 'pc:c:/jeux/celeste/celeste.exe');
  assert.equal(pcGameKey('/home/a/Jeux/Celeste.x86_64', 'linux'), 'pc:/home/a/Jeux/Celeste.x86_64');
});

test('chemins Windows : fichiers hors du dossier ignorés, casse ignorée', () => {
  const games = gamesIn(
    'C:\\Jeux',
    [
      { path: 'c:\\jeux\\Celeste\\Celeste.exe', size: 1 },
      { path: 'D:\\Autre\\Jeu.exe', size: 1 },
    ],
    'win32',
  );
  assert.deepEqual(games, [{ name: 'Celeste', path: 'c:\\jeux\\Celeste\\Celeste.exe' }]);
  assert.equal(similarity('Été', 'ete'), 1);
});
