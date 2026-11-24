// Contexte de plugin simulé (forme de `PluginContext` du SDK) : réponses HTTP enregistrées par adresse, stockage en
// mémoire, sans réseau.
import { readFileSync } from 'node:fs';

/** Réponses enregistrées de `test/fixtures/<nom>.json` (reprises de Mire) : adresse → `{ json | text | image, status? }`. */
export const loadRoutes = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Stockage du plugin en mémoire ; `full` refuse toute écriture (stockage plein). */
export function memoryStorage({ full = false } = {}) {
  const values = new Map();
  return {
    values,
    get: async (k) => structuredClone(values.get(k)),
    set: async (k, v) => {
      if (full) throw new Error('Plugin storage is limited to 8388608 bytes.');
      values.set(k, structuredClone(v));
    },
    delete: async (k) => void values.delete(k),
    keys: async () => [...values.keys()],
  };
}

/**
 * Contexte : `routes` (adresse exacte → réponse enregistrée, `{ unreachable: true }`), requêtes notées (adresse,
 * méthode, en-têtes). Une adresse absente répond 404.
 */
export function fakeContext({ routes = {}, locale = 'fr', storage = memoryStorage() } = {}) {
  const calls = [];
  const logs = [];
  const ctx = {
    id: 'mire.libretro',
    version: '1.0.0',
    locale,
    http: {
      async request(url, options = {}) {
        calls.push({ url, method: options.method ?? 'GET', headers: { ...(options.headers ?? {}) } });
        const reply = routes[url];
        if (reply?.unreachable) throw new Error(`thumbnails.libretro.com could not be resolved (${url})`);
        if (!reply) return { status: 404, headers: { 'content-type': 'text/plain' }, text: 'introuvable' };
        const type = reply.image ? reply.image : reply.json !== undefined ? 'application/json' : 'text/plain';
        const text = reply.image ? '' : (reply.text ?? JSON.stringify(reply.json ?? {}));
        return { status: reply.status ?? 200, headers: { 'content-type': type }, text };
      },
    },
    settings: { get: () => undefined, onChange: () => () => {} },
    log: {
      info: (...a) => logs.push(a),
      warn: (...a) => logs.push(a),
      error: (...a) => logs.push(a),
    },
    events: { on: () => () => {} },
    storage,
    files: {},
  };
  return { ctx, calls, logs, storage };
}
