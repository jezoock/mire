/**
 * Installation d'une version de plugin depuis un dépôt, dans `userData/plugins/<id>/<version>/` :
 * 1. téléchargement du paquet (https, taille de l'index au plus, délai) ;
 * 2. taille et empreinte sha256 comparées à l'index AVANT d'ouvrir l'archive ;
 * 3. archive lue par `tar.ts` (fichiers ordinaires aux chemins sûrs seulement) ;
 * 4. manifeste validé par le SDK, et identique à l'index pour l'identifiant, la version, le niveau, les permissions
 *    et les dépendances (ce que l'utilisateur a vu avant d'installer est ce qui est installé) ;
 * 5. écriture dans un dossier temporaire du plugin, puis remplacement par renommage (`commit`), annulable
 *    (`rollback`) tant que l'installation n'est pas confirmée (`finish`).
 *
 * Aucun code du paquet n'est exécuté pendant l'installation : les fichiers sont seulement écrits.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PluginManifest } from '@mire/plugin-sdk';
import { MANIFEST_FILE } from '../../../packages/plugin-sdk/src/manifest.ts';
import { validateManifest } from '../../../packages/plugin-sdk/src/validate.ts';
import type { FetchLike } from '../net/http.ts';
import { downloadBytes } from './download.ts';
import { RepoError } from './errors.ts';
import { canonicalJson, sha256, type IndexVersion } from './index-file.ts';
import { readTgz, type TarFile } from './tar.ts';

/** Fichier d'origine d'un plugin installé depuis un dépôt : `userData/plugins/<id>/origin.json`. */
export const ORIGIN_FILE = 'origin.json';

export interface PluginOriginRecord {
  /** Identifiant du dépôt qui l'a installé. */
  repository: string;
  version: string;
  sha256: string;
  installedAt: number;
}

/** Taille maximale d'un paquet, quelle que soit celle annoncée par l'index. */
export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const PACKAGE_TIMEOUT = 5 * 60_000;

export interface InstallItem {
  id: string;
  entry: IndexVersion;
  repository: string;
  official: boolean;
}

export interface InstallerOptions {
  /** `userData/plugins/`. */
  pluginsDir: string;
  fetch?: FetchLike;
  timeout?: number;
  maxPackageBytes?: number;
}

/** Version installée et ce qu'il faut pour revenir à l'état d'avant. */
export interface Committed {
  id: string;
  version: string;
  dir: string;
  /** Ancien dossier de la même version (réinstallation), mis de côté. */
  backup: string | null;
  /** Ancien `origin.json` (contenu), ou `null`. */
  previousOrigin: string | null;
}

const temp = (dir: string, kind: string) => path.join(dir, `.${kind}-${randomBytes(6).toString('hex')}`);
const inside = (root: string, p: string) => p.startsWith(root + path.sep);
const sameJson = (a: unknown, b: unknown) => canonicalJson(a ?? {}) === canonicalJson(b ?? {});

/** Lit `origin.json` d'un plugin installé, s'il est bien formé. */
export function readOrigin(pluginsDir: string, id: string): PluginOriginRecord | null {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(pluginsDir, id, ORIGIN_FILE), 'utf8')) as PluginOriginRecord;
    return typeof o?.repository === 'string' && typeof o.version === 'string' ? o : null;
  } catch {
    return null;
  }
}

export function createInstaller(opts: InstallerOptions) {
  const root = path.resolve(opts.pluginsDir);

  /** Téléchargement vérifié : taille et empreinte de l'index, avant toute lecture de l'archive. */
  async function download(item: InstallItem, onProgress?: (received: number, total: number) => void, signal?: AbortSignal): Promise<Buffer> {
    const { size, sha256: expected, url } = item.entry.package;
    const max = Math.min(opts.maxPackageBytes ?? MAX_PACKAGE_BYTES, MAX_PACKAGE_BYTES);
    if (size > max) throw new RepoError('too-big', `${item.id} ${item.entry.version}: package of ${size} bytes, at most ${max}.`);
    const bytes = await downloadBytes(url, { maxBytes: size, timeout: opts.timeout ?? PACKAGE_TIMEOUT, fetch: opts.fetch, onProgress, signal });
    if (bytes.length !== size || sha256(bytes) !== expected)
      throw new RepoError('checksum', `${item.id} ${item.entry.version}: sha256 or size differs from the index.`);
    return bytes;
  }

  /** Manifeste du paquet, validé et identique à l'index. */
  function checkManifest(item: InstallItem, files: TarFile[]): PluginManifest {
    const fail = (why: string): never => {
      throw new RepoError('manifest', `${item.id} ${item.entry.version}: ${why}`);
    };
    const raw = files.find((f) => f.path === MANIFEST_FILE)?.data;
    if (!raw) return fail(`${MANIFEST_FILE} missing from the package.`);
    let m: PluginManifest;
    try {
      m = JSON.parse(raw.toString('utf8')) as PluginManifest;
    } catch {
      return fail(`${MANIFEST_FILE} unreadable.`);
    }
    const result = validateManifest(m, { official: item.official });
    if (!result.ok)
      fail(
        `invalid manifest (${result.issues
          .slice(0, 5)
          .map((i) => i.message)
          .join('; ')}).`,
      );
    if (m.id !== item.id || m.version !== item.entry.version) fail(`the package contains ${m.id} ${m.version}.`);
    if (m.level !== item.entry.level || !sameJson(m.permissions, item.entry.permissions) || !sameJson(m.dependencies, item.entry.dependencies))
      fail('level, permissions or dependencies differ from the index.');
    return m;
  }

  /** Écrit les fichiers dans un dossier temporaire sous `userData/plugins/<id>/`, sans jamais en sortir. */
  async function stage(item: InstallItem, files: TarFile[]): Promise<string> {
    const pluginDir = path.join(root, item.id);
    if (!inside(root, pluginDir)) throw new RepoError('manifest', `Id refused: ${item.id}`);
    await fsp.mkdir(pluginDir, { recursive: true });
    const staging = temp(pluginDir, 'staging');
    await fsp.mkdir(staging);
    try {
      for (const f of files) {
        const target = path.resolve(staging, ...f.path.split('/'));
        if (!inside(staging, target)) throw new RepoError('archive', `Path refused: ${f.path}`);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        // `wx` : jamais d'écriture à travers un fichier ou un lien déjà présent.
        await fsp.writeFile(target, f.data, { flag: 'wx', mode: 0o644 });
      }
    } catch (err) {
      await fsp.rm(staging, { recursive: true, force: true });
      throw err instanceof RepoError ? err : new RepoError('disk', `${item.id}: cannot write (${(err as Error).message}).`);
    }
    return staging;
  }

  return {
    /**
     * Télécharge, vérifie et prépare une version dans un dossier temporaire. Rien n'est remplacé : `commit` le fait.
     * Rend le dossier temporaire.
     */
    async prepare(
      item: InstallItem,
      onProgress?: (phase: 'download' | 'verify', received?: number, total?: number) => void,
      signal?: AbortSignal,
    ): Promise<string> {
      const bytes = await download(item, (r, t) => onProgress?.('download', r, t), signal);
      onProgress?.('verify');
      const files = readTgz(bytes);
      checkManifest(item, files);
      return stage(item, files);
    },

    /** Met la version préparée en place par renommage, et note son origine. */
    async commit(item: InstallItem, staging: string): Promise<Committed> {
      const pluginDir = path.join(root, item.id);
      const dir = path.join(pluginDir, item.entry.version);
      let backup: string | null = null;
      if (fs.existsSync(dir)) {
        backup = temp(pluginDir, 'previous');
        await fsp.rename(dir, backup);
      }
      try {
        await fsp.rename(staging, dir);
      } catch (err) {
        if (backup) await fsp.rename(backup, dir);
        await fsp.rm(staging, { recursive: true, force: true });
        throw new RepoError('disk', `${item.id}: cannot move into place (${(err as Error).message}).`);
      }
      const originFile = path.join(pluginDir, ORIGIN_FILE);
      const previousOrigin = fs.existsSync(originFile) ? await fsp.readFile(originFile, 'utf8') : null;
      const record: PluginOriginRecord = {
        repository: item.repository,
        version: item.entry.version,
        sha256: item.entry.package.sha256,
        installedAt: Date.now(),
      };
      await writeAtomic(originFile, JSON.stringify(record, null, 2));
      return { id: item.id, version: item.entry.version, dir, backup, previousOrigin };
    },

    /** Revient à l'état d'avant `commit` : la version installée est retirée, l'ancienne remise. */
    async rollback(c: Committed): Promise<void> {
      const pluginDir = path.join(root, c.id);
      await fsp.rm(c.dir, { recursive: true, force: true });
      if (c.backup) await fsp.rename(c.backup, c.dir);
      const originFile = path.join(pluginDir, ORIGIN_FILE);
      if (c.previousOrigin !== null) await writeAtomic(originFile, c.previousOrigin);
      else await fsp.rm(originFile, { force: true });
      // Plus rien d'installé sous cet identifiant : le dossier du plugin disparaît aussi.
      await fsp.rmdir(pluginDir).catch(() => {});
    },

    /** Installation confirmée : les anciennes versions et les dossiers temporaires du plugin sont effacés. */
    async finish(c: Committed): Promise<void> {
      const pluginDir = path.join(root, c.id);
      for (const name of await fsp.readdir(pluginDir).catch(() => [] as string[])) {
        if (name === c.version || name === ORIGIN_FILE) continue;
        await fsp.rm(path.join(pluginDir, name), { recursive: true, force: true });
      }
    },

    /** Dossier temporaire abandonné (installation annulée avant `commit`) ; le dossier du plugin aussi s'il est vide. */
    async discard(staging: string): Promise<void> {
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.rmdir(path.dirname(staging)).catch(() => {});
    },
  };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}

export type Installer = ReturnType<typeof createInstaller>;
