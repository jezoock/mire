/**
 * Consoles créées par la boutique : une par système, rangée dans ROMs/<Système>. Une console installée par la
 * boutique porte `store` = `<émulateur>:<système>` ; une console existante avec le même `store` est mise à jour
 * et garde son dossier de jeux.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { StoreEmulator, StoreSystem } from './catalog/index.ts';

export type ConsoleEntry = Record<string, any>;

/** Fiche d'une console de la boutique. */
export function consoleEntry(emu: StoreEmulator, sys: StoreSystem, exePath: string, args: string[], romsRoot: string): ConsoleEntry {
  const romsDir = path.join(romsRoot, sys.folder);
  return { name: sys.name, path: exePath, args, romsDir, extensions: sys.ext, system: sys.libretro, store: `${emu.id}:${sys.id}` };
}

/** Liste des consoles après ajout ou mise à jour des fiches (même `store`). */
export function mergeConsoles(emulators: readonly ConsoleEntry[], entries: readonly ConsoleEntry[]): ConsoleEntry[] {
  const out = [...emulators];
  for (const entry of entries) {
    const i = out.findIndex((e) => e.store === entry.store);
    if (i >= 0) out[i] = { ...out[i], ...entry, romsDir: out[i].romsDir || entry.romsDir };
    else out.push(entry);
  }
  return out;
}

export interface ConsolesOptions {
  getConfig: () => any;
  saveConfig: (cfg: any) => unknown;
  romsRoot: () => string;
}

/** Crée ou met à jour les consoles d'un émulateur ; le dossier des jeux de chaque système est créé. */
export function registerConsoles(
  { getConfig, saveConfig, romsRoot }: ConsolesOptions,
  emu: StoreEmulator,
  systems: readonly StoreSystem[],
  exePath: string,
  argsFor: (sys: StoreSystem) => string[],
): void {
  const cfg = getConfig();
  const entries = systems.map((sys) => consoleEntry(emu, sys, exePath, argsFor(sys), romsRoot()));
  for (const e of entries) fs.mkdirSync(e.romsDir, { recursive: true });
  saveConfig({ ...cfg, emulators: mergeConsoles(cfg.emulators, entries) });
}

/** Retire les consoles installées par la boutique pour un émulateur. */
export function removeConsoles(emulators: readonly ConsoleEntry[], emuId: string): ConsoleEntry[] {
  return emulators.filter((e) => !String(e.store || '').startsWith(`${emuId}:`));
}
