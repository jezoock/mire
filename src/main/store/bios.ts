/**
 * Dossier où chaque émulateur cherche ses BIOS, décrit par des données (celles de l'émulateur, `bios`) :
 * - en mode portable (un marqueur présent à côté du programme), un sous-dossier du dossier du programme ;
 * - sinon, un chemin propre à Windows ou à Linux (les autres systèmes suivent Linux).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BiosBase, BiosLocation, StorePlatform } from './catalog/index.ts';

export interface BiosDirOptions {
  platform: StorePlatform;
  /** Dossier des émulateurs installés par la boutique. */
  emuRoot: string;
  /** Programme installé, s'il est connu. */
  exe?: string;
  /** Dossiers de l'utilisateur (Electron) ; à défaut, déduits du dossier personnel. */
  paths?: { home?: string; documents?: string; appData?: string };
  env?: NodeJS.ProcessEnv;
  exists?: (file: string) => boolean;
}

/** Dossier des BIOS de l'émulateur `id`, d'après son emplacement `loc` ; null s'il n'en utilise pas. */
export function biosDir(id: string, loc: BiosLocation | undefined, opts: BiosDirOptions): string | null {
  if (!loc) return null;
  const { platform, emuRoot, exe, paths = {}, env = process.env, exists = fs.existsSync } = opts;
  const home = paths.home || os.homedir();
  const install = exe ? path.dirname(exe) : path.join(emuRoot, id);
  const bases: Record<BiosBase, () => string> = {
    emulators: () => emuRoot,
    install: () => install,
    documents: () => paths.documents || path.join(home, 'Documents'),
    appData: () => paths.appData || path.join(home, 'AppData', 'Roaming'),
    xdgConfig: () => env.XDG_CONFIG_HOME || path.join(home, '.config'),
    xdgData: () => env.XDG_DATA_HOME || path.join(home, '.local', 'share'),
  };
  if (loc.portable?.markers.some((m) => exists(path.join(install, m)))) return path.join(install, ...loc.portable.dir);
  const [base, ...rest] = platform === 'win32' ? loc.win32 : loc.linux;
  return path.join(bases[base](), ...rest);
}
