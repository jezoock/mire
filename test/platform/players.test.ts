// Plateforme (P1-11) : arguments de mpv et VLC (position de reprise, titre), choix du lecteur, navigateur externe
// et lanceur. Le lancement est simulé : aucun programme réel n'est démarré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLauncher, createPlayers, resolvePlayer, MPV, VLC } from '../../src/main/platform/index.ts';
import type { DetectEnv, Launcher, LauncherDeps } from '../../src/main/platform/index.ts';

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

test.describe('arguments des lecteurs', () => {
  test('mpv : plein écran, titre, reprise, adresse', () => {
    assert.deepEqual(MPV.args({ url: '/films/a.avi', title: 'Film', start: 754.9 }), ['--fs', '--force-media-title=Film', '--start=754', '/films/a.avi']);
  });

  test('VLC : plein écran, titre, reprise, adresse', () => {
    assert.deepEqual(VLC.args({ url: '/films/a.avi', title: 'Film', start: 90 }), ['--fullscreen', '--meta-title=Film', '--start-time=90', '/films/a.avi']);
  });

  test('sans position ni titre, les arguments correspondants sont retirés', () => {
    assert.deepEqual(MPV.args({ url: 'u', title: '', start: 0 }), ['--fs', 'u']);
    assert.deepEqual(VLC.args({ url: 'u', title: 'T', start: Number.NaN }), ['--fullscreen', '--meta-title=T', 'u']);
  });
});

test.describe('resolvePlayer', () => {
  const vars = { url: 'C:\\Films\\a.avi', title: 'A', start: 12 };

  test('VLC détecté : préréglage VLC', () => {
    const vlc = '/Applications/VLC.app/Contents/MacOS/VLC';
    assert.deepEqual(resolvePlayer({ path: '' }, vars, noFiles('darwin', [vlc])), { cmd: vlc, args: VLC.args(vars) });
  });

  test('rien de détecté : mpv par son nom', () => {
    assert.deepEqual(resolvePlayer({}, vars, noFiles('linux')), { cmd: 'mpv', args: MPV.args(vars) });
  });

  test('chemin choisi (Windows) reconnu comme VLC', () => {
    const cmd = 'D:\\Outils\\VLC\\vlc.exe';
    assert.deepEqual(resolvePlayer({ path: `  ${cmd} ` }, vars, noFiles('win32')).args, VLC.args(vars));
  });

  test('arguments personnalisés, variables remplacées', () => {
    const r = resolvePlayer({ path: '/opt/lecteur', args: ['-x', '{url}', '--at={start}'] }, vars, noFiles('linux'));
    assert.deepEqual(r, { cmd: '/opt/lecteur', args: ['-x', 'C:\\Films\\a.avi', '--at=12'] });
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
      detectEnv: () => noFiles('linux', ['/usr/bin/vlc']),
    });
    assert.deepEqual(await p.playExternal('/films/a.avi', 'A', '61.5'), { ok: true });
    assert.deepEqual(calls, [{ cmd: '/usr/bin/vlc', args: ['--fullscreen', '--meta-title=A', '--start-time=61', '/films/a.avi'] }]);
  });

  test('playExternal : refus hors bibliothèque, rien à lire, lecteur introuvable', async () => {
    const { launcher, calls } = fakeLauncher({ ok: false, error: 'Programme introuvable : mpv', notFound: true });
    const p = createPlayers({ launcher, shell: fakeShell().shell, settings: settings(), isAllowed: () => false, detectEnv: () => noFiles('linux') });
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
    const p = createPlayers({ launcher, shell, settings: settings(), isAllowed: () => true, detectEnv: () => noFiles('linux', files) });
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
