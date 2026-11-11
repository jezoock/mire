// Jeux de console (P1-20) : liste locale et web (serveur HTTP local 127.0.0.1), disques d'un .m3u masqués (y compris
// un disque cité par son adresse complète dans un .m3u distant), jaquettes locales ; lancement avec un faux lanceur
// et un faux gestionnaire de téléchargements (aucun programme réel n'est lancé, aucun accès hors de la machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createConfigService } from '../../src/main/config/index.ts';
import { listRoms } from '../../src/main/games/roms/list.ts';
import { launchRom } from '../../src/main/games/roms/launch.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-jeux-roms-'));
const write = (rel: string, text = 'x') => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const index = (links: string[]) =>
  `<html><head><title>Index of /</title></head><body><pre>${links.map((l) => `<a href="${l}">${l}</a>\n`).join('')}</pre></body></html>`;
let base = '';
const pages: Record<string, () => string> = {
  '/roms/': () => index(['Jeu%20(Europe).sfc', 'Liste.m3u', 'Disque%201.cue', 'Disque%202.cue', 'Seul.cue', 'notes.txt', 'Sous/']),
  '/roms/Sous/': () => index(['Autre.sfc']),
  // Disque 1 par chemin relatif, disque 2 par adresse complète.
  '/roms/Liste.m3u': () => `#EXTM3U\nDisque 1.cue\n${base}/roms/Disque%202.cue\n`,
};
const server = createServer((req, res) => {
  const page = pages[req.url as string];
  if (!page) {
    res.writeHead(404).end('absent');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function makeDeps(emulators: unknown[], extra: Record<string, unknown> = {}) {
  const config = createConfigService({ file: path.join(root, `config-${Math.random().toString(36).slice(2)}.json`) });
  config.replace({ emulators });
  const fetchText = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`code ${r.status}`);
    return r.text();
  };
  return { config, downloads: () => ({ fetchText }), ...extra } as never;
}

test('listRoms : dossier local, extensions de la console, disques d’un .m3u masqués, jaquettes, tri', async () => {
  write('local/Zelda (Europe).sfc');
  write('local/Mario_World.sfc');
  write('local/notes.txt');
  write('local/.cache/Cache.sfc');
  write('local/ps/Jeu.m3u', 'Jeu (Disque 1).cue\nDisques/Jeu (Disque 2).cue\n');
  write('local/ps/Jeu (Disque 1).cue');
  write('local/ps/Disques/Jeu (Disque 2).cue');
  write('local/ps/Autre.cue');
  write('local/1/2/3/4/Profond.sfc');
  write('local/1/2/3/4/5/TropProfond.sfc');
  const cover = write('images/Zelda (Europe).png');
  const emu = {
    id: 'snes',
    name: 'SNES',
    path: 'snes',
    sources: [],
    romsDir: path.join(root, 'local'),
    extensions: ['sfc', '.CUE', 'm3u'],
    imagesDir: path.join(root, 'images'),
  };
  const r = (await listRoms(makeDeps([emu]), 'snes')) as unknown as { ok: true; roms: Array<Record<string, unknown>>; errors: string[] };
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.roms.map((x) => [x.displayName, path.relative(root, x.path as string), x.remote]),
    [
      ['Autre', path.join('local', 'ps', 'Autre.cue'), false],
      ['Jeu', path.join('local', 'ps', 'Jeu.m3u'), false],
      ['Mario World', path.join('local', 'Mario_World.sfc'), false],
      ['Profond', path.join('local', '1', '2', '3', '4', 'Profond.sfc'), false],
      ['Zelda', path.join('local', 'Zelda (Europe).sfc'), false],
    ],
  );
  assert.equal(r.roms.find((x) => x.displayName === 'Zelda')!.image, cover);
  assert.deepEqual(r.errors, []);
});

test('listRoms : source web, disque cité par adresse complète dans un .m3u distant masqué', async () => {
  const emu = { id: 'ps1', name: 'PS1', path: 'ps1', sources: [`${base}/roms/`], extensions: ['sfc', 'cue', 'm3u'] };
  const deps = makeDeps([emu]);
  const local = (await listRoms(deps, 'ps1')) as Record<string, unknown>;
  assert.deepEqual(local, { ok: true, roms: [], errors: [], noLocal: true }, 'sans « en ligne », une source web n’est pas lue');
  const r = (await listRoms(deps, 'ps1', { online: true })) as unknown as { ok: true; roms: Array<Record<string, unknown>> };
  assert.deepEqual(
    r.roms.map((x) => [x.name, x.path, x.remote]),
    [
      ['Autre', `${base}/roms/Sous/Autre.sfc`, true],
      ['Jeu (Europe)', `${base}/roms/Jeu%20(Europe).sfc`, true],
      ['Liste', `${base}/roms/Liste.m3u`, true],
      ['Seul', `${base}/roms/Seul.cue`, true],
    ],
  );
  const only = (await listRoms(deps, 'ps1', { only: `${base}/roms/` })) as { roms: unknown[] };
  assert.equal(only.roms.length, 4);
});

test('listRoms : console inconnue, sans dossier, ou dossiers tous inaccessibles', async () => {
  const deps = makeDeps([
    { id: 'vide', name: 'Vide', path: 'x', sources: [] },
    { id: 'absent', name: 'Absent', path: 'x', sources: [path.join(root, 'nulle-part')] },
  ]);
  assert.match(((await listRoms(deps, 'inconnue')) as { error: string }).error, /n’existe plus/);
  assert.match(((await listRoms(deps, 'vide')) as { error: string }).error, /Aucun dossier de jeux indiqué pour Vide/);
  assert.equal((await listRoms(deps, 'absent')).ok, false);
});

function launchDeps(emu: Record<string, unknown>, allowed: string[] = []) {
  const calls: unknown[] = [];
  const notes: unknown[] = [];
  const cacheDir = path.join(root, 'cache');
  const fetchToCache = async (url: string, file: string, opts: { onProgress?: (r: number, t: number) => void } = {}) => {
    calls.push(['fetchToCache', url, file]);
    opts.onProgress?.(5, 10);
    if (url.includes('annule')) return { ok: false, cancelled: true, error: 'Téléchargement annulé.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'rom');
    return { ok: true, file };
  };
  const fetchText = async (url: string) => (calls.push(['fetchText', url]), 'FILE "Jeu (Piste 1).bin" BINARY\nFILE "Jeu (Piste 2).bin" BINARY\n');
  const launcher = {
    launchProcess: async (...args: unknown[]) => (calls.push(['launchProcess', ...args]), { ok: true }),
    openTarget: async () => ({ ok: false }),
  };
  const config = createConfigService({ file: path.join(root, `config-${Math.random().toString(36).slice(2)}.json`) });
  config.replace({ emulators: [emu] });
  const deps = {
    config,
    access: createAccessPolicy({ roots: () => allowed }),
    launcher,
    downloads: () => ({ fetchToCache, fetchText }),
    romCacheDir: () => cacheDir,
    toUi: (channel: string, payload: unknown) => notes.push([channel, payload]),
  } as never;
  return { deps, calls, notes, cacheDir };
}

test('launchRom : jeu local autorisé lancé par l’émulateur avec ses arguments ; jeu hors des dossiers refusé', async () => {
  const rom = write('lance/Jeu.sfc');
  const emu = { id: 'snes', name: 'SNES', path: path.join(root, 'emu', 'snes.exe'), args: ['-f', '{rom}'], sources: [path.join(root, 'lance')] };
  const { deps, calls } = launchDeps(emu, [path.join(root, 'lance')]);
  assert.deepEqual(await launchRom(deps, 'snes', rom), { ok: true });
  assert.match((await launchRom(deps, 'snes', write('ailleurs/Jeu.sfc'))).error!, /ne se trouve pas dans les dossiers/);
  assert.match((await launchRom(deps, 'inconnue', rom)).error!, /n’existe plus/);
  assert.deepEqual(calls, [['launchProcess', emu.path, ['-f', rom], { cwd: path.join(root, 'emu'), hideWhileRunning: true }]]);
});

test('launchRom : jeu en ligne copié dans le cache par le gestionnaire de téléchargements, une seule fois', async () => {
  const emu = { id: 'snes', name: 'Super NES', path: 'snes', sources: ['https://roms.test/snes'] };
  const { deps, calls, notes, cacheDir } = launchDeps(emu);
  const url = 'https://roms.test/snes/Jeu%20(Europe).sfc';
  const target = path.join(cacheDir, 'super-nes', 'Jeu (Europe).sfc');
  assert.deepEqual(await launchRom(deps, 'snes', url), { ok: true });
  assert.deepEqual(calls, [
    ['fetchToCache', url, target],
    ['launchProcess', 'snes', [target], { cwd: undefined, hideWhileRunning: true }],
  ]);
  assert.deepEqual(notes, [
    ['rom-progress', { name: 'Jeu (Europe).sfc', phase: 'download' }],
    ['rom-progress', { name: 'Jeu (Europe).sfc', phase: 'download', received: 5, total: 10 }],
    ['rom-progress', { name: 'Jeu (Europe).sfc', phase: 'done' }],
  ]);
  // Déjà dans le cache : lancé sans retéléchargement.
  calls.length = 0;
  assert.deepEqual(await launchRom(deps, 'snes', url), { ok: true });
  assert.deepEqual(
    calls.map((c) => (c as unknown[])[0]),
    ['launchProcess'],
  );
  // Une adresse qui ne vient pas d'une source de la console est refusée.
  assert.match((await launchRom(deps, 'snes', 'https://ailleurs.test/snes/Jeu.sfc')).error!, /ne provient pas/);
  assert.match((await launchRom(deps, 'snes', 'https://roms.test/snesxx/Jeu.sfc')).error!, /ne provient pas/);
});

test('launchRom : jeu sur disque en ligne (index et pistes) ; annulation dans Téléchargements', async () => {
  const emu = { id: 'ps1', name: 'PS1', path: 'ps1', sources: ['https://roms.test/ps1/'] };
  const { deps, calls, cacheDir } = launchDeps(emu);
  write(path.join('cache', 'ps1', 'Jeu', 'Jeu (Piste 1).bin'));
  const r = await launchRom(deps, 'ps1', 'https://roms.test/ps1/Jeu.cue');
  assert.deepEqual(r, { ok: true });
  const folder = path.join(cacheDir, 'ps1', 'Jeu');
  assert.deepEqual(
    calls.filter((c) => (c as unknown[])[0] !== 'fetchText'),
    [
      ['fetchToCache', 'https://roms.test/ps1/Jeu.cue', path.join(folder, 'Jeu.cue')],
      ['fetchToCache', 'https://roms.test/ps1/Jeu%20(Piste%202).bin', path.join(folder, 'Jeu (Piste 2).bin')],
      ['launchProcess', 'ps1', [path.join(folder, 'Jeu.cue')], { cwd: undefined, hideWhileRunning: true }],
    ],
  );
  const cancelled = await launchRom(deps, 'ps1', 'https://roms.test/ps1/annule.sfc');
  assert.deepEqual(cancelled, { ok: false, error: 'Téléchargement annulé.' });
});
