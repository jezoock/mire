/**
 * Détection des programmes installés, selon le système : les lecteurs externes décrits par les plugins (P5-20) et le
 * navigateur.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DetectEnv, PlayerLocations } from './types.ts';

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

/**
 * Emplacements d'un lecteur sur ce système, dans l'ordre de préférence ; les dossiers d'installation de Windows
 * (`{programFiles}`, `{programFilesX86}`, `{localAppData}`) sont remplacés ici ; null si la variable manque.
 */
export function playerCandidates(locations: PlayerLocations, denv: DetectEnv): (string | null)[] {
  // Les autres systèmes de type Unix prennent les emplacements de Linux, comme avant les plugins.
  const system = denv.platform === 'win32' || denv.platform === 'darwin' ? denv.platform : 'linux';
  const list = locations[system] ?? [];
  if (denv.platform !== 'win32') return [...list];
  const { pf, pf86, local } = winDirs(denv);
  const dirs: [string, (...rest: string[]) => string | null][] = [
    ['{programFiles}', pf],
    ['{programFilesX86}', pf86],
    ['{localAppData}', local],
  ];
  return list.map((l) => {
    const d = dirs.find(([name]) => l.startsWith(name));
    return d ? d[1](...l.slice(d[0].length).split(/[\\/]/).filter(Boolean)) : l;
  });
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
