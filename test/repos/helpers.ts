// Dépôt de test local, de la même forme que celui de `mire-addons` : paquets `.tgz` (tar ustar déterministe, comme
// `scripts/lib/tar.mjs`), index signé par une paire de clés générée pour l'occasion, et un faux `fetch` qui les sert
// à des adresses `https:` (redirection comprise, comme les Releases GitHub).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { after } from 'node:test';
import { compareVersions, parseVersion } from '../../src/main/plugins/semver.ts';
import { keyId, sha256, signedBytes, type IndexVersion, type RepoIndex } from '../../src/main/repos/index-file.ts';

export function tempDir(prefix = 'mire-repos-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const keys = () => generateKeyPairSync('ed25519');
export const pem = (k: KeyObject) => k.export({ type: 'spki', format: 'pem' }).toString();

export interface TarEntry {
  path: string;
  data?: Buffer | string;
  /** Type ustar : '0' fichier, '2' lien symbolique, '5' dossier… */
  type?: string;
  link?: string;
}

const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, '0')}\0`;

function header({ path: name, data = '', type = '0', link = '' }: TarEntry): Buffer {
  const h = Buffer.alloc(512);
  const size = type === '0' ? Buffer.byteLength(data) : 0;
  h.write(name, 0, 100);
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(0, 12), 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(link, 157, 100);
  h.write('ustar\0', 257);
  h.write('00', 263);
  const sum = h.reduce((a, b) => a + b, 0);
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

/** `.tgz` des entrées données, sans aucun contrôle (pour fabriquer aussi des archives piégées). */
export function tgz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e));
    if ((e.type ?? '0') === '0') {
      const data = Buffer.from(e.data ?? '');
      parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  }
  parts.push(Buffer.alloc(1024));
  const gz = gzipSync(Buffer.concat(parts), { level: 9 });
  gz[9] = 255;
  return gz;
}

const catalog = (code: string, name: string, tags = false) =>
  JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name }, ...(tags ? { tags: { essai: 'Essai' } } : {}) } });

export interface PluginSpec {
  id: string;
  version: string;
  dependencies?: Record<string, string>;
  engines?: string;
  /** Change le manifeste écrit dans le paquet (pas l'index). */
  edit?: (m: Record<string, unknown>) => void;
  /** Entrées ajoutées au paquet. */
  extra?: TarEntry[];
  /** Paquet fourni tel quel (archive piégée). */
  bytes?: Buffer;
  /** Plugin de code (une contribution `taggers`) de ce niveau, avec ces permissions (P3-08). */
  level?: 'code' | 'privileged';
  permissions?: Record<string, unknown>;
  /** Catégories écrites dans l'index (P4-23), telles quelles. */
  categories?: unknown;
}

/** Fichiers d'un plugin de données valide (`packs`), comme `writePlugin` des tests de `mire-addons`. */
export function pluginEntries(spec: PluginSpec): TarEntry[] {
  const manifest: Record<string, unknown> = {
    id: spec.id,
    version: spec.version,
    engines: { mire: spec.engines ?? '^1.0.0' },
    level: 'data',
    contributes: { packs: [{ id: 'p', file: 'packs/p.json' }] },
    i18n: 'i18n/',
    ...(spec.dependencies ? { dependencies: spec.dependencies } : {}),
  };
  if (spec.level) {
    manifest.level = spec.level;
    manifest.contributes = { taggers: [{ id: 't', main: 't.js', tags: ['essai'] }] };
    if (spec.permissions) manifest.permissions = spec.permissions;
  }
  spec.edit?.(manifest);
  return [
    ...(spec.level ? [{ path: 't.js', data: 'export default () => ({ computeBatch: () => [] });' }] : []),
    { path: 'i18n/en.json', data: catalog('en', `Test ${spec.id}`, !!spec.level) },
    { path: 'i18n/fr.json', data: catalog('fr', `Essai ${spec.id}`, !!spec.level) },
    { path: 'mire-plugin.json', data: JSON.stringify(manifest) },
    { path: 'packs/p.json', data: JSON.stringify({ channels: [], sites: [], games: [] }) },
    ...(spec.extra ?? []),
  ];
}

export const BASE = 'https://github.com/o/r/releases/download';
export const INDEX_URL = `${BASE}/index/index.json`;

export interface TestRepo {
  /** Adresse de l'index. */
  indexUrl: string;
  publicKey: string;
  privateKey: KeyObject;
  /** Index signé (objet) et ses octets publiés. */
  index: RepoIndex;
  files: Map<string, Buffer>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Adresses demandées (dans l'ordre). */
  requests: string[];
  /** Coupe le réseau : chaque requête échoue. */
  offline: boolean;
  /** Republie l'index et les paquets. */
  publish(plugins: PluginSpec[], opts?: { generated?: string; sign?: KeyObject; alter?: (i: RepoIndex) => void }): void;
}

/** Signe un index (sans signature) avec une clé privée ed25519. */
export function signIndex(index: Omit<RepoIndex, 'signature'>, privateKey: KeyObject, publicKey: KeyObject): RepoIndex {
  const value = sign(null, signedBytes(index), privateKey).toString('base64');
  return { ...index, signature: { algorithm: 'ed25519', keyId: keyId(publicKey), value } };
}

/** Dépôt de test : paquets aux adresses `<BASE>/<id>@<version>/…` servis par une redirection vers `storage.example`. */
export function testRepo(plugins: PluginSpec[], { generated = '2026-11-19T12:00:00.000Z', base = BASE } = {}): TestRepo {
  const { privateKey, publicKey } = keys();
  const storage = base.replace('https://github.com/', 'https://storage.example/');
  const indexUrl = `${base}/index/index.json`;
  const repo: TestRepo = {
    indexUrl,
    publicKey: pem(publicKey),
    privateKey,
    index: null as unknown as RepoIndex,
    files: new Map(),
    requests: [],
    offline: false,
    fetch: async (url, init) => {
      repo.requests.push(url);
      if (repo.offline) throw new TypeError('fetch failed');
      if (init?.redirect !== 'manual') throw new Error('Les redirections doivent être suivies par le client.');
      if (url.startsWith(base)) return new Response(null, { status: 302, headers: { location: url.replace(base, storage) } });
      const data = repo.files.get(url.replace(storage, base));
      return data
        ? new Response(new Uint8Array(data), { status: 200, headers: { 'content-length': String(data.length) } })
        : new Response('absent', { status: 404 });
    },
    publish(list, { generated: g = generated, sign: signer = privateKey, alter } = {}) {
      repo.files.clear();
      const byId = new Map<string, IndexVersion[]>();
      for (const spec of list) {
        const bytes = spec.bytes ?? tgz(pluginEntries(spec));
        const url = `${base}/${spec.id}%40${spec.version}/${spec.id}-${spec.version}.tgz`;
        repo.files.set(url, bytes);
        const v: IndexVersion = {
          version: spec.version,
          engines: { mire: spec.engines ?? '^1.0.0' },
          level: spec.level ?? 'data',
          contributes: spec.level ? ['taggers'] : ['packs'],
          permissions: spec.level ? (spec.permissions ?? {}) : {},
          dependencies: spec.dependencies ?? {},
          name: { en: `Test ${spec.id}`, fr: `Essai ${spec.id}` },
          ...(spec.categories !== undefined ? { categories: spec.categories } : {}),
          package: { url, sha256: sha256(bytes), size: bytes.length },
        };
        byId.set(spec.id, [v, ...(byId.get(spec.id) ?? [])]);
      }
      const index = {
        format: 1,
        repository: { name: { en: 'Test repository', fr: 'Dépôt de test' }, source: 'https://github.com/o/r', index: indexUrl },
        generated: g,
        plugins: [...byId.keys()]
          .sort()
          .map((id) => ({ id, versions: byId.get(id)!.sort((a, b) => compareVersions(parseVersion(b.version)!, parseVersion(a.version)!)) })),
      };
      const signed = signIndex(index, signer, publicKey);
      alter?.(signed);
      repo.index = signed;
      repo.files.set(indexUrl, Buffer.from(JSON.stringify(signed, null, 2)));
    },
  };
  repo.publish(plugins);
  return repo;
}
