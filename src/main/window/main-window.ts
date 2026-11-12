/**
 * Fenêtre principale : création (réglages de sécurité de la page de l'interface), raccourcis F11 et F12, liens
 * externes, messages vers l'interface, réduction pendant un jeu. Les réglages `webPreferences` (isolation du
 * contexte, bac à sable, pas d'accès à Node) ne doivent jamais être affaiblis.
 */
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { THEME_BG } from '../config/index.ts';
import type { Config, Theme } from '@mire/shared';
import type { WebManager } from '../web/index.ts';

/** Couleur de fond de la fenêtre (avant l'affichage de l'interface) : celle du thème, « auto » suivant le système. */
export function themeBackground(theme: Theme | string, dark: boolean): string {
  const t = theme === 'auto' ? (dark ? 'ecran' : 'jour') : theme;
  return THEME_BG[t as keyof typeof THEME_BG] || THEME_BG.ecran;
}

export interface MainWindowDeps {
  BrowserWindow: typeof ElectronBrowserWindow;
  shell: { openExternal(url: string): Promise<void> };
  nativeTheme: { readonly shouldUseDarkColors: boolean };
  config: { get(): Config };
  /** Preload de l'interface et page à charger. */
  files: { preload: string; html: string };
  /** Vues web (créées après la fenêtre, d'où l'accesseur) : elles suivent la taille et la fermeture de la fenêtre. */
  web: () => Pick<WebManager, 'onWindowResize' | 'onAppCommand' | 'onWindowClosed'>;
  /** Fenêtre fermée (l'application se ferme, sauf sous macOS). */
  onClosed: () => void;
}

export function createMainWindow(deps: MainWindowDeps) {
  let win: ElectronBrowserWindow | null = null;
  const alive = () => (win && !win.isDestroyed() ? win : null);
  const background = () => themeBackground(deps.config.get().ui.theme, deps.nativeTheme.shouldUseDarkColors);

  function open() {
    const w = new deps.BrowserWindow({
      width: 1600,
      height: 960,
      minWidth: 960,
      minHeight: 620,
      title: 'Mire',
      backgroundColor: background(),
      autoHideMenuBar: true,
      fullscreen: !!deps.config.get().ui.fullscreen,
      show: false,
      webPreferences: { preload: deps.files.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win = w;
    w.once('ready-to-show', () => w.show());
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) deps.shell.openExternal(url);
      return { action: 'deny' };
    });
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') {
        w.setFullScreen(!w.isFullScreen());
        e.preventDefault();
      }
      if (input.key === 'F12') {
        w.webContents.toggleDevTools();
        e.preventDefault();
      }
    });
    w.on('resize', () => deps.web().onWindowResize());
    // Bouton « précédent » de la souris (Windows) dans un site.
    w.on('app-command', (_e, cmd) => deps.web().onAppCommand(cmd));
    w.on('closed', () => {
      win = null;
      deps.web().onWindowClosed();
      deps.onClosed();
    });
    w.loadFile(deps.files.html);
  }

  return {
    /** La fenêtre, ou `null` avant sa création et après sa fermeture. */
    get: () => win,
    open,
    themeBackground: background,
    /** Message vers l'interface (ignoré sans fenêtre). */
    toUi(channel: string, payload?: unknown) {
      alive()?.webContents.send(channel, payload);
    },
    /** « Réduire pendant le jeu » : la fenêtre est réduite au lancement, rétablie à la fermeture du programme. */
    minimizeWhileRunning(): (() => void) | undefined {
      const w = alive();
      if (!w) return undefined;
      w.minimize();
      return () => {
        const back = alive();
        if (back) {
          back.restore();
          back.focus();
        }
      };
    },
    /** Deuxième lancement de Mire : la fenêtre revient au premier plan. Faux s'il n'y a pas de fenêtre. */
    bringToFront(): boolean {
      if (!win) return false;
      if (win.isMinimized()) win.restore();
      win.focus();
      return true;
    },
  };
}

export type MainWindow = ReturnType<typeof createMainWindow>;
