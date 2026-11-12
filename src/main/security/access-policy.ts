/**
 * Politique d'accès aux fichiers locaux : seule réponse à « l'interface peut-elle lire ou lancer ce fichier ? ».
 * Sont autorisés :
 * - les fichiers sous une racine autorisée (dossiers de la bibliothèque, des jeux, des consoles, images en cache) ;
 * - les fichiers désignés un par un par la configuration (image d'un jeu PC, bannière d'une console) ;
 * - les fichiers ouverts explicitement (boîte de dialogue, glisser-déposer, ligne de commande).
 * Racines et fichiers de la configuration sont calculés une fois, puis à nouveau après `invalidate()` (appelé à
 * chaque changement de configuration) : une vignette affichée ne refait pas tout le calcul (constat A6).
 */
import path from 'node:path';
import { isInside } from '../lib/paths.ts';

export interface AccessPolicyOptions {
  /** Racines autorisées, recalculées seulement après `invalidate()`. */
  roots: () => string[];
  /** Fichiers autorisés un par un par la configuration, recalculés avec les racines. */
  files?: () => string[];
  platform?: NodeJS.Platform;
}

export interface AccessPolicy {
  /** Vrai si l'interface peut lire ou lancer ce fichier. */
  isAllowed(file: unknown): boolean;
  /** Vrai si `file` est strictement sous l'une des `roots` (règle de `lib/paths.ts`, selon la plateforme). */
  isInside(file: unknown, roots: string[]): boolean;
  /** Autorise un fichier ouvert explicitement par l'utilisateur. */
  allowFile(file: string): void;
  /** Oublie les racines calculées : elles seront recalculées à la prochaine question. */
  invalidate(): void;
}

export function createAccessPolicy({ roots, files = () => [], platform = process.platform }: AccessPolicyOptions): AccessPolicy {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  // Clé de comparaison d'un fichier désigné nommément : chemin absolu, sans casse sous Windows.
  const key = (file: string) => {
    const r = p.resolve(String(file));
    return win ? r.toLowerCase() : r;
  };
  const opened = new Set<string>();
  let cache: { roots: string[]; files: Set<string> } | null = null;

  function current() {
    if (!cache) cache = { roots: roots(), files: new Set(files().filter(Boolean).map(key)) };
    return cache;
  }

  const inside = (file: unknown, list: string[]) => isInside(file, list, { platform });

  return {
    isAllowed(file) {
      if (!file || typeof file !== 'string') return false;
      const k = key(file);
      if (opened.has(k)) return true;
      const c = current();
      return c.files.has(k) || inside(file, c.roots);
    },
    isInside: inside,
    allowFile(file) {
      opened.add(key(file));
    },
    invalidate() {
      cache = null;
    },
  };
}
