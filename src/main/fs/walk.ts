/**
 * Parcours générique d'une arborescence de dossiers, en profondeur d'abord, dans l'ordre de lecture du disque.
 * Le visiteur reçoit le contenu de chaque dossier ; les sous-dossiers sont parcourus ensuite. Un dossier illisible
 * est ignoré sans erreur.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';

export interface WalkOptions {
  /** Profondeur maximale visitée (la racine est à 0). */
  maxDepth?: number;
  /** Sous-dossiers à ne pas parcourir. Par défaut : aucun. */
  skipDir?: (name: string) => boolean;
  /** Arrête le parcours (nombre maximal d'éléments atteint…). */
  shouldStop?: () => boolean;
  /** Clé d'un dossier : un dossier déjà vu sous la même clé (lien symbolique, casse) n'est pas revisité. */
  dirKey?: (dir: string) => string;
}

export type WalkVisitor = (dir: string, entries: Dirent[], depth: number) => void | Promise<void>;

export async function walkDirs(root: string, visit: WalkVisitor, opts: WalkOptions = {}): Promise<void> {
  const { maxDepth = Infinity, skipDir = () => false, shouldStop = () => false, dirKey } = opts;
  const seen = new Set<string>();
  async function go(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || shouldStop()) return;
    if (dirKey) {
      const k = dirKey(dir);
      if (seen.has(k)) return;
      seen.add(k);
    }
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await visit(dir, entries, depth);
    for (const e of entries) {
      if (shouldStop()) return;
      if (!e.isDirectory() || skipDir(e.name)) continue;
      await go(path.join(dir, e.name), depth + 1);
    }
  }
  await go(root, 0);
}

/** Clé d'un chemin : absolue, et sans casse sous Windows. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const r = path.resolve(String(p));
  return platform === 'win32' ? r.toLowerCase() : r;
}
