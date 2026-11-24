/**
 * Emplacements de la bibliothèque tels que les sources des plugins les reçoivent (P5-11a) : un par dossier, partage
 * ou adresse de la configuration, avec tous les types demandés à cet endroit. La clé est l'instance que la
 * bibliothèque du cœur donne au même emplacement (`element-sources.ts`) : un emplacement pris par un plugin se
 * reconnaît des deux côtés.
 */
import path from 'node:path';
import type { LibrarySource } from '@mire/shared';
import type { SourceLocation, SourceMediaKind } from '@mire/plugin-sdk';
import { normalizePath, normalizeUrl } from '../catalog/keys.ts';
import { pathKey } from '../fs/walk.ts';
import { resolveLocation } from './location.ts';

export interface KeyedLocation {
  key: string;
  location: SourceLocation;
}

const KINDS: readonly SourceMediaKind[] = ['video', 'audio', 'image'];

export function libraryLocations(sources: readonly LibrarySource[], platform: NodeJS.Platform = process.platform): KeyedLocation[] {
  const groups = new Map<string, KeyedLocation>();
  for (const src of sources) {
    if (!KINDS.includes(src.kind as SourceMediaKind)) continue;
    const resolved = resolveLocation(src.location, { platform });
    // Un dossier n'est accordé que par son chemin absolu.
    if (resolved.type === 'path' && !(platform === 'win32' ? path.win32 : path.posix).isAbsolute(resolved.path)) continue;
    // Même regroupement que l'analyse du cœur (`scan.ts`).
    const group = resolved.type === 'url' ? resolved.url : pathKey(resolved.path, platform);
    let g = groups.get(group);
    if (!g) {
      const key = resolved.type === 'url' ? normalizeUrl(resolved.url) : normalizePath(resolved.path, platform);
      const location: SourceLocation =
        resolved.type === 'url'
          ? { location: String(src.location), url: resolved.url, network: false, kinds: [] }
          : { location: String(src.location), path: resolved.path, network: resolved.network, kinds: [] };
      g = { key, location };
      groups.set(group, g);
    }
    if (!g.location.kinds.includes(src.kind as SourceMediaKind)) g.location.kinds.push(src.kind as SourceMediaKind);
  }
  return [...groups.values()];
}
