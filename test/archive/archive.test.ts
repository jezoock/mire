// Service d'archives : extraction avec le 7za livré par 7zip-bin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createArchive } from '../../src/main/archive/index.ts';

const { path7za } = createRequire(import.meta.url)('7zip-bin') as { path7za: string };

test('archive : extrait un .7z, et échoue sur un fichier qui n’en est pas un', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = createArchive({ sevenZipPath: path7za, copyPath: path.join(root, 'bin', '7za') });
  if (process.platform !== 'win32') fs.chmodSync(path7za, 0o755);
  fs.mkdirSync(path.join(root, 'src', 'cores'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'cores', 'jeu.txt'), 'bonjour');
  execFileSync(path7za, ['a', '-y', path.join(root, 'a.7z'), path.join(root, 'src', 'cores')], { stdio: 'ignore' });

  await archive.extract(path.join(root, 'a.7z'), path.join(root, 'dest', 'neuf'));
  assert.equal(fs.readFileSync(path.join(root, 'dest', 'neuf', 'cores', 'jeu.txt'), 'utf8'), 'bonjour');

  fs.writeFileSync(path.join(root, 'faux.zip'), 'pas une archive');
  await assert.rejects(archive.extract(path.join(root, 'faux.zip'), path.join(root, 'x')), /Extraction impossible/);
});
