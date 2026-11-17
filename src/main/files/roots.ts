/**
 * Dossiers où la gestion des fichiers (P2-10) peut agir : les dossiers locaux de la configuration (bibliothèque,
 * dossiers de jeux, dossiers des consoles). Pas les partages réseau ni les serveurs web, pas les dossiers de données
 * de Mire (images en cache), ni les fichiers autorisés un par un ou ouverts à part (glisser-déposer) : ceux-là, la
 * politique d'accès les laisse lire, pas modifier.
 */
import type { Config } from '@mire/shared';
import { resolveLocation } from '../library/location.ts';

type RootsConfig = Pick<Config, 'library' | 'gameSources' | 'emulators'>;

export function managedRoots(cfg: RootsConfig, platform: NodeJS.Platform = process.platform): string[] {
  const roots: string[] = [];
  const add = (loc: unknown) => {
    const r = resolveLocation(loc, { platform });
    if (r.type === 'path' && r.path && !r.network) roots.push(r.path);
  };
  for (const src of cfg.library.sources) add(src.location);
  for (const src of cfg.gameSources) add(src.location);
  for (const e of cfg.emulators) {
    add(e.romsDir);
    for (const x of e.sources || []) add(x);
  }
  return roots;
}
