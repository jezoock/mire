/**
 * Dossier où chaque émulateur cherche ses BIOS, décrit par des données :
 * - en mode portable (un marqueur présent à côté du programme), un sous-dossier du dossier du programme ;
 * - sinon, un chemin propre à Windows ou à Linux (les autres systèmes suivent Linux).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StorePlatform } from './catalog/index.ts';

/** Point de départ d'un chemin. */
type Base = 'emulators' | 'install' | 'documents' | 'appData' | 'xdgConfig' | 'xdgData';
type Location = readonly [Base, ...string[]];

interface BiosLocation {
  /** Mode portable : un de ces fichiers ou dossiers dans le dossier du programme. */
  portable?: { markers: readonly string[]; dir: readonly string[] };
  win32: Location;
  linux: Location;
}

export const BIOS_LOCATIONS: Readonly<Record<string, BiosLocation>> = {
  retroarch: { win32: ['emulators', 'retroarch', 'system'], linux: ['xdgConfig', 'retroarch', 'system'] },
  duckstation: {
    portable: { markers: ['portable.txt'], dir: ['bios'] },
    win32: ['documents', 'DuckStation', 'bios'],
    linux: ['xdgData', 'duckstation', 'bios'],
  },
  pcsx2: {
    portable: { markers: ['portable.ini', 'portable.txt'], dir: ['bios'] },
    win32: ['documents', 'PCSX2', 'bios'],
    linux: ['xdgConfig', 'PCSX2', 'bios'],
  },
  melonds: { win32: ['install', 'bios'], linux: ['xdgConfig', 'melonDS', 'bios'] },
  dolphin: {
    portable: { markers: ['portable.txt'], dir: ['User', 'GC'] },
    win32: ['documents', 'Dolphin Emulator', 'GC'],
    linux: ['xdgData', 'dolphin-emu', 'GC'],
  },
  azahar: {
    portable: { markers: ['user'], dir: ['user', 'sysdata'] },
    win32: ['appData', 'Azahar', 'sysdata'],
    linux: ['xdgData', 'azahar-emu', 'sysdata'],
  },
  cemu: { portable: { markers: ['portable'], dir: ['portable'] }, win32: ['appData', 'Cemu'], linux: ['xdgData', 'Cemu'] },
};

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

/** Dossier des BIOS de l'émulateur `id` ; null s'il n'en utilise pas. */
export function biosDir(id: string, opts: BiosDirOptions): string | null {
  const loc = BIOS_LOCATIONS[id];
  if (!loc) return null;
  const { platform, emuRoot, exe, paths = {}, env = process.env, exists = fs.existsSync } = opts;
  const home = paths.home || os.homedir();
  const install = exe ? path.dirname(exe) : path.join(emuRoot, id);
  const bases: Record<Base, () => string> = {
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
