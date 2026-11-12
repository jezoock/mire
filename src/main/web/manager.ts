/**
 * Gestionnaire des vues web intégrées : une vue par site ouvert (on passe de Netflix à Mire et on revient sans tout
 * recharger). Création, affichage, position, mode immersif, plein écran du lecteur vidéo, fermeture, focus, touches
 * de la manette, pause des vidéos, état publié vers l'interface. L'état (vue active, visible, immersif…) est interne ;
 * la fenêtre, la configuration, les téléchargements et les extensions (bloqueur…) sont injectés.
 */
import type { WebState, WebSession } from '@mire/shared/ipc';
import { GAME_FILE_RE, hostOf, isHttpUrl, siteOf } from '@mire/shared';
import { consoleName, consoleSites, createEntryRegistry, romEntryFor } from './entries.ts';
import { searchTemplate, withSearchTemplate } from './learn-search.ts';
import { padInputEvents, shortcutAction } from './shortcuts.ts';
import type { KeyInput, Rect, ViewLike, WebContentsLike, WebEntry, WebManagerDeps } from './types.ts';
import type { DownloadContext } from '../downloads/types.ts';
import { t } from '../i18n/current.ts';

// Préférences de toutes les vues : jamais d'accès à Node, isolation et bac à sable.
export const WEB_PREFERENCES = Object.freeze({ partition: 'persist:web', contextIsolation: true, sandbox: true, nodeIntegration: false });

interface View {
  view: ViewLike;
  entry: WebEntry;
}

export const roundRect = (r: Partial<Rect> | null | undefined): Rect => ({
  x: Math.max(0, Math.round(r?.x || 0)),
  y: Math.max(0, Math.round(r?.y || 0)),
  width: Math.max(0, Math.round(r?.width || 0)),
  height: Math.max(0, Math.round(r?.height || 0)),
});

/**
 * Lien ouvert dans une nouvelle fenêtre (les fenêtres surgissantes sont bloquées) : téléchargé depuis « Ajouter
 * des jeux » quand c'est un fichier de jeu (tout fichier pour les jeux PC), chargé dans la vue s'il reste sur le même
 * site, ignoré sinon. Seul le chemin de l'adresse est testé : `jeu.zip?dl=1` est un fichier de jeu.
 */
export function windowOpenAction(url: string, entry: Pick<WebEntry, 'romConsole'>, pageUrl: string): 'download' | 'load' | 'deny' {
  if (!/^https?:/i.test(url)) return 'deny';
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* adresse illisible */
  }
  if (entry.romConsole != null && (entry.romConsole === 'pc' || GAME_FILE_RE.test(pathname))) return 'download';
  if (siteOf(url) === siteOf(pageUrl)) return 'load';
  return 'deny';
}

/** Destination d'un téléchargement : le dossier de la console depuis « Ajouter des jeux », sinon celui par défaut. */
export function downloadContextOf(entry: Pick<WebEntry, 'romConsole'> | null | undefined): DownloadContext {
  const rc = entry?.romConsole;
  return rc != null && rc !== 'pc' ? { console: rc } : {};
}

export function createWebManager(deps: WebManagerDeps) {
  const views = new Map<string, View>();
  const state = { activeId: null as string | null, visible: false, bounds: roundRect(null), immersive: false, html: false, setFs: false };
  const entries = createEntryRegistry(deps.resolvers);
  const siteDefaults = { defaultRomSites: deps.defaultRomSites, guessSystem: deps.guessSystem };
  const sitesOf = (consoleId: unknown) => consoleSites(deps.config.get(), consoleId, siteDefaults);
  const { toUi } = deps;

  const liveWindow = () => {
    const win = deps.window();
    return win && !win.isDestroyed() ? win : null;
  };
  const active = () => (state.activeId ? views.get(state.activeId) : undefined);

  function sessions(): WebSession[] {
    return [...views.values()].map(({ entry }) => ({ id: entry.id, name: entry.name as string, color: entry.color }));
  }

  function stateOf(id: string): WebState | null {
    const w = views.get(id);
    if (!w) return null;
    const wc = w.view.webContents;
    const { entry } = w;
    const ext = deps.extensions();
    const rc = entry.romConsole;
    return {
      id,
      name: entry.name,
      color: entry.color,
      title: wc.getTitle(),
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      immersive: state.immersive || state.html,
      hasSearch: !!entry.search,
      blocked: ext ? ext.blockedCount(wc.id) : 0,
      bookmarkUrl: String(entry.id).startsWith('bm:') ? null : rc == null ? wc.getURL() : null,
      rom:
        rc != null
          ? {
              console: rc,
              consoleName: consoleName(deps.config.get(), rc),
              site: entry.romSite,
              pc: rc === 'pc',
              sites: sitesOf(rc).map((x) => ({ name: x.name, url: x.url, search: x.search || '' })),
            }
          : null,
      adOn: !!ext && ext.activeOn(wc.getURL()),
    };
  }

  function pushState(id: string) {
    const st = stateOf(id);
    if (st) toUi('web-state', st);
  }

  function fullBounds(win: NonNullable<ReturnType<typeof liveWindow>>): Rect {
    const [width, height] = win.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  function apply() {
    const win = liveWindow();
    if (!win) return;
    for (const [id, w] of views) {
      const show = state.visible && id === state.activeId;
      w.view.setVisible(show);
      if (show) w.view.setBounds(state.immersive || state.html ? fullBounds(win) : state.bounds);
    }
  }

  // Met en pause les vidéos d'un site qu'on quitte (sauf la musique, qui continue en fond).
  function pauseVideos(w: View | undefined) {
    if (!w || w.entry.background) return;
    try {
      for (const f of w.view.webContents.mainFrame?.framesInSubtree || []) {
        f.executeJavaScript("document.querySelectorAll('video').forEach((v) => v.pause())").catch(() => {});
      }
    } catch {
      /* page en cours de chargement */
    }
  }

  function setImmersive(on: boolean) {
    const win = deps.window();
    if (!win) return;
    state.immersive = on;
    if (on && !win.isFullScreen()) {
      state.setFs = true;
      win.setFullScreen(true);
    } else if (!on && state.setFs && !state.html) {
      state.setFs = false;
      win.setFullScreen(false);
    }
    apply();
    if (state.activeId) pushState(state.activeId);
  }

  // Plein écran demandé (ou quitté) par le lecteur vidéo du site.
  function setHtmlFullScreen(id: string, on: boolean) {
    const win = deps.window();
    state.html = on;
    if (win && on && !win.isFullScreen()) {
      state.setFs = true;
      win.setFullScreen(true);
    } else if (win && !on && state.setFs && !state.immersive) {
      state.setFs = false;
      win.setFullScreen(false);
    }
    apply();
    pushState(id);
  }

  function focusMire() {
    const win = deps.window();
    if (!win) return;
    if (state.immersive) setImmersive(false);
    win.webContents.focus();
    toUi('web-focus', false);
    toUi('web-mire-focus');
  }

  function goBack(wc: WebContentsLike) {
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  function goForward(wc: WebContentsLike) {
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  function handleShortcut(id: string, input: KeyInput): boolean {
    const w = views.get(id);
    if (!w) return false;
    const wc = w.view.webContents;
    const action = shortcutAction(input, state);
    if (action === 'toggle-immersive') setImmersive(!state.immersive);
    else if (action === 'leave-immersive') setImmersive(false);
    else if (action === 'mire') focusMire();
    else if (action === 'reload') wc.reload();
    else if (action === 'close') close(id);
    else if (action === 'back') goBack(wc);
    else if (action === 'forward') goForward(wc);
    return action != null;
  }

  function viewOfContents(wc: unknown) {
    return wc ? [...views.values()].find((x) => !x.view.webContents.isDestroyed() && x.view.webContents === wc) || null : null;
  }

  // Lien magnet ouvert par une page : il part dans le gestionnaire de téléchargements au lieu du système.
  function takeMagnet(url: string, wc: unknown): boolean {
    const downloads = deps.downloads();
    if (!downloads || !/^magnet:\?/i.test(url)) return false;
    downloads.addTorrent(url, downloadContextOf(viewOfContents(wc)?.entry)).then((r) => {
      toUi('download-added', r?.ok ? { ok: true, external: !!r.external } : { ok: false, error: r?.error });
    });
    return true;
  }

  // Tout téléchargement des pages passe par le gestionnaire. Depuis « Ajouter des jeux », il va dans le dossier de
  // la console ; depuis un autre site, dans le dossier des téléchargements.
  function onDownload(_event: unknown, item: unknown, wc: unknown) {
    const downloads = deps.downloads();
    if (!downloads) return;
    downloads.handleWebDownload(item, downloadContextOf(viewOfContents(wc)?.entry));
  }

  function createView(entry: WebEntry): View {
    const win = deps.window();
    if (!win) throw new Error('Fenêtre principale absente.');
    const view = deps.createView(WEB_PREFERENCES);
    view.setBackgroundColor('#000000');
    view.setVisible(false);
    const wc = view.webContents;
    const w: View = { view, entry };

    wc.setWindowOpenHandler(({ url }) => {
      if (takeMagnet(url, wc)) return { action: 'deny' };
      const action = windowOpenAction(url, w.entry, wc.getURL());
      if (action === 'download') wc.downloadURL(url);
      else if (action === 'load') wc.loadURL(url);
      return { action: 'deny' };
    });
    const push = () => pushState(entry.id);
    for (const ev of ['page-title-updated', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) wc.on(ev, push);
    wc.on('did-navigate', () => {
      deps.extensions()?.resetPage(wc.id);
      push();
    });
    // « Clic sur la vidéo → page de pub » : la navigation vers une régie publicitaire est annulée.
    const guard = (event: { url?: string; isMainFrame?: boolean; preventDefault(): void }, legacyUrl?: string) => {
      const url = event.url || legacyUrl || '';
      if (/^magnet:\?/i.test(url)) {
        event.preventDefault();
        takeMagnet(url, wc);
        return;
      }
      if (event.isMainFrame === false) return;
      if (deps.extensions()?.guardNavigation(url, wc.getURL())) {
        event.preventDefault();
        toUi('web-adblocked', { id: entry.id, host: hostOf(url) });
      }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-fail-load', (_e: unknown, code: number, desc: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && code !== -3) {
        toUi('web-error', { id: entry.id, message: t('web.errors.notResponding', { site: String(entry.name), reason: desc }) });
      }
    });
    wc.on('render-process-gone', () => toUi('web-error', { id: entry.id, message: t('web.errors.crashed', { site: String(entry.name) }) }));
    wc.on('focus', () => toUi('web-focus', true));
    wc.on('blur', () => toUi('web-focus', false));
    wc.on('enter-html-full-screen', () => setHtmlFullScreen(entry.id, true));
    wc.on('leave-html-full-screen', () => setHtmlFullScreen(entry.id, false));
    wc.on('before-input-event', (event: { preventDefault(): void }, input: KeyInput) => {
      if (input.type === 'keyDown' && handleShortcut(entry.id, input)) event.preventDefault();
    });

    win.contentView.addChildView(view);
    views.set(entry.id, w);
    return w;
  }

  async function open(id: string, url?: string | null, opts: { site?: number } = {}) {
    const site = opts.site != null ? opts.site : views.get(id)?.entry.romSite || 0;
    const { entry, error } = entries.resolve(id, deps.config.get(), { romSites: sitesOf, site });
    if (!entry) return { ok: false as const, error };
    const target = typeof url === 'string' && isHttpUrl(url) ? url : entry.url;
    if (entry.mode === 'browser') {
      const r = await deps.openInBrowser(target);
      return { ...r, integrated: false };
    }
    await deps.whenReady();
    let w = views.get(id);
    if (!w) {
      w = createView(entry);
      w.view.webContents.loadURL(target);
    } else {
      w.entry = entry;
      if (url || opts.site != null) w.view.webContents.loadURL(target);
    }
    toUi('web-sessions', sessions());
    return { ok: true as const, integrated: true, state: stateOf(id) };
  }

  function show(id: string, bounds?: Partial<Rect> | null, focus = true) {
    const w = views.get(id);
    if (!w) return { ok: false as const };
    if (state.activeId && state.activeId !== id) pauseVideos(views.get(state.activeId));
    state.activeId = id;
    state.visible = true;
    if (bounds) state.bounds = roundRect(bounds);
    apply();
    if (focus) w.view.webContents.focus();
    return { ok: true as const, state: stateOf(id) };
  }

  function hide() {
    if (state.visible && state.activeId) pauseVideos(views.get(state.activeId));
    state.visible = false;
    if (state.immersive) setImmersive(false);
    apply();
    liveWindow()?.webContents.focus();
    return true;
  }

  function setBounds(bounds: Partial<Rect>) {
    state.bounds = roundRect(bounds);
    apply();
    return true;
  }

  function nav(action: string) {
    const w = active();
    if (!w) return false;
    const wc = w.view.webContents;
    if (action === 'back') goBack(wc);
    else if (action === 'forward') goForward(wc);
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
    else if (action === 'home') wc.loadURL(w.entry.url);
    else if (action === 'immersive') setImmersive(!state.immersive);
    else if (action === 'mire') focusMire();
    else if (action === 'browser') deps.openInBrowser(wc.getURL());
    return true;
  }

  function close(id?: string | null) {
    const w = views.get(id || state.activeId || '');
    if (!w) return false;
    const closedId = w.entry.id;
    try {
      deps.window()?.contentView.removeChildView(w.view);
    } catch {
      /* déjà retirée */
    }
    try {
      w.view.webContents.close();
    } catch {
      /* déjà fermée */
    }
    views.delete(closedId);
    if (state.activeId === closedId) {
      state.activeId = null;
      state.visible = false;
      if (state.immersive) setImmersive(false);
      liveWindow()?.webContents.focus();
    }
    toUi('web-sessions', sessions());
    toUi('web-closed', { id: closedId });
    return true;
  }

  function focus() {
    const w = active();
    if (w && state.visible) w.view.webContents.focus();
    return true;
  }

  function key(name: string) {
    const w = active();
    if (!w || !state.visible) return false;
    const wc = w.view.webContents;
    if (name === 'Back') {
      goBack(wc);
      return true;
    }
    for (const ev of padInputEvents(name)) wc.sendInputEvent(ev);
    return true;
  }

  function learnSearch(id?: string | null) {
    const w = views.get(id || state.activeId || '');
    if (!w) return { ok: false as const, error: t('web.errors.noSiteOpen') };
    const r = searchTemplate(w.view.webContents.getURL());
    if (!r.ok) return r;
    const { entry } = w;
    const sites = entry.romConsole != null ? sitesOf(entry.romConsole) : [];
    const config = deps.config.update((c) => withSearchTemplate(c, entry, r.template, sites));
    if (entry.romConsole != null) w.entry = romEntryFor(config, entry.romConsole, entry.romSite, siteDefaults) || entry;
    else w.entry = config.web.find((e) => e.id === entry.id) || entry;
    pushState(w.entry.id);
    return { ok: true as const, template: r.template, config };
  }

  // Compteur des éléments bloqués par les extensions : regroupé (un message par quart de seconde et par page).
  const countTimers = new Map<number, ReturnType<typeof setTimeout>>();
  function onBlockedCount(wcId: number) {
    if (countTimers.has(wcId)) return;
    countTimers.set(
      wcId,
      setTimeout(() => {
        countTimers.delete(wcId);
        const ext = deps.extensions();
        for (const w of views.values()) {
          const wc = w.view.webContents;
          if (!wc.isDestroyed() && wc.id === wcId) toUi('web-blocked', { id: w.entry.id, count: ext ? ext.blockedCount(wcId) : 0 });
        }
      }, 250),
    );
  }

  return {
    open,
    show,
    hide,
    setBounds,
    nav,
    close,
    focus,
    key,
    learnSearch,
    sessions,
    stateOf,
    consoleSites: sitesOf,
    entries,
    onDownload,
    takeMagnet,
    onBlockedCount,
    /** Page de la vue affichée (bloqueur : « autoriser ce site »). */
    activeContents: () => active()?.view.webContents || null,
    /** Recharge toutes les vues (bloqueur activé ou désactivé). */
    reloadAll() {
      for (const w of views.values()) w.view.webContents.reload();
    },
    /** Configuration enregistrée : les sites enregistrés ouverts reprennent leur entrée à jour. */
    refreshEntries(config: { web: WebEntry[] }) {
      for (const w of views.values()) w.entry = config.web.find((e) => e.id === w.entry.id) || w.entry;
    },
    // Événements de la fenêtre principale.
    onWindowResize() {
      if (state.immersive || state.html) apply();
    },
    /** Boutons « précédent » et « suivant » de la souris (Windows) dans un site. */
    onAppCommand(cmd: string) {
      if (!state.visible) return;
      if (cmd === 'browser-backward') nav('back');
      if (cmd === 'browser-forward') nav('forward');
    },
    onWindowClosed() {
      views.clear();
    },
  };
}

export type WebManager = ReturnType<typeof createWebManager>;
