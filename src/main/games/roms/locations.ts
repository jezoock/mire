/**
 * Dossiers de jeux d'une console tels que les sources des plugins les reçoivent (P5-14a, extension du socle de P5-11a
 * et P5-13a) : un par dossier local ou partage réseau de chaque console (dossier principal et dossiers ajoutés), avec
 * le type `rom` et la console (identifiant, système, extensions, dossier des jaquettes). Mêmes règles que les
 * emplacements de la bibliothèque : plugins inclus ou officiels, permission `folders`, dossier (et dossier des
 * jaquettes) accordé tant qu'il reste configuré. Les sources en ligne d'une console restent lues par le cœur (P5-14b).
 */
import path from 'node:path';
import type { SourceConsole } from '@mire/plugin-sdk';
import { guessSystem, isHttpUrl } from '@mire/shared';
import type { Emulator } from '@mire/shared';
import { romKey } from '../../catalog/keys.ts';
import { resolveLocation } from '../../library/location.ts';
import type { KeyedLocation } from '../../library/locations.ts';
import type { ConsoleLocation } from '../types.ts';

/** Les emplacements d'une console : local (dossier principal) et distants (sources web ou réseau). */
export function consoleLocations(emu: Emulator): ConsoleLocation[] {
  const main = emu.romsDir ? [{ location: emu.romsDir, remote: false }] : [];
  const extra = (emu.sources || []).map((loc) => ({ location: loc, remote: isHttpUrl(loc) }));
  return [...main, ...extra];
}

/** Instance d'un dossier d'une console : `rom:<console>|<chemin normalisé>`. */
export const romLocationKey = (consoleId: string, dir: string, platform: NodeJS.Platform = process.platform): string => romKey(consoleId, dir, platform);

const isAbsolute = (p: string, platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix).isAbsolute(p);

/** Dossier local (ou partage) d'un emplacement d'une console, s'il en est un : chemin absolu et partage réseau. */
export function romFolder(location: unknown, platform: NodeJS.Platform = process.platform): { path: string; network: boolean } | null {
  const resolved = resolveLocation(location, { platform });
  if (resolved.type !== 'path' || !isAbsolute(resolved.path, platform)) return null;
  return { path: resolved.path, network: resolved.network };
}

/** Console telle qu'une source de plugin la reçoit. */
export function sourceConsole(emu: Emulator, platform: NodeJS.Platform = process.platform): SourceConsole {
  const extensions = [...new Set((emu.extensions || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))].map((e) =>
    e.startsWith('.') ? e : `.${e}`,
  );
  const system = guessSystem(emu);
  const images = typeof emu.imagesDir === 'string' && emu.imagesDir ? romFolder(emu.imagesDir, platform) : null;
  return { id: emu.id, ...(system ? { system } : {}), extensions, ...(images ? { images: images.path } : {}) };
}

export function romLocations(emulators: readonly Emulator[], platform: NodeJS.Platform = process.platform): KeyedLocation[] {
  const out = new Map<string, KeyedLocation>();
  for (const emu of emulators) {
    if (!emu?.id) continue;
    const console = sourceConsole(emu, platform);
    for (const { location, remote } of consoleLocations(emu)) {
      const folder = remote ? null : romFolder(location, platform);
      if (!folder) continue;
      const key = romLocationKey(emu.id, folder.path, platform);
      if (!out.has(key))
        out.set(key, {
          key,
          location: { location: String(location), path: folder.path, network: folder.network, kinds: ['rom'], console: structuredClone(console) },
        });
    }
  }
  return [...out.values()];
}
