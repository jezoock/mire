// Fenêtre principale (reprise de createMainWindow / themeBackground / minimizeWhileRunning de l'ancien index.js).
// Les réglages de sécurité de la page (isolation, bac à sable, pas de Node) sont vérifiés un par un.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMainWindow, themeBackground } from '../../src/main/window/main-window.ts';

describe('themeBackground', () => {
  it('couleur du thème ; « auto » suit le système ; thème inconnu : écran', () => {
    assert.equal(themeBackground('minuit', false), '#0F1524');
    assert.equal(themeBackground('auto', true), '#1F2321');
    assert.equal(themeBackground('auto', false), '#F1EFE8');
    assert.equal(themeBackground('inconnu', false), '#1F2321');
  });
});

class FakeContents extends EventEmitter {
  sent: [string, unknown][] = [];
  devTools = 0;
  openHandler: ((d: { url: string }) => { action: string }) | null = null;
  send(channel: string, payload: unknown) {
    this.sent.push([channel, payload]);
  }
  setWindowOpenHandler(h: (d: { url: string }) => { action: string }) {
    this.openHandler = h;
  }
  toggleDevTools() {
    this.devTools++;
  }
}

class FakeWindow extends EventEmitter {
  static last: FakeWindow;
  options: Record<string, any>;
  webContents = new FakeContents();
  destroyed = false;
  full = false;
  minimized = false;
  shown = false;
  focused = 0;
  loaded = '';
  constructor(options: Record<string, any>) {
    super();
    this.options = options;
    FakeWindow.last = this;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isFullScreen() {
    return this.full;
  }
  setFullScreen(on: boolean) {
    this.full = on;
  }
  isMinimized() {
    return this.minimized;
  }
  minimize() {
    this.minimized = true;
  }
  restore() {
    this.minimized = false;
  }
  focus() {
    this.focused++;
  }
  show() {
    this.shown = true;
  }
  loadFile(file: string) {
    this.loaded = file;
  }
}

function setup(ui: Record<string, unknown> = { theme: 'jour', fullscreen: false }) {
  const opened: string[] = [];
  const events: string[] = [];
  let closed = 0;
  const window = createMainWindow({
    BrowserWindow: FakeWindow as never,
    shell: { openExternal: async (url) => void opened.push(url) },
    nativeTheme: { shouldUseDarkColors: true },
    config: { get: () => ({ ui }) as never },
    files: { preload: '/dist/preload/preload.js', html: '/dist/renderer/index.html' },
    web: () => ({
      onWindowResize: () => void events.push('resize'),
      onAppCommand: (cmd: string) => void events.push(cmd),
      onWindowClosed: () => void events.push('closed'),
    }),
    onClosed: () => void closed++,
  });
  return { window, opened, events, closed: () => closed };
}

describe('createMainWindow', () => {
  it('réglages de la fenêtre et de la page : isolation du contexte, bac à sable, pas de Node', () => {
    const { window } = setup({ theme: 'velours', fullscreen: true });
    assert.equal(window.get(), null);
    window.open();
    const w = FakeWindow.last;
    assert.deepEqual(w.options, {
      width: 1600,
      height: 960,
      minWidth: 960,
      minHeight: 620,
      title: 'Mire',
      backgroundColor: '#1C1513',
      autoHideMenuBar: true,
      fullscreen: true,
      show: false,
      webPreferences: { preload: '/dist/preload/preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    assert.equal(w.loaded, '/dist/renderer/index.html');
    assert.equal(window.get(), w as never);
    assert.equal(w.shown, false);
    w.emit('ready-to-show');
    assert.equal(w.shown, true);
  });

  it('aucune nouvelle fenêtre : les liens web partent dans le navigateur ; aucune navigation de la page', () => {
    const { window, opened } = setup();
    window.open();
    const wc = FakeWindow.last.webContents;
    assert.deepEqual(wc.openHandler!({ url: 'https://exemple.fr/' }), { action: 'deny' });
    assert.deepEqual(wc.openHandler!({ url: 'file:///etc/passwd' }), { action: 'deny' });
    assert.deepEqual(wc.openHandler!({ url: 'javascript:alert(1)' }), { action: 'deny' });
    assert.deepEqual(opened, ['https://exemple.fr/']);
    let prevented = false;
    wc.emit('will-navigate', { preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
  });

  it('F11 : plein écran ; F12 : outils de développement ; touches relâchées ignorées', () => {
    const { window } = setup();
    window.open();
    const w = FakeWindow.last;
    let prevented = 0;
    const key = (key: string, type = 'keyDown') => w.webContents.emit('before-input-event', { preventDefault: () => prevented++ }, { type, key });
    key('F11');
    assert.equal(w.full, true);
    key('F12');
    assert.equal(w.webContents.devTools, 1);
    key('F11', 'keyUp');
    key('a');
    assert.equal(w.full, true);
    assert.equal(prevented, 2);
  });

  it('messages vers l’interface : envoyés tant que la fenêtre existe', () => {
    const { window } = setup();
    window.toUi('download', 1);
    window.open();
    const w = FakeWindow.last;
    window.toUi('download', 2);
    w.destroyed = true;
    window.toUi('download', 3);
    assert.deepEqual(w.webContents.sent, [['download', 2]]);
  });

  it('réduire pendant le jeu, puis rétablir ; deuxième lancement : premier plan', () => {
    const { window } = setup();
    assert.equal(window.minimizeWhileRunning(), undefined);
    assert.equal(window.bringToFront(), false);
    window.open();
    const w = FakeWindow.last;
    const restore = window.minimizeWhileRunning();
    assert.equal(w.minimized, true);
    restore!();
    assert.equal(w.minimized, false);
    assert.equal(w.focused, 1);
    w.minimize();
    assert.equal(window.bringToFront(), true);
    assert.equal(w.minimized, false);
  });

  it('taille, boutons de la souris et fermeture transmis aux vues web', () => {
    const { window, events, closed } = setup();
    window.open();
    const w = FakeWindow.last;
    w.emit('resize');
    w.emit('app-command', {}, 'browser-backward');
    w.emit('closed');
    assert.deepEqual(events, ['resize', 'browser-backward', 'closed']);
    assert.equal(closed(), 1);
    assert.equal(window.get(), null);
  });

  it('couleur de fond : celle du thème de la configuration', () => {
    assert.equal(setup({ theme: 'auto' }).window.themeBackground(), '#1F2321');
  });
});
