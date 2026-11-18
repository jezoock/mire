/**
 * Protocole `mire-plugin://` (ADR 0002) : sert, en lecture seule, la page de l'hôte isolé (`mire-plugin://host/…`,
 * trois fichiers nommés) et les fichiers des plugins de cet hôte (`mire-plugin://<id>/…`), limités à leur dossier.
 * Installé uniquement sur la session de chaque hôte, jamais sur celle de la fenêtre principale ni des vues web.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_SCHEME = 'mire-plugin';
/** Nom d'hôte de la page de l'hôte isolé (un identifiant de plugin a toujours un point : pas de collision). */
export const HOST_ORIGIN_NAME = 'host';
export const HOST_ORIGIN = `${PLUGIN_SCHEME}://${HOST_ORIGIN_NAME}`;

/**
 * Privilèges, enregistrés avant `ready` : origine standard et sûre, `fetch` et CORS (les modules des plugins sont
 * importés depuis l'origine de l'hôte). Rien d'autre : ni `bypassCSP`, ni `allowServiceWorkers`, ni `stream`.
 */
export const PLUGIN_SCHEME_PRIVILEGES = { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } };

/**
 * CSP de la page de l'hôte et de ses Workers : rien par défaut ; scripts, modules, Workers et `fetch` seulement depuis
 * `mire-plugin:` (la session refuse de toute façon le reste : couche de plus).
 */
export const HOST_CSP = "default-src 'none'; script-src mire-plugin:; worker-src mire-plugin:; connect-src mire-plugin:; base-uri 'none'; form-action 'none'";

/** Fichiers de la page de l'hôte, servis depuis `dist/plugin-host/`. */
export const HOST_FILES: Readonly<Record<string, string>> = { '/index.html': 'index.html', '/page.js': 'page.js', '/worker.js': 'worker.js' };

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export type PluginRequestResult = { ok: true; file: string; headers: Record<string, string> } | { ok: false; status: number };

export interface PluginRequestOptions {
  /** `dist/plugin-host/` */
  hostDir: string;
  /** Dossier réel d'un plugin de cet hôte, ou `null`. */
  pluginDir(id: string): string | null;
}

/** Fichier à servir pour une requête, ou le statut du refus. */
export function resolvePluginRequest(method: string, url: string, { hostDir, pluginDir }: PluginRequestOptions): PluginRequestResult {
  if (method !== 'GET') return { ok: false, status: 405 };
  let u: URL;
  let rel: string;
  try {
    u = new URL(url);
    rel = decodeURIComponent(u.pathname);
  } catch {
    return { ok: false, status: 400 };
  }
  if (u.protocol !== `${PLUGIN_SCHEME}:`) return { ok: false, status: 400 };
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return { ok: false, status: 403 };
  const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
  if (u.hostname === HOST_ORIGIN_NAME) {
    if (!Object.hasOwn(HOST_FILES, rel)) return { ok: false, status: 404 };
    const file = path.join(hostDir, HOST_FILES[rel]);
    headers['content-type'] = MIME[path.extname(file)];
    headers['content-security-policy'] = HOST_CSP;
    return { ok: true, file, headers };
  }
  const root = pluginDir(u.hostname);
  if (!root) return { ok: false, status: 404 };
  let file: string;
  try {
    file = fs.realpathSync(path.join(root, rel));
  } catch {
    return { ok: false, status: 404 };
  }
  // Le chemin réel (liens résolus) doit rester dans le dossier du plugin.
  if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) return { ok: false, status: 403 };
  headers['content-type'] = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  // Modules importés par le Worker du plugin, dont l'origine est celle de la page de l'hôte.
  headers['access-control-allow-origin'] = HOST_ORIGIN;
  return { ok: true, file, headers };
}

/** Gestionnaire pour `session.protocol.handle` d'une session d'hôte. */
export function pluginProtocolHandler(options: PluginRequestOptions) {
  return async (req: { method: string; url: string }): Promise<Response> => {
    const r = resolvePluginRequest(req.method, req.url, options);
    if (!r.ok) return new Response(null, { status: r.status });
    const body = await fs.promises.readFile(r.file).catch(() => null);
    return body ? new Response(body, { headers: r.headers }) : new Response(null, { status: 404 });
  };
}
