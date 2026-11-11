// Jeux PC (P1-20) sur dossiers temporaires : raccourcis et exécutables posés dans le dossier, choix de l'exécutable
// d'un sous-dossier, utilitaires ignorés, dossiers inaccessibles ; lancement avec un faux lanceur (aucun programme
// réel n'est lancé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bestExecutable, localPcProvider, scanGameSources } from '../../src/main/games/pc/scanner.ts';
import { addGame, launchGame, launchGamePath } from '../../src/main/games/pc/launch.ts';
import { createConfigService } from '../../src/main/config/index.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-jeux-pc-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (rel: string, size = 1) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(size));
  return file;
};

test('bestExecutable : nom proche du dossier, puis le plus gros ; utilitaires, raccourcis et redistribuables écartés', async () => {
  const dir = path.join(root, 'choix', 'Super Jeu');
  write('choix/Super Jeu/unins000.exe', 5000);
  write('choix/Super Jeu/UnityCrashHandler64.exe', 5000);
  write('choix/Super Jeu/Super Jeu.lnk', 5000);
  write('choix/Super Jeu/_CommonRedist/vcredist.exe', 9000);
  write('choix/Super Jeu/redist/autre.exe', 9000);
  write('choix/Super Jeu/outil.exe', 100);
  const main = write('choix/Super Jeu/bin/SuperJeu.exe', 10);
  assert.equal(await bestExecutable(dir, 'Super Jeu', 'win32'), main);
  // À nom égal (aucun ne ressemble), le plus gros l'emporte.
  const other = path.join(root, 'taille', 'Zzz');
  write('taille/Zzz/a.exe', 10);
  const big = write('taille/Zzz/b.exe', 500);
  assert.equal(await bestExecutable(other, 'Zzz', 'win32'), big);
  // Trop profond (plus de trois niveaux) : ignoré.
  write('profond/Jeu/1/2/3/Jeu.exe');
  assert.equal(await bestExecutable(path.join(root, 'profond', 'Jeu'), 'Jeu', 'win32'), null);
});

test('scanGameSources : un jeu par raccourci, par exécutable ou par sous-dossier, triés ; état de chaque dossier', async () => {
  write('jeux/Mon_jeu.exe');
  write('jeux/Raccourci.lnk');
  write('jeux/setup.exe');
  write('jeux/.cache/x.exe');
  write('jeux/lisezmoi.txt');
  const exe = write('jeux/Aventure/Aventure.exe');
  fs.mkdirSync(path.join(root, 'jeux', 'Vide'), { recursive: true });
  const sources = [
    { id: 's1', location: path.join(root, 'jeux') },
    { id: 's2', location: path.join(root, 'absent') },
    { id: 's3', location: 'https://exemple.org/jeux/' },
  ];
  const { games, status } = await scanGameSources(sources, [localPcProvider('win32')]);
  assert.deepEqual(
    games.map((g) => [g.name, path.relative(root, g.path), g.source]),
    [
      ['Aventure', path.relative(root, exe), 's1'],
      ['Mon jeu', path.join('jeux', 'Mon_jeu.exe'), 's1'],
      ['Raccourci', path.join('jeux', 'Raccourci.lnk'), 's1'],
    ],
  );
  assert.deepEqual(status.s1, { ok: true, error: null, count: 3 });
  assert.equal(status.s2.ok, false);
  assert.match(status.s2.error!, /introuvable|inaccessible|accès/i);
  assert.deepEqual(status.s3, { ok: false, error: 'Les jeux PC doivent se trouver sur un disque ou un partage réseau.', count: 0 });
});

test('scanGameSources : extensions propres à Linux et à macOS', async () => {
  write('linux/Jeu.appimage');
  write('linux/Jeu.exe');
  const linux = await scanGameSources([{ id: 'l', location: path.join(root, 'linux') }], [localPcProvider('linux')]);
  assert.deepEqual(
    linux.games.map((g) => g.name),
    ['Jeu'],
  );
  assert.equal(path.extname(linux.games[0].path), '.appimage');
  fs.mkdirSync(path.join(root, 'mac', 'Jeu Mac.app', 'Contents'), { recursive: true });
  const mac = await scanGameSources([{ id: 'm', location: path.join(root, 'mac') }], [localPcProvider('darwin')]);
  assert.deepEqual(
    mac.games.map((g) => [g.name, path.basename(g.path)]),
    [['Jeu Mac', 'Jeu Mac.app']],
  );
});

function launchDeps(games: unknown[], allowed: string[] = []) {
  const calls: unknown[] = [];
  const config = createConfigService({ file: path.join(root, `config-${Math.random().toString(36).slice(2)}.json`) });
  config.replace({ games });
  const launcher = {
    launchProcess: async (...args: unknown[]) => (calls.push(['launchProcess', ...args]), { ok: true }),
    openTarget: async (...args: unknown[]) => (calls.push(['openTarget', ...args]), { ok: true }),
  };
  return { deps: { config, access: createAccessPolicy({ roots: () => allowed }), launcher }, calls };
}

test('launchGame : fichier présent ou adresse, avec arguments et dossier de travail ; fichier absent refusé', async () => {
  const exe = write('lancer/Jeu.exe');
  const { deps, calls } = launchDeps([
    { name: 'Jeu', path: exe, args: ['-plein'] },
    { name: 'Steam', path: 'steam://rungameid/42' },
    { name: 'Absent', path: path.join(root, 'absent.exe') },
  ]);
  assert.deepEqual(await launchGame(deps, 0), { ok: true });
  assert.deepEqual(await launchGame(deps, 1), { ok: true });
  assert.match((await launchGame(deps, 2)).error!, /Fichier introuvable/);
  assert.match((await launchGame(deps, 9)).error!, /n’existe plus/);
  assert.deepEqual(calls, [
    ['openTarget', exe, ['-plein'], { cwd: path.dirname(exe), hideWhileRunning: true }],
    ['openTarget', 'steam://rungameid/42', [], { cwd: undefined, hideWhileRunning: true }],
  ]);
});

test('launchGamePath : seulement un fichier des dossiers de jeux autorisés', async () => {
  const exe = write('autorise/Jeu.exe');
  const { deps, calls } = launchDeps([], [path.join(root, 'autorise')]);
  assert.match((await launchGamePath(deps, write('ailleurs/Jeu.exe'))).error!, /ne fait pas partie/);
  assert.match((await launchGamePath(deps, 42)).error!, /ne fait pas partie/);
  assert.deepEqual(await launchGamePath(deps, exe), { ok: true });
  assert.deepEqual(calls, [['openTarget', exe, [], { cwd: path.dirname(exe), hideWhileRunning: true }]]);
});

test('addGame : ajoute le fichier choisi sous son nom, ou rien si l’utilisateur renonce', async () => {
  const { deps } = launchDeps([]);
  assert.equal(await addGame({ ...deps, pickFile: async () => null }), null);
  const next = await addGame({ ...deps, pickFile: async () => path.join(root, 'Mon Jeu.exe') });
  assert.deepEqual(next!.games, [{ name: 'Mon Jeu', path: path.join(root, 'Mon Jeu.exe'), args: [], image: '' }]);
});
