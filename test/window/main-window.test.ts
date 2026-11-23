// Fenêtre principale (reprise de createMainWindow / themeBackground / minimizeWhileRunning de l'ancien index.js).
// Les réglages de sécurité de la page (isolation, bac à sable, pas de Node) sont vérifiés un par un.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RESCUE_CHANNEL, createMainWindow, readPaletteMeta, themeBackground } from '../../src/main/window/main-window.ts';
import { createRescue } from '../../src/main/app/rescue.ts';

// Les palettes du cœur, telles que la construction les copie à côté de la page (dist/renderer/palettes/).
const RENDERER = path.join(import.meta.dirname, '..', '..', 'src', 'renderer');
const PALETTES = path.join(RENDERER, 'palettes');

describe('themeBackground', () => {
  it('couleur de la palette, lue dans palette.json ; « auto » suit le système ; palette inconnue : écran', () => {
    assert.equal(themeBackground(PALETTES, 'contraste', false), '#000000');
    assert.equal(themeBackground(PALETTES, 'auto', true), '#1F2321');
    // Plein jour est un plugin (P5-02) : absent, « auto » en mode clair garde le fond de la palette par défaut.
    assert.equal(themeBackground(PALETTES, 'auto', false), '#1F2321');
    assert.equal(themeBackground(PALETTES, 'inconnu', false), '#1F2321');
    assert.equal(themeBackground(PALETTES, '../ecran', false), '#1F2321');
  });

  it('palette d’un plugin actif (P5-02) : son fond ; « auto » en mode clair prend Plein jour si son plugin est là', () => {
    const plugins = (id: string) => (id === 'velours' ? { background: '#1c1513' } : id === 'jour' ? { background: '#f1efe8' } : null);
    assert.equal(themeBackground(PALETTES, 'velours', false, plugins), '#1c1513');
    assert.equal(themeBackground(PALETTES, 'auto', false, plugins), '#f1efe8');
    // Une palette du cœur ne se remplace pas.
    assert.equal(
      themeBackground(PALETTES, 'ecran', false, () => ({ background: '#ffffff' })),
      '#1F2321',
    );
    assert.equal(themeBackground(PALETTES, 'minuit', false, plugins), '#1F2321');
  });

  it('palette illisible : celle par défaut, sinon noir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-palettes-'));
    try {
      fs.mkdirSync(path.join(dir, 'ecran'));
      fs.writeFileSync(path.join(dir, 'ecran', 'palette.json'), JSON.stringify({ name: 'palettes.ecran', background: '#123456', scheme: 'dark' }));
      fs.mkdirSync(path.join(dir, 'abimee'));
      fs.writeFileSync(path.join(dir, 'abimee', 'palette.json'), '{ pas du JSON');
      assert.equal(readPaletteMeta(dir, 'abimee'), null);
      assert.equal(themeBackground(dir, 'abimee', true), '#123456');
      assert.equal(themeBackground(path.join(dir, 'absent'), 'ecran', true), '#000000');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
  reloads = 0;
  reload() {
    this.reloads++;
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

function setup(ui: Record<string, unknown> = { theme: 'jour', fullscreen: false }, rescue?: ReturnType<typeof createRescue>) {
  const opened: string[] = [];
  const events: string[] = [];
  let closed = 0;
  const window = createMainWindow({
    BrowserWindow: FakeWindow as never,
    shell: { openExternal: async (url) => void opened.push(url) },
    nativeTheme: { shouldUseDarkColors: true },
    config: { get: () => ({ ui }) as never },
    files: { preload: '/dist/preload/preload.js', html: path.join(RENDERER, 'index.html') },
    web: () => ({
      onWindowResize: () => void events.push('resize'),
      onAppCommand: (cmd: string) => void events.push(cmd),
      onWindowClosed: () => void events.push('closed'),
    }),
    onClosed: () => void closed++,
    rescue,
  });
  return { window, opened, events, closed: () => closed };
}

describe('createMainWindow', () => {
  it('réglages de la fenêtre et de la page : isolation du contexte, bac à sable, pas de Node', () => {
    const { window } = setup({ theme: 'contraste', fullscreen: true });
    assert.equal(window.get(), null);
    window.open();
    const w = FakeWindow.last;
    assert.deepEqual(w.options, {
      width: 1600,
      height: 960,
      minWidth: 960,
      minHeight: 620,
      title: 'Mire',
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      fullscreen: true,
      show: false,
      webPreferences: { preload: '/dist/preload/preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    assert.equal(w.loaded, path.join(RENDERER, 'index.html'));
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

  it('mode secours : le raccourci est lu avant la page et ouvre l’explorateur ; Maj au lancement aussi', () => {
    const rescue = createRescue({ argv: ['mire', '--explorateur'] });
    const { window } = setup(undefined, rescue);
    window.open();
    const w = FakeWindow.last;
    let prevented = 0;
    const key = (k: string, mods: Record<string, boolean> = {}) =>
      w.webContents.emit('before-input-event', { preventDefault: () => prevented++ }, { type: 'keyDown', key: k, ...mods });
    key('Shift');
    key('E', { control: true, shift: true });
    key('e');
    assert.deepEqual(w.webContents.sent, [
      [RESCUE_CHANNEL, { reason: 'key' }],
      [RESCUE_CHANNEL, { reason: 'shortcut' }],
    ]);
    assert.equal(prevented, 1);
    // L'option et la touche ne changent que le premier écran : les réglages de la fenêtre restent les mêmes.
    assert.deepEqual(w.options.webPreferences, { preload: '/dist/preload/preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false });
    assert.deepEqual(rescue.takeStart(), { reason: 'option' });
  });

  it('mode secours : interface plantée rechargée ; deux fois de suite, sur l’explorateur ; fermeture normale ignorée', () => {
    const rescue = createRescue({ argv: [] });
    const { window } = setup(undefined, rescue);
    window.open();
    const wc = FakeWindow.last.webContents;
    wc.emit('render-process-gone', {}, { reason: 'clean-exit' });
    assert.equal(wc.reloads, 0);
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(wc.reloads, 1);
    assert.equal(rescue.takeStart(), null);
    wc.emit('render-process-gone', {}, { reason: 'oom' });
    assert.equal(wc.reloads, 2);
    assert.deepEqual(rescue.takeStart(), { reason: 'crash' });
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(wc.reloads, 3, 'plus de rechargement après trop de plantages');
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
