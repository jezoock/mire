// Jeux PC (P1-20) : lancement avec un faux lanceur (aucun programme réel n'est lancé) et ajout à la main. L'analyse
// des dossiers de jeux est partie avec le plugin inclus `mire.games.pc` (P5-13, ses tests dans plugins/mire.games.pc/test/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addGame, launchGame, launchGamePath, launchProgram } from '../../src/main/games/pc/launch.ts';
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

function launchDeps(games: unknown[], allowed: string[] = [], gameSources: unknown[] = []) {
  const calls: unknown[] = [];
  const config = createConfigService({ file: path.join(root, `config-${Math.random().toString(36).slice(2)}.json`) });
  config.replace({ games, gameSources });
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

test('launchProgram (P5-13) : jeu ajouté à la main avec ses arguments ; sinon seulement dans un dossier de jeux, sans arguments', async () => {
  const manual = write('ailleurs-main/Jeu.exe');
  const inFolder = write('dossier-jeux/Celeste/Celeste.exe');
  const outside = write('hors/Autre.exe');
  // Lien posé dans le dossier de jeux qui mène ailleurs : refusé sur le chemin réel.
  const link = path.join(root, 'dossier-jeux', 'lien.exe');
  fs.symlinkSync(outside, link);
  const { deps, calls } = launchDeps([{ name: 'Jeu', path: manual, args: ['-plein'] }], [], [{ id: 'g', location: path.join(root, 'dossier-jeux') }]);
  assert.deepEqual(await launchProgram(deps, manual), { ok: true });
  assert.deepEqual(await launchProgram(deps, inFolder), { ok: true });
  assert.match((await launchProgram(deps, outside)).error!, /ne fait pas partie/);
  assert.match((await launchProgram(deps, link)).error!, /ne fait pas partie/);
  assert.match((await launchProgram(deps, path.join(root, 'dossier-jeux', '..', 'hors', 'Autre.exe'))).error!, /ne fait pas partie/);
  assert.match((await launchProgram(deps, path.join(root, 'dossier-jeux', 'absent.exe'))).error!, /Fichier introuvable/);
  assert.deepEqual(calls, [
    ['openTarget', manual, ['-plein'], { cwd: path.dirname(manual), hideWhileRunning: true }],
    ['openTarget', inFolder, [], { cwd: path.dirname(inFolder), hideWhileRunning: true }],
  ]);
});
