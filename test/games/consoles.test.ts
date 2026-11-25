// Consoles créées à la main, émulateur choisi par console et par jeu, suppression d'un jeu par sa clé (P4-17, D-21).
// Fonctions pures sur la liste des consoles, puis lancement et suppression avec des dépendances factices.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Emulator } from '@mire/shared';
import { createConfigService } from '../../src/main/config/index.ts';
import { romKey } from '../../src/main/catalog/keys.ts';
import { emulatorChoices, emulatorName, launcherOf, removeConsole, saveConsole, setConsoleEmulator, setGameEmulator } from '../../src/main/games/consoles.ts';
import { deleteGameElement } from '../../src/main/games/delete.ts';
import { launchRom } from '../../src/main/games/roms/launch.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

type Any = any;

const PS1 = 'Sony - PlayStation';
const consoles = (): Emulator[] =>
  [
    {
      id: 'duckstation:ps1',
      name: 'PlayStation',
      path: '/emu/duckstation/DuckStation.AppImage',
      args: ['-batch', '{rom}'],
      sources: [],
      system: PS1,
      store: 'duckstation:ps1',
    },
    {
      id: 'retroarch:ps1',
      name: 'PlayStation (RetroArch)',
      path: '/emu/retroarch/retroarch',
      args: ['-L', 'beetle', '{rom}'],
      sources: [],
      system: PS1,
      store: 'retroarch:ps1',
    },
    { id: 'snes-1', name: 'Super Nintendo', path: '/emu/snes9x.exe', sources: [], system: 'Nintendo - Super Nintendo Entertainment System' },
  ] as Emulator[];

const ok = (r: Any) => {
  assert.equal(r.ok, true, r.code);
  return r;
};

describe('Consoles (P4-17)', () => {
  it('nomme l’émulateur d’après la boutique, sinon d’après son programme', () => {
    const [duck, , snes] = consoles();
    const names = (id: string) => ({ duckstation: 'DuckStation' })[id];
    assert.equal(emulatorName(duck, names), 'DuckStation');
    // Plugin de l'émulateur retiré : le nom du programme.
    assert.equal(emulatorName(duck), 'DuckStation');
    assert.equal(emulatorName({ ...duck, path: '/emu/duckstation/duckstation-qt-x64-ReleaseLTCG.exe' }), 'duckstation-qt-x64-ReleaseLTCG');
    assert.equal(emulatorName(snes), 'snes9x');
    assert.equal(emulatorName({ path: 'C:\\Jeux\\mesen\\Mesen.exe' } as Emulator), 'Mesen');
  });

  it('propose l’émulateur de la console puis ceux des consoles du même système', () => {
    const names = (id: string) => ({ duckstation: 'DuckStation', retroarch: 'RetroArch' })[id];
    assert.deepEqual(emulatorChoices(consoles(), 'retroarch:ps1', names), [
      { id: 'retroarch:ps1', emulator: 'RetroArch', console: 'PlayStation (RetroArch)' },
      { id: 'duckstation:ps1', emulator: 'DuckStation', console: 'PlayStation' },
    ]);
    // Sans les plugins : le nom des programmes.
    assert.deepEqual(
      emulatorChoices(consoles(), 'retroarch:ps1').map((c) => c.emulator),
      ['retroarch', 'DuckStation'],
    );
    assert.deepEqual(
      emulatorChoices(consoles(), 'snes-1').map((c) => c.id),
      ['snes-1'],
    );
    assert.deepEqual(emulatorChoices(consoles(), 'inconnue'), []);
  });

  it('crée une console à la main : nom et émulateur exigés, arguments et extensions mis en forme', () => {
    assert.deepEqual(saveConsole(consoles(), { name: ' ', path: '/emu/x' }), { ok: false, code: 'name' });
    assert.deepEqual(saveConsole(consoles(), { name: 'Mega Drive', path: '' }), { ok: false, code: 'path' });
    const r = ok(
      saveConsole(consoles(), {
        name: 'Mega Drive',
        path: '/emu/genesis',
        args: [],
        extensions: ['MD', '.bin', 'md'],
        sources: [' /jeux/md ', ''],
        romsDir: '/jeux/md2',
      }),
    );
    const made = r.emulators.find((e: Emulator) => e.id === r.id);
    assert.match(r.id, /^mega-drive-/);
    assert.deepEqual(
      { ...made, id: undefined },
      {
        id: undefined,
        name: 'Mega Drive',
        path: '/emu/genesis',
        args: ['{rom}'],
        romsDir: '/jeux/md2',
        sources: ['/jeux/md'],
        extensions: ['.md', '.bin'],
        system: '',
      },
    );
  });

  it('modifie une console en gardant le reste de sa fiche ; une console disparue est signalée', () => {
    const r = ok(
      saveConsole(
        consoles(),
        { name: 'SNES', path: '/emu/bsnes', args: ['-f', '{rom}'], romSites: [{ name: 'Site', url: 'https://site.test' }] as Any },
        'snes-1',
      ),
    );
    const snes = r.emulators.find((e: Emulator) => e.id === 'snes-1');
    assert.equal(snes.name, 'SNES');
    assert.equal(snes.system, '');
    assert.deepEqual(snes.romSites, [{ name: 'Site', url: 'https://site.test' }]);
    assert.equal(ok(saveConsole(r.emulators, { name: 'SNES', path: '/emu/bsnes', romSites: null }, 'snes-1')).emulators[2].romSites, undefined);
    assert.deepEqual(saveConsole(consoles(), { name: 'X', path: '/x' }, 'inconnue'), { ok: false, code: 'gone' });
  });

  it('choisit l’émulateur d’une console et d’un jeu, puis le lancement suit ce choix', () => {
    const key = romKey('duckstation:ps1', '/jeux/ps1/Jeu.cue', 'linux');
    let list = ok(setConsoleEmulator(consoles(), 'duckstation:ps1', 'retroarch:ps1')).emulators;
    assert.equal(launcherOf(list, 'duckstation:ps1', { key })?.id, 'retroarch:ps1');
    // Le jeu garde l'émulateur de sa propre console, alors que la console en utilise un autre.
    list = ok(setGameEmulator(list, 'duckstation:ps1', key, 'duckstation:ps1')).emulators;
    assert.deepEqual(list[0].gameEmulators, { [key]: 'duckstation:ps1' });
    assert.equal(launcherOf(list, 'duckstation:ps1', { key })?.id, 'duckstation:ps1');
    list = ok(setGameEmulator(list, 'duckstation:ps1', key, null)).emulators;
    assert.equal(list[0].gameEmulators, undefined);
    assert.equal(launcherOf(list, 'duckstation:ps1', { key })?.id, 'retroarch:ps1');
    list = ok(setConsoleEmulator(list, 'duckstation:ps1', null)).emulators;
    list = ok(setGameEmulator(list, 'duckstation:ps1', key, 'retroarch:ps1')).emulators;
    assert.deepEqual(list[0].gameEmulators, { [key]: 'retroarch:ps1' });
    assert.equal(launcherOf(list, 'duckstation:ps1', { key })?.id, 'retroarch:ps1');
    assert.equal(launcherOf(list, 'duckstation:ps1', { key: 'rom:autre' })?.id, 'duckstation:ps1');
    // Pour ce lancement seulement.
    assert.equal(launcherOf(list, 'duckstation:ps1', { key, emulator: 'duckstation:ps1' })?.id, 'duckstation:ps1');
  });

  it('refuse un émulateur d’un autre système, et oublie les choix d’une console supprimée', () => {
    assert.deepEqual(setConsoleEmulator(consoles(), 'snes-1', 'retroarch:ps1'), { ok: false, code: 'emulator' });
    assert.deepEqual(setGameEmulator(consoles(), 'snes-1', '', null), { ok: false, code: 'gone' });
    let list = ok(setConsoleEmulator(consoles(), 'duckstation:ps1', 'retroarch:ps1')).emulators;
    list = ok(setGameEmulator(list, 'duckstation:ps1', 'rom:x', 'retroarch:ps1')).emulators;
    list = ok(removeConsole(list, 'retroarch:ps1')).emulators;
    assert.deepEqual(
      list.map((e: Emulator) => e.id),
      ['duckstation:ps1', 'snes-1'],
    );
    assert.equal(list[0].emulator, undefined);
    assert.equal(list[0].gameEmulators, undefined);
    assert.deepEqual(removeConsole(list, 'retroarch:ps1'), { ok: false, code: 'gone' });
  });

  it('un choix devenu caduc (système changé) est ignoré au lancement et retiré à l’enregistrement', () => {
    const list = ok(setConsoleEmulator(consoles(), 'duckstation:ps1', 'retroarch:ps1')).emulators;
    const changed = list.map((e: Emulator) => (e.id === 'retroarch:ps1' ? { ...e, system: 'Sega - Mega Drive - Genesis' } : e));
    assert.equal(launcherOf(changed, 'duckstation:ps1')?.id, 'duckstation:ps1');
    const saved = ok(saveConsole(list, { name: 'RA', path: '/emu/retroarch/retroarch', system: 'Sega - Mega Drive - Genesis' }, 'retroarch:ps1')).emulators;
    assert.equal(saved[0].emulator, undefined);
  });
});

describe('Lancement et suppression par la clé (P4-17)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-consoles-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const write = (rel: string) => {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    return file;
  };

  function deps(emulators: Any[], games: Any[] = []) {
    const calls: unknown[] = [];
    const config = createConfigService({ file: path.join(tmp, 'config.json') });
    config.replace({ emulators, games });
    return {
      calls,
      deps: {
        config,
        access: createAccessPolicy({ roots: () => [path.join(tmp, 'roms')] }),
        launcher: { launchProcess: async (...args: unknown[]) => (calls.push(args), { ok: true }), openTarget: async () => ({ ok: false }) },
      } as Any,
    };
  }

  it('lance un jeu avec l’émulateur choisi pour lui, ou celui demandé pour cette fois', async () => {
    const rom = write('roms/Jeu.cue');
    const key = romKey('duck', rom);
    const list = [
      { id: 'duck', name: 'PS1', path: '/emu/duck', args: ['{rom}'], system: PS1, sources: [path.join(tmp, 'roms')], gameEmulators: { [key]: 'ra' } },
      { id: 'ra', name: 'PS1 RA', path: '/emu/ra', args: ['-L', 'beetle', '{rom}'], system: PS1, sources: [] },
    ];
    const { deps: d, calls } = deps(list);
    assert.deepEqual(await launchRom(d, 'duck', rom), { ok: true });
    assert.deepEqual(await launchRom(d, 'duck', rom, 'duck'), { ok: true });
    assert.deepEqual(calls, [
      ['/emu/ra', ['-L', 'beetle', rom], { cwd: '/emu', hideWhileRunning: true }],
      ['/emu/duck', [rom], { cwd: '/emu', hideWhileRunning: true }],
    ]);
  });

  it('supprime un jeu de console désigné par sa clé', async () => {
    const rom = write('roms/Jeu.sfc');
    const { deps: d } = deps([{ id: 'snes', name: 'SNES', path: '/emu/snes', romsDir: path.join(tmp, 'roms') }]);
    const lookup = (key: string) => (key === 'rom:1' ? { open: { kind: 'game' as const, console: 'snes', path: rom } } : null);
    assert.deepEqual(await deleteGameElement(d, lookup, 'rom:1'), { ok: true });
    assert.equal(fs.existsSync(rom), false);
    assert.match((await deleteGameElement(d, lookup, 'rom:inconnu')).error!, /n’est pas un jeu/);
  });

  it('refuse de supprimer un fichier hors des dossiers de la console, même par un lien symbolique', async () => {
    const outside = write('ailleurs/Jeu.sfc');
    fs.mkdirSync(path.join(tmp, 'roms'), { recursive: true });
    const link = path.join(tmp, 'roms', 'Lien.sfc');
    fs.symlinkSync(outside, link);
    const { deps: d } = deps([{ id: 'snes', name: 'SNES', path: '/emu/snes', romsDir: path.join(tmp, 'roms') }]);
    const lookup = (key: string) => ({ open: { kind: 'game' as const, console: 'snes', path: key === 'rom:lien' ? link : outside } });
    assert.match((await deleteGameElement(d, lookup, 'rom:dehors')).error!, /ne se trouve pas dans les dossiers de SNES/);
    assert.match((await deleteGameElement(d, lookup, 'rom:lien')).error!, /ne se trouve pas dans les dossiers de SNES/);
    assert.ok(fs.existsSync(outside));
    assert.ok(fs.lstatSync(link).isSymbolicLink());
  });

  it('retire un jeu PC ajouté à la main, mais pas un jeu trouvé dans un dossier', async () => {
    const { deps: d } = deps([], [{ name: 'A', path: '/jeux/a.exe' }]);
    const lookup = (key: string) => ({ open: { kind: 'program' as const, path: key === 'pc:a' ? '/jeux/a.exe' : '/jeux/b.exe' } });
    assert.match((await deleteGameElement(d, lookup, 'pc:b')).error!, /trouvé automatiquement/);
    const r: Any = await deleteGameElement(d, lookup, 'pc:a');
    assert.equal(r.ok, true);
    assert.deepEqual(r.config.games, []);
  });
});
