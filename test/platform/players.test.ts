// Plateforme (P1-11) : arguments des lecteurs externes (position de reprise, titre), fabriqués par le cœur à partir des
// lecteurs des plugins (factices ici, P5-20), choix du lecteur, navigateur externe et lanceur. Le lancement est
// simulé : aucun programme réel n'est démarré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLauncher, createPlayers, playerArgs, resolvePlayer } from '../../src/main/platform/index.ts';
import type { DetectEnv, ExternalPlayerSpec, Launcher, LauncherDeps } from '../../src/main/platform/index.ts';

const noFiles = (platform: NodeJS.Platform, files: string[] = []): DetectEnv => ({
  platform,
  env: {},
  fs: {
    statSync(file: string) {
      if (files.includes(file)) return { isFile: () => true };
      throw new Error('ENOENT');
    },
  },
});

// Lecteurs factices, tels que les lit `src/main/plugins/apps.ts` (mêmes options que mpv et VLC).
const player = (id: string, priority: number, locations: ExternalPlayerSpec['locations'], options: ExternalPlayerSpec['options']): ExternalPlayerSpec => ({
  id: `org.essai/${id}`,
  name: `pluginTexts.org_essai.apps.${id}.name`,
  priority,
  names: [id],
  locations,
  options,
});
const ALPHA = player('alpha', 10, { linux: ['/usr/bin/alpha'] }, { fullscreen: '--fs', title: '--force-media-title={title}', start: '--start={start}' });
const BETA = player(
  'beta',
  20,
  { darwin: ['/Applications/Beta.app/Contents/MacOS/Beta'], linux: ['/usr/bin/beta'] },
  { fullscreen: '--fullscreen', title: '--meta-title={title}', start: '--start-time={start}' },
);
const PLAYERS = [ALPHA, BETA];

test.describe('arguments des lecteurs, fabriqués par le cœur', () => {
  test('plein écran, titre, reprise, puis le fichier à lire', () => {
    assert.deepEqual(playerArgs(ALPHA, { url: '/films/a.avi', title: 'Film', start: 754.9 }), [
      '--fs',
      '--force-media-title=Film',
      '--start=754',
      '/films/a.avi',
    ]);
    assert.deepEqual(playerArgs(BETA, { url: '/films/a.avi', title: 'Film', start: 90 }), [
      '--fullscreen',
      '--meta-title=Film',
      '--start-time=90',
      '/films/a.avi',
    ]);
  });

  test('sans position ni titre, les arguments correspondants sont retirés', () => {
    assert.deepEqual(playerArgs(ALPHA, { url: 'u', title: '', start: 0 }), ['--fs', 'u']);
    assert.deepEqual(playerArgs(BETA, { url: 'u', title: 'T', start: Number.NaN }), ['--fullscreen', '--meta-title=T', 'u']);
  });

  test('le titre reste une valeur : ni variable remplacée, ni argument de plus', () => {
    assert.deepEqual(playerArgs(ALPHA, { url: 'u', title: '{start} --script=x.lua', start: 5 }), [
      '--fs',
      '--force-media-title={start} --script=x.lua',
      '--start=5',
      'u',
    ]);
  });

  test('lecteur sans option : seulement le fichier', () => {
    assert.deepEqual(playerArgs({ ...ALPHA, options: {} }, { url: 'u', title: 'T', start: 5 }), ['u']);
  });
});

test.describe('resolvePlayer', () => {
  const vars = { url: 'C:\\Films\\a.avi', title: 'A', start: 12 };

  test('Beta détecté : ses options', () => {
    const beta = '/Applications/Beta.app/Contents/MacOS/Beta';
    assert.deepEqual(resolvePlayer({ path: '' }, vars, PLAYERS, noFiles('darwin', [beta])), { cmd: beta, args: playerArgs(BETA, vars) });
  });

  test('rien de détecté : le lecteur préféré par son nom', () => {
    assert.deepEqual(resolvePlayer({}, vars, PLAYERS, noFiles('linux')), { cmd: 'alpha', args: playerArgs(ALPHA, vars) });
  });

  test('chemin choisi par l’utilisateur (Windows) reconnu comme Beta ; inconnu : lecteur préféré', () => {
    const cmd = 'D:\\Outils\\Beta\\BETA.exe';
    assert.deepEqual(resolvePlayer({ path: `  ${cmd} ` }, vars, PLAYERS, noFiles('win32')), { cmd, args: playerArgs(BETA, vars) });
    assert.deepEqual(resolvePlayer({ path: 'D:\\autre.exe' }, vars, PLAYERS, noFiles('win32'))?.args, playerArgs(ALPHA, vars));
  });

  test('arguments personnalisés, variables remplacées', () => {
    const r = resolvePlayer({ path: '/opt/lecteur', args: ['-x', '{url}', '--at={start}'] }, vars, PLAYERS, noFiles('linux'));
    assert.deepEqual(r, { cmd: '/opt/lecteur', args: ['-x', 'C:\\Films\\a.avi', '--at=12'] });
  });

  test('aucun lecteur de plugin (plugin désactivé) : rien, même avec un programme choisi', () => {
    assert.equal(resolvePlayer({ path: '/usr/bin/alpha' }, vars, [], noFiles('linux', ['/usr/bin/alpha'])), null);
  });
});

// Lanceur simulé : enregistre les commandes, réussit ou échoue comme demandé.
function fakeLauncher(result = { ok: true } as { ok: boolean; error?: string; notFound?: boolean }) {
  const calls: { cmd: string; args: string[] }[] = [];
  const launcher: Launcher = {
    async launchProcess(cmd, args = []) {
      calls.push({ cmd, args });
      return { ...result };
    },
    async openTarget() {
      return { ok: true };
    },
  };
  return { launcher, calls };
}

function fakeShell() {
  const opened: string[] = [];
  return { opened, shell: { openExternal: async (u: string) => void opened.push(u), openPath: async (p: string) => (opened.push(p), '') } };
}

test.describe('createPlayers', () => {
  const settings =
    (externalPlayer = {}, browser = {}) =>
    () => ({ externalPlayer, browser });

  test('playExternal : fichier autorisé, lecteur lancé à la bonne position', async () => {
    const { launcher, calls } = fakeLauncher();
    const p = createPlayers({
      launcher,
      shell: fakeShell().shell,
      settings: settings(),
      isAllowed: () => true,
      players: () => PLAYERS,
      detectEnv: () => noFiles('linux', ['/usr/bin/beta']),
    });
    assert.deepEqual(await p.playExternal('/films/a.avi', 'A', '61.5'), { ok: true });
    assert.deepEqual(calls, [{ cmd: '/usr/bin/beta', args: ['--fullscreen', '--meta-title=A', '--start-time=61', '/films/a.avi'] }]);
    assert.deepEqual(p.list(), [
      { id: 'org.essai/alpha', name: 'pluginTexts.org_essai.apps.alpha.name' },
      { id: 'org.essai/beta', name: 'pluginTexts.org_essai.apps.beta.name' },
    ]);
  });

  test('playExternal : arguments du rendu vérifiés (option déguisée, titre non texte ou trop long)', async () => {
    const { launcher, calls } = fakeLauncher();
    const p = createPlayers({
      launcher,
      shell: fakeShell().shell,
      settings: settings(),
      isAllowed: () => true,
      players: () => PLAYERS,
      detectEnv: () => noFiles('linux'),
    });
    assert.equal((await p.playExternal('--script=/tmp/x.lua')).error, 'Rien à lire.');
    await p.playExternal('/films/a.avi', { titre: 'x' }, 'abc');
    await p.playExternal('/films/b.avi', 'T'.repeat(1000), 0);
    assert.deepEqual(calls[0], { cmd: 'alpha', args: ['--fs', '/films/a.avi'] });
    assert.equal(calls[1].args[1], `--force-media-title=${'T'.repeat(300)}`);
  });

  test('playExternal : plugin désactivé, aucun lecteur ; rien n’est lancé', async () => {
    const { launcher, calls } = fakeLauncher();
    const p = createPlayers({
      launcher,
      shell: fakeShell().shell,
      settings: settings({ path: '/usr/bin/alpha' }),
      isAllowed: () => true,
      players: () => [],
      detectEnv: () => noFiles('linux', ['/usr/bin/alpha']),
    });
    assert.deepEqual(p.list(), []);
    assert.match((await p.playExternal('/films/a.avi', 'A')).error || '', /^Le lecteur externe est désactivé/);
    assert.equal(calls.length, 0);
  });

  test('playExternal : refus hors bibliothèque, rien à lire, lecteur introuvable', async () => {
    const { launcher, calls } = fakeLauncher({ ok: false, error: 'Programme introuvable : mpv', notFound: true });
    const p = createPlayers({
      launcher,
      shell: fakeShell().shell,
      settings: settings(),
      isAllowed: () => false,
      players: () => PLAYERS,
      detectEnv: () => noFiles('linux'),
    });
    assert.equal((await p.playExternal('/ailleurs/a.avi')).error, 'Ce fichier ne fait pas partie de la bibliothèque.');
    assert.equal((await p.playExternal('')).error, 'Rien à lire.');
    assert.equal(calls.length, 0);
    const r = await p.playExternal('http://box/a.avi', 'A');
    assert.match(r.error || '', /^Aucun lecteur externe trouvé/);
  });

  test('openInBrowser : navigateur détecté en mode application, sinon navigateur du système', async () => {
    const { launcher, calls } = fakeLauncher();
    const { shell, opened } = fakeShell();
    const chrome = '/usr/bin/google-chrome';
    let files = [chrome];
    const p = createPlayers({ launcher, shell, settings: settings(), isAllowed: () => true, players: () => [], detectEnv: () => noFiles('linux', files) });
    await p.openInBrowser('https://exemple.fr');
    assert.deepEqual(calls, [{ cmd: chrome, args: ['--app=https://exemple.fr'] }]);
    files = [];
    assert.deepEqual(await p.openInBrowser('https://exemple.fr'), { ok: true });
    assert.deepEqual(opened, ['https://exemple.fr']);
  });
});

// Processus simulé : émet « spawn » ou « error » au tour suivant, comme child_process.
function fakeSpawn(outcome: 'spawn' | NodeJS.ErrnoException) {
  const calls: { command: string; argv: string[]; cwd: unknown }[] = [];
  let child: EventEmitter & { unref(): void } = Object.assign(new EventEmitter(), { unref() {} });
  const spawn = ((command: string, argv: string[], opts: { cwd?: string }) => {
    calls.push({ command, argv, cwd: opts.cwd });
    child = Object.assign(new EventEmitter(), { unref() {} });
    const c = child;
    setImmediate(() => (outcome === 'spawn' ? c.emit('spawn') : c.emit('error', outcome)));
    return c;
  }) as unknown as LauncherDeps['spawn'];
  return { spawn, calls, child: () => child };
}

test.describe('createLauncher', () => {
  const shell = fakeShell().shell;

  test('application macOS lancée par open -W -a ; dossier inexistant ignoré', async () => {
    const f = fakeSpawn('spawn');
    const l = createLauncher({ shell, platform: 'darwin', spawn: f.spawn, exists: () => false });
    assert.deepEqual(await l.launchProcess('/Applications/Jeu.app', ['-x'], { cwd: '/nulle/part' }), { ok: true });
    assert.deepEqual(f.calls, [{ command: 'open', argv: ['-W', '-a', '/Applications/Jeu.app', '--args', '-x'], cwd: undefined }]);
  });

  test('programme introuvable', async () => {
    const f = fakeSpawn(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }));
    const l = createLauncher({ shell, platform: 'linux', spawn: f.spawn });
    assert.deepEqual(await l.launchProcess('/jeux/x', []), { ok: false, error: 'Programme introuvable : /jeux/x', notFound: true });
  });

  test('réduire pendant le jeu : rappel au démarrage, rétablissement à la fermeture', async () => {
    const f = fakeSpawn('spawn');
    const events: string[] = [];
    const minimizeWhileRunning = () => {
      events.push('réduite');
      return () => events.push('rétablie');
    };
    const l = createLauncher({ shell, platform: 'win32', spawn: f.spawn, exists: () => true, minimizeWhileRunning });
    await l.launchProcess('C:\\Jeux\\jeu.exe', [], { cwd: 'C:\\Jeux' });
    assert.deepEqual(events, []);
    await l.launchProcess('C:\\Jeux\\jeu.exe', [], { cwd: 'C:\\Jeux', hideWhileRunning: true });
    assert.deepEqual(events, ['réduite']);
    f.child().emit('exit', 0);
    assert.deepEqual(events, ['réduite', 'rétablie']);
    assert.equal(f.calls[0].cwd, 'C:\\Jeux');
  });

  test('openTarget : adresses et raccourcis confiés au système', async () => {
    const s = fakeShell();
    const f = fakeSpawn('spawn');
    const l = createLauncher({ shell: s.shell, platform: 'win32', spawn: f.spawn });
    await l.openTarget('steam://rungameid/42');
    await l.openTarget('C:\\Jeux\\Jeu.LNK');
    await l.openTarget('C:\\Jeux\\lancer.bat');
    assert.deepEqual(s.opened, ['steam://rungameid/42', 'C:\\Jeux\\Jeu.LNK', 'C:\\Jeux\\lancer.bat']);
    assert.equal(f.calls.length, 0);
    await l.openTarget('/jeux/jeu.exe', ['-w']);
    assert.deepEqual(f.calls[0].argv, ['-w']);
  });
});
