/**
 * Dépôts tiers et confiance (P3-08, D-08, D-18) : les dépôts ajoutés par l'utilisateur et ses accords pour les plugins
 * tiers de code sensible, dans `userData/repos/trust.json`.
 *
 * Ce fichier est à part de la configuration : l'interface ne peut le changer que par les méthodes vérifiées de ce
 * module (ajout avec l'empreinte vue par l'utilisateur, retrait, accord pour une version précise).
 *
 * - Identifiant d'un dépôt tiers : `repo-` et le début de l'empreinte de sa clé, calculé par Mire. Il ne peut donc
 *   jamais valoir `official` (ni le contrefaire), et une même clé ne peut être ajoutée deux fois.
 * - Accord : lié à l'identifiant du plugin, au dépôt et à la version notés par Mire, avec le niveau et les permissions
 *   acceptés. Une mise à jour garde l'accord si elle ne demande rien de plus (`covers`) ; sinon il est redemandé.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PluginLevel } from '@mire/plugin-sdk';
import { PRIVILEGED_PERMISSIONS } from '../../../packages/plugin-sdk/src/manifest.ts';
import { canonicalJson, keyId, loadPublicKey } from './index-file.ts';
import type { RepositoryConfig } from './repositories.ts';

/** Bornes des arguments venus de l'interface. */
export const MAX_URL_LENGTH = 2048;
export const MAX_KEY_LENGTH = 1024;
/** Nombre de dépôts tiers au plus : au-delà, c'est une erreur ou un abus. */
export const MAX_REPOSITORIES = 32;
const MAX_CONSENTS = 2000;

const THIRD_PARTY_ID_RE = /^repo-[0-9a-f]{16}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const PEM_RE = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/;

/** Dépôt tiers ajouté par l'utilisateur. */
export interface ThirdPartyRepository {
  id: string;
  /** Adresse `https:` de l'index. */
  index: string;
  /** Clé publique ed25519 (PEM). */
  publicKey: string;
  /** Empreinte de la clé (sha256 de ses 32 octets, comme `signature.keyId`) que l'utilisateur a vue. */
  fingerprint: string;
  addedAt: number;
}

/** Accord de l'utilisateur pour une version d'un plugin tiers de code sensible. */
export interface Consent {
  plugin: string;
  repository: string;
  version: string;
  level: PluginLevel;
  permissions: Record<string, unknown>;
  at: number;
}

/** Ce qu'il faut accepter pour installer ou charger une version. */
export type ConsentRequest = Omit<Consent, 'at'>;

interface TrustFile {
  repositories: ThirdPartyRepository[];
  consents: Consent[];
}

/** Adresse d'index acceptable : `https:`, sans nom ni mot de passe, de taille raisonnable. `null` sinon. */
export function checkIndexUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  return url.href;
}

/** Clé publique acceptable : PEM d'une clé ed25519, de taille raisonnable. Rend son empreinte, ou `null`. */
export function keyFingerprint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_KEY_LENGTH || !PEM_RE.test(value.trim())) return null;
  try {
    return keyId(loadPublicKey(value));
  } catch {
    return null;
  }
}

/** Identifiant d'un dépôt tiers d'après l'empreinte de sa clé. */
export const thirdPartyId = (fingerprint: string): string => `repo-${fingerprint.slice(0, 16)}`;

/** Configuration (client des dépôts) d'un dépôt tiers : jamais officiel. */
export const toConfig = (r: ThirdPartyRepository): RepositoryConfig => ({ id: r.id, index: r.index, publicKey: r.publicKey, official: false });

/** Code sensible : niveau `privileged`, ou une permission réservée à ce niveau. */
export function isSensitive(level: PluginLevel, permissions: Record<string, unknown> | undefined): boolean {
  return level === 'privileged' || PRIVILEGED_PERMISSIONS.some((p) => permissions?.[p] === true);
}

/**
 * La permission `next` demande-t-elle au plus ce que `accepted` accordait ? Booléens : pas de nouveau `true` ; listes
 * (hôtes) : pas de nouvel élément ; autres valeurs : identiques.
 */
function within(next: unknown, accepted: unknown): boolean {
  if (next === undefined || next === false) return true;
  if (next === true) return accepted === true;
  if (Array.isArray(next)) {
    const ok = new Set((Array.isArray(accepted) ? accepted : []).map((v) => canonicalJson(v)));
    return next.every((v) => ok.has(canonicalJson(v)));
  }
  try {
    return canonicalJson(next) === canonicalJson(accepted);
  } catch {
    return false;
  }
}

const LEVEL_RANK: Record<PluginLevel, number> = { data: 0, code: 1, privileged: 2 };

/** L'accord `accepted` couvre-t-il la demande `request` (même plugin et même dépôt, rien de plus demandé) ? */
export function covers(accepted: ConsentRequest, request: ConsentRequest): boolean {
  if (accepted.plugin !== request.plugin || accepted.repository !== request.repository) return false;
  if (LEVEL_RANK[request.level] > LEVEL_RANK[accepted.level]) return false;
  return Object.entries(request.permissions ?? {}).every(([name, value]) => within(value, accepted.permissions?.[name]));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Dépôt lu sur le disque : gardé seulement s'il est cohérent (identifiant, adresse, clé et empreinte). */
function validRepository(r: unknown): r is ThirdPartyRepository {
  if (!isObject(r) || typeof r.id !== 'string' || typeof r.fingerprint !== 'string') return false;
  return (
    THIRD_PARTY_ID_RE.test(r.id) &&
    FINGERPRINT_RE.test(r.fingerprint) &&
    r.id === thirdPartyId(r.fingerprint) &&
    checkIndexUrl(r.index) === r.index &&
    keyFingerprint(r.publicKey) === r.fingerprint &&
    typeof r.addedAt === 'number'
  );
}

function validConsent(c: unknown): c is Consent {
  return (
    isObject(c) &&
    typeof c.plugin === 'string' &&
    typeof c.repository === 'string' &&
    THIRD_PARTY_ID_RE.test(c.repository) &&
    typeof c.version === 'string' &&
    (c.level === 'data' || c.level === 'code' || c.level === 'privileged') &&
    isObject(c.permissions) &&
    typeof c.at === 'number'
  );
}

export interface TrustStoreOptions {
  /** `userData/repos/trust.json`. */
  file: string;
  log?: (message: string) => void;
}

export function createTrustStore(opts: TrustStoreOptions) {
  const log = opts.log ?? ((m: string) => console.error(m));
  const data = read();

  function read(): TrustFile {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`Dépôts : ${opts.file} illisible, ignoré (${(err as Error).message}).`);
      return { repositories: [], consents: [] };
    }
    const o = isObject(raw) ? raw : {};
    const repos = Array.isArray(o.repositories) ? o.repositories : [];
    const consents = Array.isArray(o.consents) ? o.consents : [];
    const repositories = repos.filter(validRepository).slice(0, MAX_REPOSITORIES);
    if (repositories.length !== repos.length) log('Dépôts : des dépôts tiers mal formés ont été ignorés.');
    return { repositories, consents: consents.filter(validConsent).slice(-MAX_CONSENTS) };
  }

  function write(): void {
    fs.mkdirSync(path.dirname(opts.file), { recursive: true });
    const tmp = `${opts.file}.${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, opts.file);
  }

  const same = (c: ConsentRequest, plugin: string, repository: string, version: string) =>
    c.plugin === plugin && c.repository === repository && c.version === version;

  return {
    repositories: (): ThirdPartyRepository[] => data.repositories.map((r) => ({ ...r })),
    get: (id: string): ThirdPartyRepository | null => data.repositories.find((r) => r.id === id) ?? null,

    /** Ajoute un dépôt déjà vérifié (adresse, clé, empreinte confirmée, index lu). */
    add(r: ThirdPartyRepository): void {
      data.repositories.push({ ...r });
      write();
    },

    remove(id: string): void {
      data.repositories = data.repositories.filter((r) => r.id !== id);
      write();
    },

    /** Accord donné pour cette version (exactement) et couvrant ce qu'elle demande. */
    consented(request: ConsentRequest): boolean {
      return data.consents.some((c) => same(c, request.plugin, request.repository, request.version) && covers(c, request));
    },

    /** Accord donné pour une autre version (celle installée) qui couvre déjà ce que demande `request`. */
    carried(request: ConsentRequest, fromVersion: string): boolean {
      return data.consents.some((c) => same(c, request.plugin, request.repository, fromVersion) && covers(c, request));
    },

    /** Note l'accord de l'utilisateur pour cette version ; remplace un accord de la même version. */
    grant(request: ConsentRequest): void {
      data.consents = data.consents.filter((c) => !same(c, request.plugin, request.repository, request.version));
      data.consents.push({ ...structuredClone(request), at: Date.now() });
      if (data.consents.length > MAX_CONSENTS) data.consents.splice(0, data.consents.length - MAX_CONSENTS);
      write();
    },

    /** Retire les accords d'un plugin (de toutes ses versions) dans un dépôt. */
    revoke(plugin: string, repository: string): void {
      const before = data.consents.length;
      data.consents = data.consents.filter((c) => !(c.plugin === plugin && c.repository === repository));
      if (data.consents.length !== before) write();
    },
  };
}

export type TrustStore = ReturnType<typeof createTrustStore>;
