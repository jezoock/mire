// Vues web (P1-12) : gestionnaire avec de fausses vues et une fausse fenêtre, session (permissions, identité Google,
// liens magnet) et Widevine. Aucune page n'est chargée.
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDrm, createWebManager, setupWebSession, WEB_PREFERENCES } from '../../src/main/web/index.ts';

type Any = any;

function fakeContents(id: number) {
  const listeners = new Map<string, ((...args: Any[]) => void)[]>();
  const history = ['about:blank'];
  let pos = 0;
  const wc: Any = {
    id,
    log: [] as Any[],
    destroyed: false,
    openHandler: null as Any,
    navigationHistory: {
      canGoBack: () => pos > 0,
      canGoForward: () => pos < history.length - 1,
      goBack: () => (pos -= 1),
      goForward: () => (pos += 1),
    },
    mainFrame: { framesInSubtree: [{ executeJavaScript: async (code: string) => wc.log.push(['js', code]) }] },
    getTitle: () => `Titre ${id}`,
    getURL: () => history[pos],
    isLoading: () => false,
    isDestroyed: () => wc.destroyed,
    loadURL(url: string) {
      history.splice(pos + 1, Infinity, url);
      pos = history.length - 1;
      wc.log.push(['load', url]);
    },
    downloadURL: (url: string) => wc.log.push(['download', url]),
    reload: () => wc.log.push(['reload']),
    stop: () => wc.log.push(['stop']),
    focus: () => wc.log.push(['focus']),
    close: () => wc.log.push(['close']),
    sendInputEvent: (ev: Any) => wc.log.push(['input', ev.type, ev.keyCode]),
    setWindowOpenHandler: (h: Any) => (wc.openHandler = h),
    on(ev: string, fn: Any) {
      listeners.set(ev, [...(listeners.get(ev) || []), fn]);
    },
    emit: (ev: string, ...args: Any[]) => (listeners.get(ev) || []).forEach((fn) => fn(...args)),
  };
  return wc;
}

function setup(extra: Any = {}) {
  const sent: Any[] = [];
  const created: Any[] = [];
  const win: Any = {
    fullScreen: false,
    children: [] as Any[],
    focused: 0,
    isDestroyed: () => false,
    isFullScreen: () => win.fullScreen,
    setFullScreen: (on: boolean) => (win.fullScreen = on),
    getContentSize: () => [1600, 900],
    contentView: {
      addChildView: (v: Any) => win.children.push(v),
      removeChildView: (v: Any) => (win.children = win.children.filter((x: Any) => x !== v)),
    },
    webContents: { focus: () => (win.focused += 1) },
  };
  let config: Any = {
    web: [
      { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/browse', mode: 'integrated', search: '', color: '#E50914' },
      { id: 'radio', name: 'Radio', url: 'https://radio.example/', mode: 'integrated', search: '', background: true },
      { id: 'ext', name: 'Ailleurs', url: 'https://ext.example/', mode: 'browser', search: '' },
    ],
    bookmarks: [{ id: 'b1', title: 'Film', site: 'Ex', url: 'https://ex.example/film' }],
    tv: { services: [{ id: 'sfr', name: 'SFR', kind: 'web', url: 'https://tv.sfr.fr/' }] },
    emulators: [
      {
        id: 'snes-1',
        name: 'Super Nintendo',
        romSites: [
          { name: 'A', url: 'https://a.example/' },
          { name: 'B', url: 'https://b.example/' },
        ],
      },
    ],
    pcSites: [],
  };
  const downloads = {
    log: [] as Any[],
    handleWebDownload: (item: Any, ctx: Any) => downloads.log.push(['web', item, ctx]),
    addTorrent: async (url: string, ctx: Any) => (downloads.log.push(['torrent', url, ctx]), { ok: true }),
  };
  const browser: string[] = [];
  const web = createWebManager({
    window: () => win,
    createView(prefs) {
      const wc = fakeContents(created.length + 1);
      const view: Any = {
        webContents: wc,
        prefs,
        visible: false,
        bounds: null,
        setBackgroundColor() {},
        setVisible: (v: boolean) => (view.visible = v),
        setBounds: (b: Any) => (view.bounds = b),
      };
      created.push(view);
      return view;
    },
    config: {
      get: () => config,
      update: (fn: Any) => (config = fn(config)),
    },
    defaultRomSites: () => [],
    guessSystem: () => '',
    downloads: () => downloads,
    adblock: () => null,
    whenReady: async () => {},
    openInBrowser: async (url) => (browser.push(url), { ok: true }),
    toUi: (channel, payload) => sent.push([channel, payload]),
    ...extra,
  });
  return { web, win, created, sent, downloads, browser, config: () => config };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

const channels = (sent: Any[], name: string) => sent.filter(([c]) => c === name).map(([, p]) => p);

describe('ouverture', () => {
  test('une vue par site, isolée et dans le bac à sable ; réouverture sans rechargement', async () => {
    const r = await t.web.open('netflix');
    assert.equal(r.ok, true);
    assert.equal(t.created.length, 1);
    assert.equal(t.created[0].prefs, WEB_PREFERENCES);
    assert.deepEqual({ ...WEB_PREFERENCES }, { partition: 'persist:web', contextIsolation: true, sandbox: true, nodeIntegration: false });
    assert.deepEqual(t.created[0].webContents.log, [['load', 'https://www.netflix.com/browse']]);
    assert.deepEqual(channels(t.sent, 'web-sessions').at(-1), [{ id: 'netflix', name: 'Netflix', color: '#E50914' }]);

    await t.web.open('netflix');
    assert.equal(t.created.length, 1);
    assert.equal(t.created[0].webContents.log.length, 1);
    await t.web.open('netflix', 'https://www.netflix.com/title/1');
    assert.deepEqual(t.created[0].webContents.log.at(-1), ['load', 'https://www.netflix.com/title/1']);
  });

  test('marque-page et sites de jeux déjà ouverts : réaffichés sans rechargement', async () => {
    await t.web.open('bm:b1', null);
    await t.web.open('rom:snes-1', undefined, { site: 1 });
    assert.equal(t.created.length, 2);
    await t.web.open('bm:b1', null);
    await t.web.open('rom:snes-1');
    assert.equal(t.created[0].webContents.log.length, 1);
    assert.equal(t.created[1].webContents.log.length, 1);
    // Sans site demandé, la vue garde le site choisi.
    assert.equal((t.web.stateOf('rom:snes-1') as Any).rom.site, 1);
  });

  test('changer de site de jeux recharge la vue', async () => {
    await t.web.open('rom:snes-1');
    await t.web.open('rom:snes-1', undefined, { site: 1 });
    assert.deepEqual(t.created[0].webContents.log.at(-1), ['load', 'https://b.example/']);
    const st: Any = t.web.stateOf('rom:snes-1');
    assert.equal(st.rom.consoleName, 'Super Nintendo');
    assert.equal(st.bookmarkUrl, null);
  });

  test('site « navigateur » : ouvert dehors ; site inconnu : erreur', async () => {
    assert.deepEqual(await t.web.open('ext'), { ok: true, integrated: false });
    assert.deepEqual(t.browser, ['https://ext.example/']);
    const r: Any = await t.web.open('absent');
    assert.equal(r.ok, false);
    assert.equal(t.created.length, 0);
  });

  test('attend Widevine et le bloqueur avant la première vue', async () => {
    let release: Any;
    const s = setup({ whenReady: () => new Promise((r) => (release = r)) });
    const p = s.web.open('netflix');
    await Promise.resolve();
    assert.equal(s.created.length, 0);
    release();
    await p;
    assert.equal(s.created.length, 1);
  });
});

describe('affichage', () => {
  test('une seule vue visible ; changer de site met en pause les vidéos du précédent, pas la musique', async () => {
    await t.web.open('netflix');
    await t.web.open('radio');
    const [netflix, radio] = t.created;
    t.web.show('netflix', { x: 10.4, y: 20, width: 800, height: 600 });
    assert.equal(netflix.visible, true);
    assert.equal(radio.visible, false);
    assert.deepEqual(netflix.bounds, { x: 10, y: 20, width: 800, height: 600 });
    t.web.show('radio');
    assert.ok(netflix.webContents.log.some(([k]: Any) => k === 'js'));
    assert.equal(netflix.visible, false);
    t.web.show('netflix');
    assert.ok(!radio.webContents.log.some(([k]: Any) => k === 'js'));
  });

  test('masquer rend le focus à Mire', async () => {
    await t.web.open('netflix');
    t.web.show('netflix');
    t.web.hide();
    assert.equal(t.created[0].visible, false);
    assert.equal(t.win.focused, 1);
    assert.equal(t.web.key('Enter'), false);
  });

  test('F11 : immersif en plein écran ; Échap en sort ; F9 revient à Mire', async () => {
    await t.web.open('netflix');
    t.web.show('netflix', { x: 0, y: 60, width: 800, height: 600 });
    const wc = t.created[0].webContents;
    const press = (key: string, mods: Any = {}) => {
      let prevented = false;
      wc.emit('before-input-event', { preventDefault: () => (prevented = true) }, { type: 'keyDown', key, ...mods });
      return prevented;
    };
    assert.equal(press('F11'), true);
    assert.equal(t.win.fullScreen, true);
    assert.deepEqual(t.created[0].bounds, { x: 0, y: 0, width: 1600, height: 900 });
    assert.equal(press('Escape'), true);
    assert.equal(t.win.fullScreen, false);
    assert.deepEqual(t.created[0].bounds, { x: 0, y: 60, width: 800, height: 600 });
    assert.equal(press('a'), false);
    assert.equal(press('F9'), true);
    assert.deepEqual(channels(t.sent, 'web-focus').at(-1), false);
    assert.ok(t.sent.some(([c]) => c === 'web-mire-focus'));
  });

  test('plein écran du lecteur vidéo : Échap laissé à la page, fenêtre rétablie à la sortie', async () => {
    await t.web.open('netflix');
    t.web.show('netflix');
    const wc = t.created[0].webContents;
    wc.emit('enter-html-full-screen');
    assert.equal(t.win.fullScreen, true);
    assert.equal((t.web.stateOf('netflix') as Any).immersive, true);
    let prevented = false;
    wc.emit('before-input-event', { preventDefault: () => (prevented = true) }, { type: 'keyDown', key: 'Escape' });
    assert.equal(prevented, false);
    wc.emit('leave-html-full-screen');
    assert.equal(t.win.fullScreen, false);
  });

  test('Ctrl+W ferme la vue et prévient l’interface', async () => {
    await t.web.open('netflix');
    t.web.show('netflix');
    t.created[0].webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'w', control: true });
    assert.deepEqual(t.win.children, []);
    assert.deepEqual(t.created[0].webContents.log.at(-1), ['close']);
    assert.deepEqual(channels(t.sent, 'web-closed'), [{ id: 'netflix' }]);
    assert.deepEqual(t.web.sessions(), []);
    assert.equal(t.web.close('netflix'), false);
  });

  test('navigation et touches de la manette vers la vue affichée', async () => {
    await t.web.open('netflix');
    t.web.show('netflix');
    const wc = t.created[0].webContents;
    wc.loadURL('https://www.netflix.com/title/2');
    t.web.nav('back');
    assert.equal(wc.getURL(), 'https://www.netflix.com/browse');
    t.web.onAppCommand('browser-forward');
    assert.equal(wc.getURL(), 'https://www.netflix.com/title/2');
    t.web.nav('home');
    assert.equal(wc.getURL(), 'https://www.netflix.com/browse');
    t.web.key('Back');
    assert.equal(wc.getURL(), 'https://www.netflix.com/title/2');
    t.web.key('Space');
    assert.deepEqual(wc.log.slice(-3), [
      ['input', 'keyDown', 'Space'],
      ['input', 'char', ' '],
      ['input', 'keyUp', 'Space'],
    ]);
    t.web.nav('browser');
    assert.deepEqual(t.browser, ['https://www.netflix.com/title/2']);
  });
});

describe('recherche mémorisée', () => {
  test('site enregistré : modèle dans la configuration', async () => {
    await t.web.open('netflix', 'https://www.netflix.com/search?q=mire');
    const r: Any = t.web.learnSearch('netflix');
    assert.deepEqual([r.ok, r.template], [true, 'https://www.netflix.com/search?q={q}']);
    assert.equal(t.config().web[0].search, 'https://www.netflix.com/search?q={q}');
    assert.equal((t.web.stateOf('netflix') as Any).hasSearch, true);
  });

  test('site de jeux : modèle sur le site choisi de la console', async () => {
    await t.web.open('rom:snes-1', 'https://b.example/?s=mire', { site: 1 });
    t.web.learnSearch('rom:snes-1');
    assert.deepEqual(t.config().emulators[0].romSites, [
      { name: 'A', url: 'https://a.example/' },
      { name: 'B', url: 'https://b.example/', search: 'https://b.example/?s={q}' },
    ]);
    assert.equal((t.web.stateOf('rom:snes-1') as Any).hasSearch, true);
  });

  test('aucun site ouvert', () => {
    assert.deepEqual(t.web.learnSearch(null), { ok: false, error: 'Aucun site ouvert.' });
  });
});

describe('téléchargements', () => {
  test('depuis « Ajouter des jeux » : fichier de jeu téléchargé dans le dossier de la console', async () => {
    await t.web.open('rom:snes-1');
    const wc = t.created[0].webContents;
    assert.deepEqual(wc.openHandler({ url: 'https://cdn.example/jeu.zip?dl=1' }), { action: 'deny' });
    assert.deepEqual(wc.log.at(-1), ['download', 'https://cdn.example/jeu.zip?dl=1']);
    t.web.onDownload({}, 'élément', wc);
    assert.deepEqual(t.downloads.log.at(-1), ['web', 'élément', { console: 'snes-1' }]);
  });

  test('lien magnet : pris par le gestionnaire, depuis une fenêtre ou une navigation', async () => {
    await t.web.open('netflix');
    const wc = t.created[0].webContents;
    assert.deepEqual(wc.openHandler({ url: 'magnet:?xt=1' }), { action: 'deny' });
    let prevented = false;
    wc.emit('will-navigate', { url: 'magnet:?xt=2', preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.deepEqual(
      t.downloads.log.map(([k, u, c]: Any) => [k, u, c]),
      [
        ['torrent', 'magnet:?xt=1', {}],
        ['torrent', 'magnet:?xt=2', {}],
      ],
    );
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(channels(t.sent, 'download-added').at(-1), { ok: true, external: false });
    assert.equal(t.web.takeMagnet('https://pas-un-magnet/', wc), false);
  });

  test('configuration enregistrée : les sites ouverts reprennent leur entrée', async () => {
    await t.web.open('netflix');
    t.web.refreshEntries({ web: [{ id: 'netflix', name: 'Netflix FR', url: 'https://www.netflix.com/fr', search: 'q' }] });
    assert.equal((t.web.stateOf('netflix') as Any).name, 'Netflix FR');
  });
});

describe('session', () => {
  function fakeSession() {
    const ses: Any = { handlers: {}, ipc: {} };
    ses.on = (ev: string, fn: Any) => (ses.handlers[ev] = fn);
    ses.setPermissionRequestHandler = (fn: Any) => (ses.handlers.permission = fn);
    ses.webRequest = { onBeforeSendHeaders: (fn: Any) => (ses.handlers.headers = fn) };
    ses.registerPreloadScript = (s: Any) => (ses.preload = s);
    return ses;
  }
  const pages: Record<number, string> = { 1: 'https://accounts.google.com/signin', 2: 'https://www.youtube.com/' };
  function wire(magnets: string[] = []) {
    const ses = fakeSession();
    setupWebSession({
      session: ses,
      ipcMain: { on: (ch: string, fn: Any) => (ses.ipc[ch] = fn) },
      contentsFromId: (id) => ({ getURL: () => pages[id], isDestroyed: () => false }),
      nativeUserAgent: 'UA-Electron',
      preloadPath: '/p/web-preload.js',
      onDownload: () => {},
      takeMagnet: (url) => (url.startsWith('magnet:') ? (magnets.push(url), true) : false),
      scriptletsFor: (url) => `/* ${url} */`,
    });
    return ses;
  }

  test('permissions accordées et refusées ; lien magnet externe pris', () => {
    const magnets: string[] = [];
    const ses = wire(magnets);
    const ask = (permission: string, details?: Any) => {
      let answer: boolean | null = null;
      ses.handlers.permission(null, permission, (ok: boolean) => (answer = ok), details);
      return answer;
    };
    assert.equal(ask('protected-media-identifier'), true);
    assert.equal(ask('geolocation'), false);
    assert.equal(ask('openExternal', { externalURL: 'magnet:?xt=3' }), false);
    assert.deepEqual(magnets, ['magnet:?xt=3']);
    assert.equal(ses.preload.filePath, '/p/web-preload.js');
  });

  test('identité Electron pour la connexion Google et ce qu’elle charge, seulement', () => {
    const ses = wire();
    const send = (details: Any) => {
      let out: Any;
      ses.handlers.headers({ requestHeaders: { 'User-Agent': 'UA-Chrome' }, ...details }, (r: Any) => (out = r.requestHeaders['User-Agent']));
      return out;
    };
    assert.equal(send({ resourceType: 'mainFrame', url: 'https://accounts.google.com/' }), 'UA-Electron');
    assert.equal(send({ resourceType: 'script', url: 'https://gstatic.com/x.js', webContentsId: 1 }), 'UA-Electron');
    assert.equal(send({ resourceType: 'script', url: 'https://gstatic.com/x.js', webContentsId: 2 }), 'UA-Chrome');
    assert.equal(send({ resourceType: 'mainFrame', url: 'https://www.google.com/' }), 'UA-Chrome');

    const ev: Any = { sender: { getURL: () => pages[1], isDestroyed: () => false } };
    ses.ipc['mire:signin-ua'](ev);
    assert.equal(ev.returnValue, 'UA-Electron');
    const ev2: Any = {};
    ses.ipc['mire:scriptlets'](ev2, 'https://site/');
    assert.equal(ev2.returnValue, '/* https://site/ */');
  });
});

describe('Widevine', () => {
  test('sans castLabs : rien à attendre', async () => {
    const drm = createDrm({ components: null, platform: 'linux' });
    drm.start();
    assert.equal(await drm.whenReady(), false);
    assert.deepEqual(drm.status(), { ecs: false, platform: 'linux' });
  });

  test('prêt, en échec ou trop lent', async () => {
    const comp = (whenReady: () => Promise<unknown>): Any => ({
      whenReady,
      WIDEVINE_CDM_ID: 'wv',
      status: () => ({ wv: { status: 'ok', version: '4.10' } }),
    });
    const ok = createDrm({ components: comp(async () => {}), platform: 'win32' });
    ok.start();
    assert.equal(await ok.whenReady(), true);
    assert.deepEqual(ok.status(), { ecs: true, platform: 'win32', widevine: { status: 'ok', version: '4.10' } });

    const errors: unknown[] = [];
    const ko = createDrm({ components: comp(() => Promise.reject(new Error('non'))), onError: (e) => errors.push(e) });
    ko.start();
    assert.equal(await ko.whenReady(), false);
    assert.equal(errors.length, 1);

    const slow = createDrm({ components: comp(() => new Promise(() => {})), timeoutMs: 5 });
    slow.start();
    assert.equal(await slow.whenReady(), false);
  });
});
