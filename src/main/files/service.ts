/**
 * Gestion des fichiers (P2-10, D-16) : renommer, déplacer, supprimer un fichier ou un dossier, seulement sous les
 * dossiers locaux de la configuration (`roots.ts`), jamais rien d'autre (fichier ouvert à part, dossier de données
 * de Mire, partage réseau, serveur web). La suppression passe par la corbeille du système : rien n'est effacé pour
 * de bon. La confirmation est demandée par l'interface (P4-09) ; ce service, lui, ne croit jamais l'interface sur
 * parole : chaque chemin est contrôlé (`guard.ts`).
 *
 * Après l'opération, le catalogue suit (`follow`) : ce qui est rangé par clé d'élément passe sous la nouvelle clé, et
 * les éléments disparus quittent le catalogue.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { checkExisting, checkFolder, isValidName, type Checked, type FilesErrorCode, type GuardFs } from './guard.ts';

/** Ce que le service fait sur le disque (injectable : les tests tournent sans Electron). */
export interface FilesOps extends GuardFs {
  /** Identité d'un fichier sans suivre un lien (`fs.lstat`) ; rejette si rien n'existe. */
  lstat(p: string): Promise<{ dev: number; ino: number; isDirectory(): boolean }>;
  rename(from: string, to: string): Promise<void>;
  /** Met un fichier ou un dossier à la corbeille (`shell.trashItem` d'Electron). */
  trash(p: string): Promise<void>;
}

/** Ce que l'opération change pour le catalogue. */
export interface FilesFollow {
  /** `from` (fichier ou dossier) est maintenant `to`. */
  moved(from: string, to: string): void;
  /** `target` (fichier ou dossier) n'est plus sur le disque. */
  removed(target: string): void;
}

export interface FilesServiceOptions {
  /** Dossiers locaux de la configuration, sous lesquels le service agit (recalculés à chaque opération). */
  roots: () => readonly string[];
  ops: Pick<FilesOps, 'trash'> & Partial<FilesOps>;
  follow?: FilesFollow;
  platform?: NodeJS.Platform;
}

export type FilesResult = Checked<{ path: string }>;

const nodeOps: Omit<FilesOps, 'trash'> = {
  realpath: (p) => fsp.realpath(p),
  lstat: (p) => fsp.lstat(p),
  rename: (from, to) => fsp.rename(from, to),
};

const failure = (code: FilesErrorCode, reason?: string): { ok: false; code: FilesErrorCode; reason?: string } =>
  reason ? { ok: false, code, reason } : { ok: false, code };

export function createFilesService({ roots, ops: given, follow, platform = process.platform }: FilesServiceOptions) {
  const ops: FilesOps = { ...nodeOps, ...given };
  const m = platform === 'win32' ? path.win32 : path.posix;
  const guard = { platform, fs: ops };

  /** Rien n'existe à `to` ; sauf `to` qui désigne `from` lui-même (changement de casse sous Windows ou macOS). */
  async function free(from: string, to: string): Promise<boolean> {
    let there: { dev: number; ino: number };
    try {
      there = await ops.lstat(to);
    } catch {
      return true;
    }
    const self = await ops.lstat(from);
    return there.dev === self.dev && there.ino === self.ino && from !== to;
  }

  /** Renommage ou déplacement contrôlé, puis le catalogue suit. */
  async function moveTo(from: string, to: string): Promise<FilesResult> {
    if (!(await free(from, to))) return failure('exists');
    try {
      await ops.rename(from, to);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      return e.code === 'EXDEV' ? failure('crossDevice') : failure('failed', e.message);
    }
    follow?.moved(from, to);
    return { ok: true, path: to };
  }

  return {
    /**
     * Contrôle sans rien changer (`files.check`) : le fichier ou le dossier existe et le service pourrait agir dessus.
     * L'explorateur s'en sert pour proposer ou non ses actions (P4-09) ; chaque opération refait ce contrôle.
     */
    check(target: unknown): Promise<FilesResult> {
      return checkExisting(target, roots(), guard);
    },

    /** Renomme un fichier ou un dossier (`files.rename`), sans le changer de dossier ; rend son nouveau chemin. */
    async rename(target: unknown, name: unknown): Promise<FilesResult> {
      if (!isValidName(name, platform)) return failure('name');
      const src = await checkExisting(target, roots(), guard);
      if (!src.ok) return src;
      return moveTo(src.path, m.join(m.dirname(src.path), name));
    },

    /** Déplace un fichier ou un dossier dans le dossier `folder` (`files.move`), sous le même nom ; rend son nouveau chemin. */
    async move(target: unknown, folder: unknown): Promise<FilesResult> {
      const src = await checkExisting(target, roots(), guard);
      if (!src.ok) return src;
      const dest = await checkFolder(folder, roots(), guard);
      if (!dest.ok) return dest;
      if (!(await ops.lstat(dest.real)).isDirectory()) return failure('notFolder');
      // Un dossier ne se déplace pas en lui-même ni dans ce qu'il contient (comparés par chemins réels).
      const srcReal = await ops.realpath(src.path);
      const key = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);
      const rel = m.relative(key(srcReal), key(dest.real));
      if (rel === '' || (rel !== '..' && !rel.startsWith(`..${m.sep}`) && !m.isAbsolute(rel))) return failure('into');
      const to = m.join(dest.path, m.basename(src.path));
      if (key(m.resolve(to)) === key(src.path)) return failure('exists');
      return moveTo(src.path, to);
    },

    /** Met un fichier ou un dossier à la corbeille (`files.remove`) ; rend le chemin retiré. */
    async remove(target: unknown): Promise<FilesResult> {
      const src = await checkExisting(target, roots(), guard);
      if (!src.ok) return src;
      try {
        await ops.trash(src.path);
      } catch (err) {
        return failure('failed', (err as Error).message);
      }
      follow?.removed(src.path);
      return { ok: true, path: src.path };
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
