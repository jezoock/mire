/** Lancement de programmes (jeux, émulateurs, lecteur externe) et ouverture de raccourcis ou d'adresses. */
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isUrlTarget } from '@mire/shared';
import type { LaunchOptions, LaunchResult } from './types.ts';

/** Ce que le lanceur demande à l'interface système d'Electron (`shell`). */
export interface ShellLike {
  openExternal(url: string): Promise<void>;
  openPath(file: string): Promise<string>;
}

export interface LauncherDeps {
  shell: ShellLike;
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  exists?: (dir: string) => boolean;
  /**
   * « Réduire pendant le jeu » : appelé quand le programme a démarré. Rend la fonction à appeler à sa fermeture
   * (rétablir la fenêtre), ou rien si la fenêtre n'a pas été réduite.
   */
  minimizeWhileRunning?: () => (() => void) | void;
}

export interface Launcher {
  launchProcess(cmd: string, args?: string[], opts?: LaunchOptions): Promise<LaunchResult>;
  openTarget(target: string, args?: string[], opts?: LaunchOptions): Promise<LaunchResult>;
}

// Raccourcis et scripts Windows : confiés au système plutôt que lancés directement.
const SHELL_TARGETS = ['.lnk', '.url', '.bat', '.cmd'];

export function createLauncher(deps: LauncherDeps): Launcher {
  const { shell, platform = process.platform, spawn = nodeSpawn, exists = fs.existsSync, minimizeWhileRunning } = deps;

  function launchProcess(cmd: string, args: string[] = [], { cwd, hideWhileRunning = false }: LaunchOptions = {}): Promise<LaunchResult> {
    return new Promise((resolve) => {
      let command = cmd;
      let argv = args;
      // Application macOS : lancée par `open`, qui attend sa fermeture (-W) pour qu'on sache quand rétablir Mire.
      if (platform === 'darwin' && /\.app\/?$/i.test(command)) {
        argv = ['-W', '-a', command, '--args', ...args];
        command = 'open';
      }
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawn(command, argv, { cwd: cwd && exists(cwd) ? cwd : undefined, detached: true, stdio: 'ignore' });
      } catch (err) {
        resolve({ ok: false, error: (err as Error).message });
        return;
      }
      child.once('error', (err: NodeJS.ErrnoException) => {
        resolve({ ok: false, error: err.code === 'ENOENT' ? `Programme introuvable : ${cmd}` : err.message });
      });
      child.once('spawn', () => {
        const restore = hideWhileRunning && minimizeWhileRunning ? minimizeWhileRunning() : undefined;
        if (restore) child.once('exit', restore);
        child.unref();
        resolve({ ok: true });
      });
    });
  }

  async function openTarget(target: string, args: string[] = [], opts?: LaunchOptions): Promise<LaunchResult> {
    if (isUrlTarget(target)) {
      await shell.openExternal(target);
      return { ok: true };
    }
    const ext = path.extname(target).toLowerCase();
    if (SHELL_TARGETS.includes(ext)) {
      const err = await shell.openPath(target);
      return err ? { ok: false, error: err } : { ok: true };
    }
    return launchProcess(target, args, opts);
  }

  return { launchProcess, openTarget };
}
