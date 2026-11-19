/**
 * Index des dépôts configurés (le dépôt officiel et les dépôts tiers ajoutés par l'utilisateur, P3-08) :
 * téléchargement, vérification (signature avec la clé du dépôt, structure), cache hors ligne.
 *
 * Cache : `userData/repos/<dépôt>/index.json`, les octets tels que reçus. Il est vérifié de nouveau à chaque lecture
 * (signature comprise) : un fichier modifié sur le disque n'est jamais cru. Un index téléchargé plus ancien que celui
 * du cache est refusé (retour en arrière), et le cache est gardé ; sans réseau, le cache sert.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { KeyObject } from 'node:crypto';
import type { FetchLike } from '../net/http.ts';
import { downloadBytes } from './download.ts';
import { RepoError, repoErrorCode, type RepoErrorCode } from './errors.ts';
import { keyId, loadPublicKey, parseIndex, type Localized, type RepoIndex } from './index-file.ts';

export interface RepositoryConfig {
  /** Identifiant (nom du dossier de cache) : minuscules, chiffres et tirets. */
  id: string;
  /** Adresse `https:` de l'index. */
  index: string;
  /** Clé publique ed25519 (PEM ou 32 octets en base64). */
  publicKey: string;
  /** Dépôt officiel : préfixe `mire.` permis, code sensible accepté. */
  official: boolean;
}

/** État d'un dépôt pour l'interface (P4-18). */
export interface RepositoryStatus {
  id: string;
  official: boolean;
  /** Adresse de l'index. */
  index: string;
  /** Empreinte de la clé (sha256 de ses 32 octets, `signature.keyId`), à comparer avec celle que publie le dépôt. */
  fingerprint: string;
  name: Localized | null;
  /** Date de publication de l'index utilisé (`generated`), ou `null` s'il n'y en a pas encore. */
  generated: string | null;
  /** Dernière lecture réussie de l'index en ligne (ms), `null` si jamais pendant cette session. */
  checkedAt: number | null;
  /** Erreur de la dernière mise à jour (le cache sert alors), ou `null`. */
  error: RepoErrorCode | null;
}

export interface RepositoriesOptions {
  cacheDir: string;
  repositories: () => readonly RepositoryConfig[];
  fetch?: FetchLike;
  /** Taille maximale d'un index (octets). */
  maxIndexBytes?: number;
  /** Délai de téléchargement d'un index (ms). */
  timeout?: number;
  log?: (message: string) => void;
}

export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const INDEX_TIMEOUT = 30_000;
const REPO_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface Entry {
  config: RepositoryConfig;
  key: KeyObject;
  index: RepoIndex | null;
  checkedAt: number | null;
  error: RepoErrorCode | null;
}

export function createRepositories(opts: RepositoriesOptions) {
  const entries = new Map<string, Entry>();
  const log = opts.log ?? ((m: string) => console.error(m));
  const cacheFile = (id: string) => path.join(opts.cacheDir, id, 'index.json');

  /** Entrée d'un dépôt configuré (créée à la première demande, cache lu et vérifié). */
  function entry(config: RepositoryConfig): Entry | null {
    let e = entries.get(config.id);
    if (e && e.config.index === config.index && e.config.publicKey === config.publicKey) return e;
    if (!REPO_ID_RE.test(config.id)) return null;
    let key: KeyObject;
    try {
      key = loadPublicKey(config.publicKey);
    } catch (err) {
      log(`Dépôts : clé de ${config.id} illisible (${(err as Error).message}).`);
      return null;
    }
    e = { config, key, index: readCache(config, key), checkedAt: null, error: null };
    entries.set(config.id, e);
    return e;
  }

  function readCache(config: RepositoryConfig, key: KeyObject): RepoIndex | null {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(cacheFile(config.id));
    } catch {
      return null;
    }
    try {
      return parseIndex(bytes, key, { official: config.official });
    } catch (err) {
      log(`Dépôts : cache de ${config.id} refusé (${(err as Error).message}).`);
      return null;
    }
  }

  async function writeCache(id: string, bytes: Buffer): Promise<void> {
    const file = cacheFile(id);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, file);
  }

  const download = (url: string, signal?: AbortSignal) =>
    downloadBytes(url, { maxBytes: opts.maxIndexBytes ?? MAX_INDEX_BYTES, timeout: opts.timeout ?? INDEX_TIMEOUT, fetch: opts.fetch, signal });

  async function refreshOne(e: Entry, signal?: AbortSignal): Promise<void> {
    try {
      const bytes = await download(e.config.index, signal);
      const index = parseIndex(bytes, e.key, { official: e.config.official });
      if (e.index && Date.parse(index.generated) < Date.parse(e.index.generated))
        throw new RepoError('rollback', `Index of ${index.generated}, older than the cached one (${e.index.generated}).`);
      await writeCache(e.config.id, bytes);
      e.index = index;
      e.checkedAt = Date.now();
      e.error = null;
    } catch (err) {
      e.error = repoErrorCode(err);
      log(`Dépôts : index de ${e.config.id} non mis à jour (${(err as Error).message}).`);
    }
  }

  const configured = (): Entry[] => opts.repositories().flatMap((c) => entry(c) ?? []);

  return {
    /** Télécharge et vérifie l'index de chaque dépôt ; en cas d'échec, le cache reste utilisé. */
    async refresh(signal?: AbortSignal): Promise<RepositoryStatus[]> {
      await Promise.all(configured().map((e) => refreshOne(e, signal)));
      return this.status();
    },

    /** Dépôts configurés et index utilisables (en ligne ou en cache), sans réseau. */
    indexes(): { config: RepositoryConfig; index: RepoIndex }[] {
      return configured().flatMap((e) => (e.index ? [{ config: e.config, index: e.index }] : []));
    },

    /**
     * Télécharge et vérifie l'index d'un dépôt pas encore configuré (ajout d'un dépôt tiers), sans rien garder.
     * Lève une `RepoError` (adresse, réseau, signature, format, préfixe réservé…).
     */
    async probe(config: RepositoryConfig, signal?: AbortSignal): Promise<{ index: RepoIndex; bytes: Buffer }> {
      if (!REPO_ID_RE.test(config.id)) throw new RepoError('format', `Repository id refused: ${config.id}`);
      let key: KeyObject;
      try {
        key = loadPublicKey(config.publicKey);
      } catch (err) {
        throw new RepoError('key', (err as Error).message);
      }
      const bytes = await download(config.index, signal);
      return { index: parseIndex(bytes, key, { official: config.official }), bytes };
    },

    /** Garde en cache l'index vérifié par `probe` d'un dépôt qui vient d'être ajouté. */
    async seed(config: RepositoryConfig, bytes: Buffer): Promise<void> {
      await writeCache(config.id, bytes);
      entries.delete(config.id);
      const e = entry(config);
      if (e) e.checkedAt = Date.now();
    },

    /** Oublie un dépôt retiré : son entrée et son cache. */
    async drop(id: string): Promise<void> {
      if (!REPO_ID_RE.test(id)) return;
      entries.delete(id);
      await fsp.rm(path.join(opts.cacheDir, id), { recursive: true, force: true });
    },

    status(): RepositoryStatus[] {
      return configured().map((e) => ({
        id: e.config.id,
        official: e.config.official,
        index: e.config.index,
        fingerprint: keyId(e.key),
        name: e.index?.repository.name ?? null,
        generated: e.index?.generated ?? null,
        checkedAt: e.checkedAt,
        error: e.error,
      }));
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
