/**
 * Consoles de la boutique. Le nom (et le dossier des jeux) vient du référentiel des systèmes ; les extensions
 * enregistrées sur la console et le cœur RetroArch sont propres à la boutique.
 * Données : futur contenu d'un addon (phase 3).
 */
import { systemById } from '@mire/shared';
import type { StoreSystem } from './types.ts';

export function storeSystem(id: string, libretro: string, extra: { ext: string[]; core?: string }): StoreSystem {
  const sys = systemById(libretro);
  if (!sys) throw new Error(`Système inconnu : ${libretro}`);
  return { id, name: sys.name, folder: sys.name, libretro, ...extra };
}

// Systèmes de RetroArch : chaque système ajoute un « cœur » (module d'émulation) et une console dans Mire.
export const RETROARCH_SYSTEMS: readonly StoreSystem[] = [
  storeSystem('nes', 'Nintendo - Nintendo Entertainment System', { core: 'fceumm', ext: ['.nes', '.fds', '.unf', '.zip'] }),
  storeSystem('snes', 'Nintendo - Super Nintendo Entertainment System', { core: 'snes9x', ext: ['.sfc', '.smc', '.zip'] }),
  storeSystem('gb', 'Nintendo - Game Boy', { core: 'gambatte', ext: ['.gb', '.zip'] }),
  storeSystem('gbc', 'Nintendo - Game Boy Color', { core: 'gambatte', ext: ['.gbc', '.zip'] }),
  storeSystem('gba', 'Nintendo - Game Boy Advance', { core: 'mgba', ext: ['.gba', '.zip'] }),
  storeSystem('n64', 'Nintendo - Nintendo 64', { core: 'mupen64plus_next', ext: ['.n64', '.z64', '.v64', '.zip'] }),
  storeSystem('md', 'Sega - Mega Drive - Genesis', { core: 'genesis_plus_gx', ext: ['.md', '.gen', '.smd', '.bin', '.zip'] }),
  storeSystem('sms', 'Sega - Master System - Mark III', { core: 'genesis_plus_gx', ext: ['.sms', '.zip'] }),
  storeSystem('gg', 'Sega - Game Gear', { core: 'genesis_plus_gx', ext: ['.gg', '.zip'] }),
  storeSystem('pce', 'NEC - PC Engine - TurboGrafx 16', { core: 'mednafen_pce_fast', ext: ['.pce', '.zip'] }),
];
