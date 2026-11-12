// Cycle de vie (reprise du démarrage de l'ancien index.js) : instance unique, fichiers passés en argument,
// menu de macOS, écritures différées attendues avant de quitter.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPendingFiles, filesFromArgv, runApp, setApplicationMenu, type Running } from '../../src/main/app/lifecycle.ts';

describe('filesFromArgv', () => {
  const isFile = (p: string) => p.endsWith('.mkv');
  it('application empaquetée : tout après le programme ; en développement : après « electron . »', () => {
    assert.deepEqual(filesFromArgv(['Mire.exe', 'a.mkv', '--flag', 'dossier', '', 'b.mkv'], { packaged: true, isFile }), ['a.mkv', 'b.mkv']);
    assert.deepEqual(filesFromArgv(['electron', '.', 'a.mkv', '-x'], { packaged: false, isFile }), ['a.mkv']);
  });

  it('chemins introuvables écartés (lecture du disque par défaut)', () => {
    assert.deepEqual(filesFromArgv(['Mire', '/chemin/introuvable.mkv', import.meta.filename], { packaged: true }), [import.meta.filename]);
  });
});

describe('createPendingFiles', () => {
  it('garde les fichiers jusqu’à ce que l’interface les prenne', () => {
    const p = createPendingFiles(['a.mkv']);
    assert.deepEqual(p.get(), ['a.mkv']);
    p.set([]);
    assert.deepEqual(p.get(), []);
  });
});

describe('setApplicationMenu', () => {
  it('macOS : menus application, édition, fenêtre ; ailleurs : aucun menu', () => {
    const set: unknown[] = [];
    const Menu = { setApplicationMenu: (m: unknown) => void set.push(m), buildFromTemplate: (t: unknown) => ({ menu: t }) };
    setApplicationMenu(Menu as never, 'darwin');
    setApplicationMenu(Menu as never, 'win32');
    assert.deepEqual(set, [{ menu: [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }] }, null]);
  });
});

class FakeApp extends EventEmitter {
  quits = 0;
  ready!: () => void;
  readyPromise = new Promise<void>((resolve) => (this.ready = resolve));
  lock: boolean;
  constructor(lock = true) {
    super();
    this.lock = lock;
  }
  requestSingleInstanceLock() {
    return this.lock;
  }
  quit() {
    this.quits++;
  }
  whenReady() {
    return this.readyPromise;
  }
}

const tick = () => new Promise((r) => setImmediate(r));

function run(app: FakeApp, platform: NodeJS.Platform = 'linux') {
  const log: string[] = [];
  let release!: () => void;
  const running: Running = {
    onSecondInstance: (files) => void log.push(`second:${files.join(',')}`),
    onActivate: () => void log.push('activate'),
    beforeQuit: () => {
      log.push('flush');
      return new Promise<void>((r) => (release = r));
    },
  };
  let pendingSeen: string[] | null = null;
  runApp({
    app,
    platform,
    argv: ['Mire', import.meta.filename, '--inspect'],
    packaged: true,
    start: (pending) => {
      pendingSeen = pending.get();
      log.push('start');
      return running;
    },
  });
  return { log, release: () => release(), pending: () => pendingSeen };
}

describe('runApp', () => {
  it('une autre instance tourne : on quitte sans rien démarrer', async () => {
    const app = new FakeApp(false);
    const { log } = run(app);
    app.ready();
    await tick();
    assert.equal(app.quits, 1);
    assert.deepEqual(log, []);
    assert.equal(app.listenerCount('second-instance'), 0);
  });

  it('démarre une fois prêt, avec les fichiers passés en argument', async () => {
    const app = new FakeApp();
    const { log, pending } = run(app);
    app.emit('second-instance', {}, ['Mire', import.meta.filename]);
    assert.deepEqual(log, []);
    app.ready();
    await tick();
    assert.deepEqual(pending(), [import.meta.filename]);
    app.emit('second-instance', {}, ['Mire', import.meta.filename, '/introuvable.mkv']);
    app.emit('activate');
    assert.deepEqual(log, ['start', `second:${import.meta.filename}`, 'activate']);
  });

  it('avant de quitter : écritures attendues une seule fois, puis on quitte', async () => {
    const app = new FakeApp();
    const { log, release } = run(app);
    app.ready();
    await tick();
    let prevented = 0;
    const quitting = { preventDefault: () => prevented++ };
    app.emit('before-quit', quitting);
    assert.equal(prevented, 1);
    assert.equal(app.quits, 0);
    release();
    await tick();
    assert.equal(app.quits, 1);
    app.emit('before-quit', quitting);
    assert.equal(prevented, 1);
    assert.deepEqual(log, ['start', 'flush']);
  });

  it('toutes les fenêtres fermées : on quitte, sauf sous macOS', () => {
    const linux = new FakeApp();
    run(linux, 'linux');
    linux.emit('window-all-closed');
    assert.equal(linux.quits, 1);
    const mac = new FakeApp();
    run(mac, 'darwin');
    mac.emit('window-all-closed');
    assert.equal(mac.quits, 0);
  });
});
