// Parcours générique de dossiers (P1-14) : ordre, profondeur, dossiers écartés, arrêt, dossiers déjà vus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkDirs, pathKey } from '../../src/main/fs/walk.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-walk-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
for (const d of ['a/b/c', 'a/.cache', 'z']) fs.mkdirSync(path.join(root, d), { recursive: true });
fs.writeFileSync(path.join(root, 'a/f.txt'), '');

const rel = (dir: string) => path.relative(root, dir) || '.';

test('profondeur d’abord, profondeur maximale, dossiers écartés', async () => {
  const seen: string[] = [];
  await walkDirs(root, (dir, _entries, depth) => void seen.push(`${rel(dir)}@${depth}`), { maxDepth: 2, skipDir: (n) => n.startsWith('.') });
  assert.deepEqual(seen.sort(), ['.@0', 'a/b@2', 'a@1', 'z@1']);
});

test('le visiteur reçoit le contenu du dossier', async () => {
  let names: string[] = [];
  await walkDirs(path.join(root, 'a'), (dir, entries) => {
    if (dir === path.join(root, 'a')) names = entries.map((e) => e.name).sort();
  });
  assert.deepEqual(names, ['.cache', 'b', 'f.txt']);
});

test('arrêt demandé et dossier illisible', async () => {
  let n = 0;
  await walkDirs(root, () => void n++, { shouldStop: () => n >= 2 });
  assert.equal(n, 2);
  let visited = false;
  await walkDirs(path.join(root, 'absent'), () => {
    visited = true;
  });
  assert.equal(visited, false);
});

test('un dossier déjà vu sous la même clé n’est pas revisité', async () => {
  const seen: string[] = [];
  await walkDirs(root, (dir) => void seen.push(rel(dir)), { dirKey: () => 'même clé' });
  assert.deepEqual(seen, ['.']);
});

test('pathKey : sans casse sous Windows seulement', () => {
  assert.equal(pathKey('/A/B', 'linux'), path.resolve('/A/B'));
  assert.equal(pathKey('/A/B', 'win32'), path.resolve('/A/B').toLowerCase());
});
