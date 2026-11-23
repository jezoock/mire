/**
 * Fenêtre principale : création (réglages de sécurité de la page de l'interface), raccourcis F11 et F12, liens
 * externes, messages vers l'interface, réduction pendant un jeu. Les réglages `webPreferences` (isolation du
 * contexte, bac à sable, pas d'accès à Node) ne doivent jamais être affaiblis.
 */
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PALETTE, parsePaletteMeta, resolvePalette } from '@mire/shared';
import type { Config, PaletteMeta, Theme } from '@mire/shared';
import type { WebManager } from '../web/index.ts';
import type { Rescue } from '../app/rescue.ts';

/** Canal du message qui demande à l'interface d'ouvrir l'explorateur en mode secours (P4-10). */
export const RESCUE_CHANNEL = 'rescue:open';

// Fond de repli si aucune palette n'est lisible (installation abîmée) : noir, plutôt que le blanc d'Electron.
const FALLBACK_BACKGROUND = '#000000';

/** Métadonnées d'une palette (`<dossier des palettes>/<id>/palette.json`), ou `null` si elles sont illisibles. */
export function readPaletteMeta(dir: string, id: string): PaletteMeta | null {
  try {
    return parsePaletteMeta(JSON.parse(fs.readFileSync(path.join(dir, id, 'palette.json'), 'utf8')));
  } catch {
    return null;
  }
}

/** Palette d'un plugin actif (P5-02), par identifiant : sa couleur de fond, vérifiée. */
export type PaletteLookup = (id: string) => { background: string } | null;

/**
 * Couleur de fond de la fenêtre (avant l'affichage de l'interface) : celle de la palette du réglage, lue dans ses
 * métadonnées, ou celle d'une palette de plugin ; « auto » suit le système ; palette inconnue : celle par défaut.
 */
export function themeBackground(dir: string, theme: Theme | string, dark: boolean, plugins: PaletteLookup = () => null): string {
  const id = resolvePalette(theme, dark);
  const meta = readPaletteMeta(dir, id) || plugins(id) || readPaletteMeta(dir, DEFAULT_PALETTE);
  return meta?.background || FALLBACK_BACKGROUND;
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
  /** Mode secours (P4-10) : raccourci et touche maintenue lus avant la page, plantages de l'interface. */
  rescue?: Pick<Rescue, 'windowOpened' | 'onInput' | 'onCrash'>;
}

export function createMainWindow(deps: MainWindowDeps) {
  let win: ElectronBrowserWindow | null = null;
  const alive = () => (win && !win.isDestroyed() ? win : null);
  // Les palettes sont à côté de la page de l'interface (dist/renderer/palettes/).
  const palettes = path.join(path.dirname(deps.files.html), 'palettes');
  // Palettes des plugins (P5-02) : connues après le démarrage des plugins, donc après l'ouverture de la fenêtre.
  let plugins: PaletteLookup = () => null;
  const background = () => themeBackground(palettes, deps.config.get().ui.theme, deps.nativeTheme.shouldUseDarkColors, plugins);

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
    deps.rescue?.windowOpened();
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      // Mode secours : lu ici, avant la page, pour qu'un thème ne puisse pas le bloquer.
      const reason = deps.rescue?.onInput(input);
      if (reason) {
        w.webContents.send(RESCUE_CHANNEL, { reason });
        if (reason === 'shortcut') {
          e.preventDefault();
          return;
        }
      }
      if (input.key === 'F11') {
        w.setFullScreen(!w.isFullScreen());
        e.preventDefault();
      }
      if (input.key === 'F12') {
        w.webContents.toggleDevTools();
        e.preventDefault();
      }
    });
    // Interface plantée : rechargée ; deux fois de suite, elle repart sur l'explorateur (mode secours).
    w.webContents.on('render-process-gone', (_e, details) => {
      if (!deps.rescue || details?.reason === 'clean-exit') return;
      if (deps.rescue.onCrash() !== 'give-up' && !w.isDestroyed()) w.webContents.reload();
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
    /** Palettes des plugins (P5-02) : la couleur de fond suit celle de la palette choisie, une fois les plugins démarrés. */
    setPalettes(lookup: PaletteLookup) {
      plugins = lookup;
      alive()?.setBackgroundColor(background());
    },
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
