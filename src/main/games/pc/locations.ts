/**
 * Dossiers de jeux PC tels que les sources des plugins les reçoivent (P5-13, extension du socle de P5-11a) : un par
 * dossier ou partage de `config.gameSources`, avec le type `game`. Mêmes règles que les emplacements de la
 * bibliothèque (plugins inclus ou officiels, permission `folders`, dossier accordé tant qu'il reste configuré). La
 * clé est préfixée par `game:` : un dossier qui est aussi dans la bibliothèque reste un emplacement distinct.
 */
import path from 'node:path';
import type { GameSource } from '@mire/shared';
import { normalizePath } from '../../catalog/keys.ts';
import { resolveLocation } from '../../library/location.ts';
import type { KeyedLocation } from '../../library/locations.ts';

/** Clé d'un dossier de jeux PC (instance de la source qui le lit). */
export const gameLocationKey = (dir: string, platform: NodeJS.Platform = process.platform): string => `game:${normalizePath(dir, platform)}`;

export function gameLocations(sources: readonly GameSource[], platform: NodeJS.Platform = process.platform): KeyedLocation[] {
  const out = new Map<string, KeyedLocation>();
  for (const src of sources) {
    const resolved = resolveLocation(src?.location, { platform });
    // Un dossier n'est accordé que par son chemin absolu ; une adresse n'est pas un dossier de jeux.
    if (resolved.type !== 'path' || !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(resolved.path)) continue;
    const key = gameLocationKey(resolved.path, platform);
    if (!out.has(key)) out.set(key, { key, location: { location: String(src.location), path: resolved.path, network: resolved.network, kinds: ['game'] } });
  }
  return [...out.values()];
}
