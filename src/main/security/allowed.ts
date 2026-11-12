/**
 * Ce que la configuration autorise l'interface à lire : dossiers (bibliothèque, sources de jeux, dossiers des
 * consoles) et fichiers désignés un par un (image d'un jeu PC, bannière d'une console). La politique d'accès
 * (access-policy.ts) les recalcule après chaque changement de configuration.
 */
import type { Config } from '@mire/shared';
import { resolveLocation } from '../library/index.ts';

type AllowedConfig = Pick<Config, 'library' | 'gameSources' | 'emulators'>;

/** Dossiers autorisés : ceux de la configuration, puis les dossiers de données de Mire (`dataDirs`). */
export function allowedRoots(cfg: AllowedConfig, dataDirs: readonly string[]): string[] {
  const roots: string[] = [];
  const addLoc = (loc: unknown) => {
    const r = resolveLocation(loc);
    if (r.type === 'path' && r.path) roots.push(r.path);
  };
  for (const src of cfg.library.sources) addLoc(src.location);
  for (const src of cfg.gameSources) addLoc(src.location);
  for (const e of cfg.emulators) {
    if (e.romsDir) roots.push(e.romsDir);
    // Champ libre de la console (pas dans le type) : seul un chemin compte pour la politique d'accès.
    if (e.imagesDir && typeof e.imagesDir === 'string') roots.push(e.imagesDir);
    for (const x of e.sources || []) addLoc(x);
  }
  roots.push(...dataDirs);
  return roots;
}

/** Fichiers autorisés un par un par la configuration : image d'un jeu PC, bannière d'une console. */
export function allowedFiles(cfg: Pick<Config, 'games' | 'emulators'>): string[] {
  return [...cfg.games.map((g) => g.image), ...cfg.emulators.map((e) => e.banner)].filter((f): f is string => !!f);
}
