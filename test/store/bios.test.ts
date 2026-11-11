// Caractérisation des dossiers de BIOS : les données de store/bios.ts donnent, pour chaque émulateur et chaque
// plateforme, le même dossier que l'ancien `switch` de store.js (copié ci-dessous).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { biosDir } from '../../src/main/store/bios.ts';
import { EMULATORS } from '../../src/main/store/catalog/index.ts';

interface Case {
  id: string;
  platform: 'win32' | 'linux' | 'other';
  emuRoot: string;
  exe?: string;
  paths: { home?: string; documents?: string; appData?: string };
  env: Record<string, string | undefined>;
  exists: (f: string) => boolean;
}

// Ancienne implémentation (store.js avant P1-18) ; seules les dépendances (plateforme, variables d'environnement,
// existence des fichiers, programme installé) sont passées en paramètres.
function oldBiosDir({ id, platform: PLATFORM, emuRoot, exe, paths, env, exists }: Case) {
  const home = paths.home || os.homedir();
  const docs = paths.documents || path.join(home, 'Documents');
  const appData = paths.appData || path.join(home, 'AppData', 'Roaming');
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const xdgData = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const dir = exe ? path.dirname(exe) : path.join(emuRoot, id);
  const has = (f: string) => exists(path.join(dir, f));
  const win = PLATFORM === 'win32';
  switch (id) {
    case 'retroarch':
      return win ? path.join(emuRoot, 'retroarch', 'system') : path.join(xdgConfig, 'retroarch', 'system');
    case 'duckstation':
      return has('portable.txt') ? path.join(dir, 'bios') : win ? path.join(docs, 'DuckStation', 'bios') : path.join(xdgData, 'duckstation', 'bios');
    case 'pcsx2':
      return has('portable.ini') || has('portable.txt')
        ? path.join(dir, 'bios')
        : win
          ? path.join(docs, 'PCSX2', 'bios')
          : path.join(xdgConfig, 'PCSX2', 'bios');
    case 'melonds':
      return win ? path.join(dir, 'bios') : path.join(xdgConfig, 'melonDS', 'bios');
    case 'dolphin':
      return has('portable.txt') ? path.join(dir, 'User', 'GC') : win ? path.join(docs, 'Dolphin Emulator', 'GC') : path.join(xdgData, 'dolphin-emu', 'GC');
    case 'azahar':
      return exists(path.join(dir, 'user'))
        ? path.join(dir, 'user', 'sysdata')
        : win
          ? path.join(appData, 'Azahar', 'sysdata')
          : path.join(xdgData, 'azahar-emu', 'sysdata');
    case 'cemu':
      return exists(path.join(dir, 'portable')) ? path.join(dir, 'portable') : win ? path.join(appData, 'Cemu') : path.join(xdgData, 'Cemu');
    default:
      return null;
  }
}

const ids = [...EMULATORS.map((e) => e.id), 'inconnu'];
const markers = [null, 'portable.txt', 'portable.ini', 'user', 'portable'];
const pathSets = [{}, { home: '/home/moi', documents: '/home/moi/Docs', appData: '/home/moi/AppData/Roaming' }];
const envs = [{}, { XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' }];

test('BIOS : même dossier que l’ancien switch pour chaque émulateur, plateforme et cas', () => {
  let n = 0;
  for (const id of ids)
    for (const platform of ['win32', 'linux', 'other'] as const)
      for (const exe of [undefined, '/opt/emu/prog'])
        for (const marker of markers)
          for (const paths of pathSets)
            for (const env of envs) {
              const exists = (f: string) => marker !== null && path.basename(f) === marker;
              const c: Case = { id, platform, emuRoot: '/donnees/emulators', exe, paths, env, exists };
              const label = JSON.stringify({ id, platform, exe, marker, paths, env });
              assert.equal(biosDir(id, c), oldBiosDir(c), label);
              n += 1;
            }
  assert.equal(n, ids.length * 3 * 2 * markers.length * pathSets.length * envs.length);
});

test('BIOS : quelques dossiers attendus', () => {
  const base = { emuRoot: '/d/emulators', paths: { home: '/home/moi' }, env: {}, exists: () => false };
  assert.equal(biosDir('duckstation', { ...base, platform: 'linux' }), path.join('/home/moi', '.local', 'share', 'duckstation', 'bios'));
  assert.equal(biosDir('retroarch', { ...base, platform: 'win32' }), path.join('/d/emulators', 'retroarch', 'system'));
  assert.equal(
    biosDir('dolphin', { ...base, platform: 'win32', exe: '/x/Dolphin.exe', exists: (f) => f.endsWith('portable.txt') }),
    path.join('/x', 'User', 'GC'),
  );
  assert.equal(biosDir('inconnu', { ...base, platform: 'linux' }), null);
});
