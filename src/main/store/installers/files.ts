/** Outils communs aux installateurs : téléchargement, recherche du programme, contexte d'installation. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as http from '../../net/http.ts';
import type { InstallPlatform, StoreEmulator, StoreSystem } from '../catalog/index.ts';

/** Fichier à télécharger pour installer un émulateur. */
export interface ResolvedSource {
  url: string;
  name: string;
  version: string;
}

/** Ce que la boutique fournit à un installateur. */
export interface InstallContext {
  platform: InstallPlatform;
  /** Dossier des émulateurs installés par la boutique. */
  emuRoot: string;
  /** Dossier des fichiers téléchargés avant extraction. */
  tmpRoot: string;
  /** Émulateurs installés (version, programme), enregistrés par la boutique après l'installation. */
  meta: Record<string, any>;
  extract(archive: string, dest: string): Promise<void>;
  progress(id: string, phase: string, extra?: Record<string, unknown>): void;
  registerConsoles(emu: StoreEmulator, systems: readonly StoreSystem[], exePath: string, argsFor: (sys: StoreSystem) => string[]): void;
}

// Gros fichier (émulateur, cœur, jeu) : jusqu'à 30 minutes.
export function download(url: string, dest: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  return http.downloadToFile(url, dest, { onProgress, timeout: 30 * 60 * 1000 });
}

/** Fichier dont le nom correspond, jusqu'à 5 niveaux de dossiers, sans entrer dans les dossiers `.home` et `.config`. */
export async function findFile(dir: string, pattern: RegExp, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && pattern.test(e.name)) return path.join(dir, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.endsWith('.home') || e.name.endsWith('.config')) continue;
    const r = await findFile(path.join(dir, e.name), pattern, depth + 1);
    if (r) return r;
  }
  return null;
}
