/** Détection des lecteurs (mpv, VLC) et navigateurs installés, selon le système. */
import fs from 'node:fs';
import path from 'node:path';
import type { DetectEnv } from './types.ts';

export function systemDetectEnv(): DetectEnv {
  return { platform: process.platform, env: process.env, fs };
}

// Chemins du système simulé : on teste Windows depuis Linux avec des chemins Windows.
const pathFor = (denv: DetectEnv) => (denv.platform === 'win32' ? path.win32 : path.posix);

function isFile(denv: DetectEnv, file: string): boolean {
  try {
    return denv.fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Premier chemin de la liste qui est un fichier existant. */
export function firstExisting(denv: DetectEnv, list: (string | null)[]): string | null {
  return list.filter((p): p is string => !!p).find((p) => isFile(denv, p)) || null;
}

// Dossiers d'installation de Windows (Program Files, LOCALAPPDATA) : null si la variable manque.
function winDirs(denv: DetectEnv) {
  const { env } = denv;
  const under = (base: string | undefined, ...rest: string[]) => (base ? pathFor(denv).join(base, ...rest) : null);
  return {
    pf: (...rest: string[]) => under(env.ProgramFiles, ...rest),
    pf86: (...rest: string[]) => under(env['ProgramFiles(x86)'], ...rest),
    local: (...rest: string[]) => under(env.LOCALAPPDATA, ...rest),
  };
}

/** Emplacements possibles d'un lecteur, dans l'ordre de préférence. */
export function playerCandidates(id: string, denv: DetectEnv): (string | null)[] {
  const { pf, pf86, local } = winDirs(denv);
  const win = denv.platform === 'win32';
  const mac = denv.platform === 'darwin';
  if (id === 'mpv') {
    if (win) return [pf('mpv', 'mpv.exe'), local('Programs', 'mpv', 'mpv.exe'), 'C:\\mpv\\mpv.exe'];
    if (mac) return ['/Applications/mpv.app/Contents/MacOS/mpv', '/opt/homebrew/bin/mpv', '/usr/local/bin/mpv'];
    return ['/usr/bin/mpv', '/usr/local/bin/mpv'];
  }
  if (id === 'vlc') {
    if (win) return [pf('VideoLAN', 'VLC', 'vlc.exe'), pf86('VideoLAN', 'VLC', 'vlc.exe')];
    if (mac) return ['/Applications/VLC.app/Contents/MacOS/VLC'];
    return ['/usr/bin/vlc', '/snap/bin/vlc'];
  }
  return [];
}

/** Navigateur installé (Edge, Chrome, Brave, Chromium), ou null. */
export function detectBrowser(denv: DetectEnv = systemDetectEnv()): string | null {
  const { pf, pf86, local } = winDirs(denv);
  if (denv.platform === 'win32') {
    // Edge en premier : c'est lui qui obtient la meilleure qualité sur Netflix sous Windows.
    return firstExisting(denv, [
      pf86('Microsoft', 'Edge', 'Application', 'msedge.exe'),
      pf('Microsoft', 'Edge', 'Application', 'msedge.exe'),
      pf('Google', 'Chrome', 'Application', 'chrome.exe'),
      pf86('Google', 'Chrome', 'Application', 'chrome.exe'),
      local('Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }
  if (denv.platform === 'darwin') {
    return firstExisting(denv, [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]);
  }
  return firstExisting(denv, [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]);
}

/** Nom du fichier d'un programme, selon les chemins du système. */
export function programName(command: string, denv: DetectEnv = systemDetectEnv()): string {
  return pathFor(denv).basename(command);
}

/** Lecteur installé : mpv en premier, puis VLC ; null si aucun. */
export function detectPlayer(denv: DetectEnv = systemDetectEnv()): string | null {
  return firstExisting(denv, [...playerCandidates('mpv', denv), ...playerCandidates('vlc', denv)]);
}
