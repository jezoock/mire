/**
 * Index signé d'un dépôt de plugins (`index.json`) : lecture de la clé publique, vérification de la signature ed25519 et
 * de la structure. Reproduit la vérification de référence de `mire-addons` (`scripts/lib/index-file.mjs`, format
 * décrit dans son `docs/index-format.md`), avec `node:crypto` seulement (D-03).
 *
 * Octets signés : l'en-tête `mire-addons-index:1\n` puis la forme canonique de l'index sans `signature` (clés triées
 * dans l'ordre des unités UTF-16, aucun espace, entiers seulement : RFC 8785 pour ces données).
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { PluginLevel } from '@mire/plugin-sdk';
// Sources du SDK plutôt que son paquet (comme `plugins/discovery.ts`).
import { PLUGIN_LEVELS } from '../../../packages/plugin-sdk/src/manifest.ts';
import { isVersion, isVersionRange } from '../../../packages/plugin-sdk/src/semver.ts';
import { OFFICIAL_PREFIX, PLUGIN_ID_RE } from '../../../packages/plugin-sdk/src/validate.ts';
import { RepoError } from './errors.ts';

export const INDEX_FORMAT = 1;
export const SIGNATURE_CONTEXT = 'mire-addons-index:1\n';
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Texte par langue (`en` obligatoire pour le nom du dépôt). */
export type Localized = Record<string, string>;

/** Une version publiée d'un plugin, telle que l'index la décrit. */
export interface IndexVersion {
  version: string;
  engines: { mire: string };
  level: PluginLevel;
  contributes: string[];
  permissions: Record<string, unknown>;
  dependencies: Record<string, string>;
  name?: Localized;
  description?: Localized;
  package: { url: string; sha256: string; size: number };
}

export interface IndexPlugin {
  id: string;
  /** De la plus récente à la plus ancienne. */
  versions: IndexVersion[];
}

export interface RepoIndex {
  format: number;
  repository: { name: Localized; source?: string; index?: string };
  generated: string;
  plugins: IndexPlugin[];
  signature?: { algorithm: string; keyId: string; value: string };
}

/** JSON canonique : clés triées, sans espace, entiers seulement. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`Nombre non entier refusé dans l'index : ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new Error(`Valeur refusée dans l'index : ${typeof value}`);
}

/** Octets signés : en-tête de contexte puis index canonique sans `signature`. */
export function signedBytes(index: object): Buffer {
  const { signature: _signature, ...body } = index as { signature?: unknown };
  return Buffer.from(SIGNATURE_CONTEXT + canonicalJson(body), 'utf8');
}

/** Clé publique ed25519 : PEM (SPKI) ou 32 octets bruts en base64. */
export function loadPublicKey(text: string): KeyObject {
  const s = String(text).trim();
  let key: KeyObject;
  try {
    if (s.startsWith('-----BEGIN')) key = createPublicKey({ key: s, format: 'pem' });
    else {
      const raw = Buffer.from(s, 'base64');
      if (raw.length !== 32) throw new Error();
      key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    }
  } catch {
    throw new Error('Clé publique illisible : PEM (-----BEGIN PUBLIC KEY-----) ou 32 octets en base64 attendus.');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('La clé publique n’est pas une clé ed25519.');
  return key;
}

/** 32 octets bruts d'une clé publique ed25519. */
export const rawPublicKey = (key: KeyObject): Buffer => Buffer.from(key.export({ format: 'jwk' }).x as string, 'base64url');

/** Identifiant d'une clé (`signature.keyId`) : sha256 hexadécimal de ses 32 octets bruts ; c'est aussi son empreinte. */
export const keyId = (key: KeyObject): string => createHash('sha256').update(rawPublicKey(key)).digest('hex');

export const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Vérifie la signature d'un index (déjà lu en JSON) avec la clé attendue pour ce dépôt, puis son format. Lève une
 * `RepoError('signature')` si la signature est absente, faite par une autre clé ou invalide.
 */
export function verifyIndex(index: unknown, publicKey: KeyObject): RepoIndex {
  const sig = isObject(index) ? index.signature : undefined;
  if (!isObject(sig) || sig.algorithm !== 'ed25519' || typeof sig.value !== 'string')
    throw new RepoError('signature', 'Index non signé ou signature mal formée.');
  if (sig.keyId !== keyId(publicKey)) throw new RepoError('signature', `Index signé par une autre clé (${String(sig.keyId)}).`);
  let ok = false;
  try {
    ok = verify(null, signedBytes(index as object), publicKey, Buffer.from(sig.value, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new RepoError('signature', 'Signature de l’index invalide.');
  if ((index as { format?: unknown }).format !== INDEX_FORMAT)
    throw new RepoError('format', `Format d'index ${String((index as { format?: unknown }).format)} inconnu.`);
  return index as unknown as RepoIndex;
}

const isLocalized = (v: unknown): boolean => v === undefined || (isObject(v) && Object.values(v).every((s) => typeof s === 'string'));

/**
 * Vérifie la structure d'un index signé : champs, identifiants, versions, empreintes, adresses `https:`, tailles, et le
 * préfixe `mire.` refusé hors du dépôt officiel. Rend la liste des problèmes (vide : index utilisable).
 */
export function checkIndexContent(index: RepoIndex, { official = false } = {}): string[] {
  const errors: string[] = [];
  if (!Array.isArray(index.plugins)) return ['plugins : liste attendue.'];
  if (typeof index.generated !== 'string' || Number.isNaN(Date.parse(index.generated))) errors.push('generated : date ISO attendue.');
  if (!isObject(index.repository) || !isObject(index.repository.name) || typeof index.repository.name.en !== 'string')
    errors.push('repository.name.en attendu.');
  const ids = new Set<string>();
  for (const p of index.plugins) {
    if (!isObject(p) || typeof p.id !== 'string' || !PLUGIN_ID_RE.test(p.id)) {
      errors.push(`Identifiant invalide : ${String((p as { id?: unknown })?.id)}`);
      continue;
    }
    if (ids.has(p.id)) errors.push(`${p.id} : en double.`);
    ids.add(p.id);
    if (!official && p.id.startsWith(OFFICIAL_PREFIX)) errors.push(`${p.id} : préfixe « mire. » réservé au dépôt officiel.`);
    if (!Array.isArray(p.versions)) {
      errors.push(`${p.id} : versions attendues.`);
      continue;
    }
    const seen = new Set<string>();
    for (const v of p.versions as unknown[]) {
      const e = v as Partial<IndexVersion>;
      const where = `${p.id} ${String(e?.version)}`;
      if (!isObject(v) || !isVersion(e.version) || seen.has(e.version) || !isVersionRange(e.engines?.mire)) {
        errors.push(`${where} : version ou engines.mire invalide.`);
        continue;
      }
      seen.add(e.version);
      if (!PLUGIN_LEVELS.includes(e.level as PluginLevel)) errors.push(`${where} : niveau invalide.`);
      if (!Array.isArray(e.contributes) || !e.contributes.every((c) => typeof c === 'string')) errors.push(`${where} : contributes invalide.`);
      if (!isObject(e.permissions)) errors.push(`${where} : permissions invalides.`);
      if (!isObject(e.dependencies) || !Object.entries(e.dependencies).every(([d, r]) => PLUGIN_ID_RE.test(d) && isVersionRange(r)))
        errors.push(`${where} : dépendances invalides.`);
      if (!isLocalized(e.name) || !isLocalized(e.description)) errors.push(`${where} : textes invalides.`);
      if (!SHA256_RE.test(e.package?.sha256 ?? '')) errors.push(`${where} : empreinte sha256 invalide.`);
      if (!/^https:\/\//.test(e.package?.url ?? '')) errors.push(`${where} : adresse https attendue.`);
      if (!Number.isSafeInteger(e.package?.size) || e.package!.size <= 0) errors.push(`${where} : taille invalide.`);
    }
  }
  return errors;
}

/** Lit, vérifie (signature, structure) et rend un index à partir de ses octets. */
export function parseIndex(bytes: Uint8Array, publicKey: KeyObject, { official = false } = {}): RepoIndex {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RepoError('format', 'Index illisible (JSON invalide).');
  }
  const index = verifyIndex(json, publicKey);
  const errors = checkIndexContent(index, { official });
  if (errors.length) throw new RepoError('format', `Index mal formé : ${errors.slice(0, 5).join(' ; ')}`);
  return index;
}
