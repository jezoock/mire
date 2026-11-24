/**
 * Contexte d'un plugin, côté processus principal (P3-04) : ce que son runtime relaie par **son** port (cible `ctx`).
 * Le plugin est celui auquel le port a été attribué (`forPlugin`), jamais celui qu'un message prétendrait être ; ses
 * permissions s'appliquent ici, aucune n'est laissée à l'hôte (ADR 0002, « Pour P3-04 »).
 *
 * - `http.*` : client HTTP du cœur (`net/http.ts`) ; tout hôte absent de `permissions.hosts` est refusé, à chaque
 *   redirection comme à la première adresse ; le réseau local et les adresses IP demandent `localNetwork`.
 * - `files.*` : dossiers accordés par l'utilisateur à ce plugin seulement (`requestFolder`), vérifiés par la
 *   politique d'accès (`security/access-policy.ts`, une instance par plugin : celle de l'interface n'est jamais
 *   élargie), puis une seconde fois sur le chemin réel (liens symboliques). `walk` parcourt ici, sans suivre les liens.
 * - `storage.*` : `userData/plugin-data/<id>/storage.json` (`plugin-storage.ts`).
 *
 * Bornes (ADR 0002) : `LIMITS`. Les erreurs rendues au plugin sont des diagnostics techniques en anglais, comme ceux du
 * canal ; aucune ne reprend un en-tête, un corps ou un réglage (rien de secret n'en sort).
 */
import dns from 'node:dns';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry, HttpRequestOptions, HttpResponse, WalkOptions } from '@mire/plugin-sdk';
import { HttpError, request, type FetchLike } from '../net/http.ts';
import { createAccessPolicy } from '../security/access-policy.ts';
import { CHANNEL_ERRORS, ChannelError } from './channel.ts';
import { grantedPermissions, isLocalHost, urlRefusal, type Granted } from './permissions.ts';
import type { PluginStorage } from './plugin-storage.ts';

/** Bornes du contexte, par plugin. */
export const LIMITS = Object.freeze({
  /** Taille d'une requête du plugin (arguments en JSON) : 1 Mio. */
  message: 1024 * 1024,
  /** Corps d'une réponse HTTP ou fichier lu, relayés au plugin : 8 Mio. */
  response: 8 * 1024 * 1024,
  /** Requêtes du contexte en cours en même temps ; les suivantes attendent leur tour. */
  running: 8,
  /** Requêtes en attente au-delà desquelles le contexte refuse (`busy`). */
  waiting: 64,
  /** Délai d'une requête HTTP : 15 s par défaut, 60 s au plus. */
  httpTimeout: 15000,
  httpTimeoutMax: 60000,
  redirects: 5,
  headers: 64,
  /** Fichiers rendus par `walk` : 10 000 par défaut, 150 000 au plus (le nombre maximal d'éléments de la bibliothèque). */
  walkDefault: 10000,
  walkMax: 150000,
  /** Texte du motif d'une demande de dossier. */
  purpose: 200,
});

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface ContextDeps {
  /** fetch utilisé par le client HTTP (tests) ; par défaut le fetch global. */
  fetch?: FetchLike;
  /** Résolution d'un nom (tests) ; par défaut `dns.lookup(host, { all: true })`. */
  lookup?: (host: string) => Promise<{ address: string }[]>;
  /** Demande un dossier à l'utilisateur pour ce plugin ; `null` s'il refuse. */
  pickFolder(pluginId: string, purpose: string): Promise<string | null>;
  /** Dossiers accordés à chaque plugin, mémorisés. */
  folders: { list(pluginId: string): string[]; add(pluginId: string, dir: string): void };
  storage(pluginId: string): PluginStorage;
  platform?: NodeJS.Platform;
}

export interface PluginIdentity {
  id: string;
  manifest: Parameters<typeof grantedPermissions>[0];
}

const refused = (message: string) => new ChannelError(CHANNEL_ERRORS.refused, message);
const tooLarge = (what: string, max: number) => new ChannelError(CHANNEL_ERRORS.tooLarge, `${what} is larger than ${max} bytes.`);

/** Taille d'une requête du plugin, en JSON ; ce qui ne s'écrit pas en JSON est refusé. */
function sizeOf(args: unknown[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(args) ?? '');
  } catch {
    throw new ChannelError(CHANNEL_ERRORS.plugin, 'Arguments must be plain data.');
  }
}

/** File d'attente par plugin : `LIMITS.running` en cours, `LIMITS.waiting` en attente, au-delà `busy`. */
function createLimiter(running = LIMITS.running, waiting = LIMITS.waiting) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (active >= running) {
      if (queue.length >= waiting) throw new ChannelError(CHANNEL_ERRORS.busy, `Too many context requests (${running} running, ${waiting} waiting).`);
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      if (signal.aborted) throw new ChannelError(CHANNEL_ERRORS.cancelled, 'Request cancelled.');
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new ChannelError(CHANNEL_ERRORS.plugin, `${what}: a non-empty string is expected.`);
  return v;
};

/** Lit un corps de réponse sans dépasser `max` octets. */
async function readLimited(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge('Response body', max);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge('Response body', max);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function httpOptions(raw: unknown): { method: string; headers: Record<string, string>; body?: string; timeout: number } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as HttpRequestOptions;
  const method = String(o.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new ChannelError(CHANNEL_ERRORS.plugin, `Unknown HTTP method: ${method}.`);
  const headers: Record<string, string> = {};
  const given = o.headers && typeof o.headers === 'object' ? Object.entries(o.headers) : [];
  if (given.length > LIMITS.headers) throw new ChannelError(CHANNEL_ERRORS.plugin, `At most ${LIMITS.headers} headers.`);
  for (const [k, v] of given) if (typeof v === 'string') headers[k.toLowerCase()] = v;
  // L'identité de Mire est celle du client du cœur ; ni cookies, ni hôte forcé.
  for (const k of ['host', 'cookie', 'user-agent']) delete headers[k];
  let body: string | undefined;
  if (o.body !== undefined && o.body !== null) {
    if (typeof o.body === 'string') body = o.body;
    else {
      body = JSON.stringify(o.body);
      headers['content-type'] ??= 'application/json';
    }
  }
  const t = Number(o.timeout);
  const timeout = Number.isFinite(t) && t > 0 ? Math.min(t, LIMITS.httpTimeoutMax) : LIMITS.httpTimeout;
  return { method, headers, body, timeout };
}

const responseHeaders = (res: Response): Record<string, string> => {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (k !== 'set-cookie') out[k] = v;
  });
  return out;
};

const httpFailure = (err: unknown): unknown =>
  err instanceof HttpError
    ? new ChannelError(CHANNEL_ERRORS.http, err.message)
    : err instanceof ChannelError
      ? err
      : new ChannelError(CHANNEL_ERRORS.http, 'HTTP request failed.');

/** Contexte d'un plugin : permissions, dossiers, stockage et file d'attente à lui. */
export function createContextHandler(deps: ContextDeps) {
  const platform = deps.platform ?? process.platform;

  return function forPlugin(plugin: PluginIdentity) {
    const id = plugin.id;
    const granted: Granted = grantedPermissions(plugin.manifest);
    const limit = createLimiter();
    // Politique d'accès propre au plugin : ses dossiers accordés, rien d'autre.
    const policy = createAccessPolicy({ roots: () => deps.folders.list(id), platform });
    const grants = () => deps.folders.list(id);

    // -----------------------------------------------------------------------------------------------------------
    // http

    /**
     * Un hôte déclaré ne doit pas mener au réseau local : son nom est résolu et la requête refusée si l'une des
     * adresses est locale (un nom public peut pointer vers 192.168.1.1 ou 127.0.0.1). Reste un changement d'adresse
     * entre cette résolution et la connexion (TTL nul) : le fermer demanderait de fixer l'adresse résolue (P3-08).
     */
    async function checkResolved(host: string): Promise<void> {
      let addresses: { address: string }[];
      try {
        addresses = await (deps.lookup ?? ((h: string) => dns.promises.lookup(h, { all: true })))(host);
      } catch {
        throw new ChannelError(CHANNEL_ERRORS.http, `${host} could not be resolved.`);
      }
      if (addresses.some((a) => isLocalHost(a.address)))
        throw refused(`${host} leads to the local network: the "localNetwork" permission is needed (privileged plugins only).`);
    }

    async function fetchChecked(url: string, raw: unknown, signal: AbortSignal): Promise<{ res: Response; url: string }> {
      let target: URL;
      try {
        target = new URL(str(url, 'url'));
      } catch (err) {
        throw err instanceof ChannelError ? err : new ChannelError(CHANNEL_ERRORS.plugin, 'Invalid address.');
      }
      const o = httpOptions(raw);
      let { method, body } = o;
      for (let hop = 0; ; hop++) {
        const why = urlRefusal(granted, target);
        if (why) throw refused(why);
        if (!granted.localNetwork) await checkResolved(target.hostname);
        const res = await request(target.href, { method, headers: o.headers, body, timeout: o.timeout, signal, redirect: 'manual', fetch: deps.fetch }).catch(
          (err) => {
            throw httpFailure(err);
          },
        );
        const location = res.headers.get('location');
        if (!REDIRECTS.has(res.status) || !location) return { res, url: target.href };
        await res.body?.cancel().catch(() => {});
        if (hop >= LIMITS.redirects) throw new ChannelError(CHANNEL_ERRORS.http, `More than ${LIMITS.redirects} redirects.`);
        target = new URL(location, target);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
          body = undefined;
        }
      }
    }

    async function httpRequest(url: string, raw: unknown, signal: AbortSignal): Promise<HttpResponse> {
      const { res } = await fetchChecked(url, raw, signal);
      const text = (await readLimited(res, LIMITS.response).catch((e) => Promise.reject(httpFailure(e)))).toString('utf8');
      return { status: res.status, headers: responseHeaders(res), text };
    }

    async function httpBody(url: string, raw: unknown, signal: AbortSignal): Promise<string | null> {
      const r = await httpRequest(url, raw, signal);
      if (r.status === 404) return null;
      if (r.status < 200 || r.status > 299) throw new ChannelError(CHANNEL_ERRORS.http, `${new URL(url).hostname} answered with status ${r.status}.`);
      return r.text;
    }

    // -----------------------------------------------------------------------------------------------------------
    // files

    function needFolders(): void {
      if (!granted.folders) throw refused('The "folders" permission is not declared.');
    }

    /** Chemin sous un dossier accordé, vérifié aussi une fois les liens résolus ; `null` s'il n'existe pas. */
    async function checkedPath(p: unknown): Promise<string | null> {
      needFolders();
      const file = str(p, 'path');
      if (!path.isAbsolute(file)) throw refused(`${file}: an absolute path is expected.`);
      const roots = grants();
      const under = (f: string, list: string[]) => list.some((r) => policy.isInside(f, [r]) || path.resolve(f) === path.resolve(r));
      if (!under(file, roots)) throw refused('This folder has not been granted to the plugin.');
      let real: string;
      try {
        real = await fsp.realpath(file);
      } catch {
        return null;
      }
      const realRoots = await Promise.all(roots.map((r) => fsp.realpath(r).catch(() => r)));
      if (!under(real, realRoots)) throw refused('This path leads outside the granted folders.');
      return real;
    }

    async function readFile(p: unknown): Promise<Buffer> {
      const real = await checkedPath(p);
      if (!real) throw new ChannelError(CHANNEL_ERRORS.io, 'File not found.');
      const st = await fsp.stat(real);
      if (!st.isFile()) throw new ChannelError(CHANNEL_ERRORS.io, 'Not a file.');
      if (st.size > LIMITS.response) throw tooLarge('File', LIMITS.response);
      return fsp.readFile(real);
    }

    async function walk(rootArg: unknown, raw: unknown, signal: AbortSignal): Promise<FileEntry[]> {
      const root = await checkedPath(rootArg);
      if (!root) throw new ChannelError(CHANNEL_ERRORS.io, 'Folder not found.');
      const o = (raw && typeof raw === 'object' ? raw : {}) as WalkOptions;
      const exts = Array.isArray(o.extensions) ? new Set(o.extensions.map((e) => `.${String(e).toLowerCase().replace(/^\./, '')}`)) : null;
      const depth = Number.isInteger(o.depth) && o.depth! >= 0 ? o.depth! : Infinity;
      const max = Number.isInteger(o.limit) && o.limit! > 0 ? Math.min(o.limit!, LIMITS.walkMax) : LIMITS.walkDefault;
      // Même règle que la bibliothèque (`walkLibrary`) : dossiers cachés et système, fichiers cachés.
      const hidden = o.skipHidden === true;
      const out: FileEntry[] = [];
      const stack: Array<{ dir: string; level: number }> = [{ dir: root, level: 0 }];
      while (stack.length && out.length < max) {
        if (signal.aborted) throw new ChannelError(CHANNEL_ERRORS.cancelled, 'Walk cancelled.');
        const { dir, level } = stack.pop()!;
        let entries: fs.Dirent[];
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const d of entries) {
          if (out.length >= max) break;
          const full = path.join(dir, d.name);
          // Les liens ne sont pas suivis : ils pourraient mener hors des dossiers accordés.
          if (d.isDirectory()) {
            if (level < depth && !(hidden && (d.name.startsWith('.') || d.name.startsWith('$')))) stack.push({ dir: full, level: level + 1 });
          } else if (d.isFile() && !(hidden && d.name.startsWith('.')) && (!exts || exts.has(path.extname(d.name).toLowerCase()))) {
            const st = await fsp.stat(full).catch(() => null);
            if (st) out.push({ path: full, size: st.size, modified: st.mtimeMs });
          }
        }
      }
      return out;
    }

    async function requestFolder(purpose: unknown): Promise<string | null> {
      needFolders();
      const text = String(purpose ?? '').slice(0, LIMITS.purpose);
      const dir = await deps.pickFolder(id, text);
      if (!dir) return null;
      deps.folders.add(id, dir);
      policy.invalidate();
      return dir;
    }

    // -----------------------------------------------------------------------------------------------------------

    const storage = () => deps.storage(id);
    const METHODS_TABLE: Record<string, (args: unknown[], signal: AbortSignal) => Promise<unknown>> = {
      'http.request': ([url, o], s) => httpRequest(url as string, o, s),
      'http.getText': ([url, o], s) => httpBody(url as string, o, s),
      'http.getJson': async ([url, o], s) => {
        const opts = { ...((o && typeof o === 'object' ? o : {}) as object) } as HttpRequestOptions;
        opts.headers = { accept: 'application/json', ...(opts.headers ?? {}) };
        const text = await httpBody(url as string, opts, s);
        if (text === null) return null;
        try {
          return JSON.parse(text);
        } catch {
          throw new ChannelError(CHANNEL_ERRORS.http, 'The answer is not valid JSON.');
        }
      },
      'files.requestFolder': ([purpose]) => requestFolder(purpose),
      'files.readText': async ([p]) => (await readFile(p)).toString('utf8'),
      'files.readBytes': async ([p]) => new Uint8Array(await readFile(p)),
      'files.exists': async ([p]) => (await checkedPath(p)) !== null,
      'files.walk': ([root, o], s) => walk(root, o, s),
      'storage.get': async ([key]) => storage().get(key),
      'storage.set': async ([key, value]) => storage().set(key, value),
      'storage.delete': async ([key]) => storage().delete(key),
      'storage.keys': async () => storage().keys(),
    };

    return {
      /** Requête `ctx.<méthode>` reçue sur le port de ce plugin. */
      handle(method: string, args: unknown[], signal: AbortSignal): Promise<unknown> {
        const f = Object.hasOwn(METHODS_TABLE, method) ? METHODS_TABLE[method] : null;
        if (!f) return Promise.reject(new ChannelError(CHANNEL_ERRORS.notFound, `ctx.${method}`));
        if (sizeOf(args) > LIMITS.message) return Promise.reject(tooLarge('Request', LIMITS.message));
        return limit(() => f(args, signal), signal);
      },
      granted,
    };
  };
}

export type ContextHandler = ReturnType<ReturnType<typeof createContextHandler>>;
