/**
 * Contrôle des chemins de la gestion des fichiers (P2-10) : l'interface n'est jamais crue sur parole (même principe
 * que la suppression des jeux, `games/delete.ts`). Un chemin n'est accepté que s'il est strictement sous une racine
 * autorisée, avant comme après résolution des liens symboliques (`realpath` du chemin et des racines), et s'il
 * n'est ni une racine ni la racine d'un disque.
 */
import path from 'node:path';
import { isInside } from '../lib/paths.ts';

/** Raison d'un refus ; chacune a son message dans les catalogues (`files.errors.*`). */
export type FilesErrorCode = 'invalid' | 'outside' | 'root' | 'missing' | 'link' | 'exists' | 'name' | 'notFolder' | 'into' | 'crossDevice' | 'failed';

export type Checked<T extends object = object> = ({ ok: true } & T) | { ok: false; code: FilesErrorCode; reason?: string };

/** Ce que le contrôle lit du disque (injectable dans les tests). */
export interface GuardFs {
  realpath(p: string): Promise<string>;
}

export interface GuardOptions {
  platform: NodeJS.Platform;
  fs: GuardFs;
}

const pathOf = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/** Vrai pour la racine d'un disque ou d'un partage (`/`, `C:\`, `\\nas\films`). */
export function isSystemRoot(p: string, platform: NodeJS.Platform): boolean {
  const m = pathOf(platform);
  const resolved = m.resolve(p);
  return m.parse(resolved).root === resolved || m.dirname(resolved) === resolved;
}

/** Chemin d'un partage réseau (`\\nas\…`, `//nas/…`) : jamais géré, même sous une racine. */
const isNetworkPath = (p: string) => /^[\\/]{2}/.test(p);

/** Chemin réel, ou `null` s'il n'existe pas (ou ne se lit pas). */
async function real(fs: GuardFs, p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/** Racines utilisables : absolues, locales, pas la racine d'un disque, avec leur chemin réel (racine absente écartée). */
export async function realRoots(roots: readonly string[], { platform, fs }: GuardOptions): Promise<{ given: string[]; real: string[] }> {
  const m = pathOf(platform);
  const given = roots.filter((r) => typeof r === 'string' && m.isAbsolute(r) && !isNetworkPath(r) && !isSystemRoot(r, platform));
  const reals = await Promise.all(given.map((r) => real(fs, r)));
  return { given, real: reals.filter((r): r is string => !!r && !isSystemRoot(r, platform)) };
}

/** Forme écrite du chemin : chaîne absolue, locale, sans `..` (la règle de `isInside`). */
function wellFormed(target: unknown, platform: NodeJS.Platform): target is string {
  const m = pathOf(platform);
  if (typeof target !== 'string' || !target || target.includes('\0') || !m.isAbsolute(target) || isNetworkPath(target)) return false;
  return !target.split(platform === 'win32' ? /[\\/]+/ : /\/+/).includes('..');
}

const sameRoot = (p: string, roots: readonly string[], platform: NodeJS.Platform) => {
  const m = pathOf(platform);
  const key = (x: string) => (platform === 'win32' ? m.resolve(x).toLowerCase() : m.resolve(x));
  return roots.some((r) => key(r) === key(p));
};

/**
 * Fichier ou dossier existant, strictement sous une racine (écrit tel quel, puis par son chemin réel). Rend le chemin
 * tel qu'écrit (c'est lui qu'on renomme ou supprime : un lien symbolique resté sous les racines est traité comme un
 * fichier, sans toucher à ce qu'il désigne).
 */
export async function checkExisting(target: unknown, roots: readonly string[], opts: GuardOptions): Promise<Checked<{ path: string }>> {
  const { platform, fs } = opts;
  if (!wellFormed(target, platform)) return { ok: false, code: 'invalid' };
  const m = pathOf(platform);
  const p = m.resolve(target);
  const r = await realRoots(roots, opts);
  if (isSystemRoot(p, platform) || sameRoot(p, r.given, platform)) return { ok: false, code: 'root' };
  if (!isInside(p, r.given, { platform })) return { ok: false, code: 'outside' };
  const realPath = await real(fs, p);
  if (!realPath) return { ok: false, code: 'missing' };
  if (isSystemRoot(realPath, platform) || sameRoot(realPath, r.real, platform)) return { ok: false, code: 'root' };
  // Lien symbolique (le fichier lui-même ou un dossier parent) qui mène hors des racines.
  if (!isInside(realPath, r.real, { platform })) return { ok: false, code: 'link' };
  return { ok: true, path: p };
}

/** Dossier d'arrivée d'un déplacement : une racine elle-même ou un dossier sous une racine, par son chemin réel aussi. */
export async function checkFolder(target: unknown, roots: readonly string[], opts: GuardOptions): Promise<Checked<{ path: string; real: string }>> {
  const { platform, fs } = opts;
  if (!wellFormed(target, platform)) return { ok: false, code: 'invalid' };
  const m = pathOf(platform);
  const p = m.resolve(target);
  const r = await realRoots(roots, opts);
  if (!sameRoot(p, r.given, platform) && !isInside(p, r.given, { platform })) return { ok: false, code: 'outside' };
  const realPath = await real(fs, p);
  if (!realPath) return { ok: false, code: 'missing' };
  if (!sameRoot(realPath, r.real, platform) && !isInside(realPath, r.real, { platform })) return { ok: false, code: 'link' };
  return { ok: true, path: p, real: realPath };
}

/**
 * Nouveau nom d'un fichier ou d'un dossier : ni vide, ni `.` ou `..`, sans séparateur (`/` ni `\`, sur tous les
 * systèmes) ni caractère nul ; sous Windows, sans les caractères qu'il refuse et sans espace ni point final.
 */
export function isValidName(name: unknown, platform: NodeJS.Platform): name is string {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  if (platform === 'win32' && (/[<>:"|?*\x01-\x1f]/.test(name) || /[. ]$/.test(name))) return false;
  return true;
}
