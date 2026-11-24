// Contexte de plugin simulé (forme de `PluginContext` du SDK) : réponses HTTP enregistrées par adresse, sans réseau.
import { readFileSync } from 'node:fs';

/** Réponses enregistrées de `test/fixtures/<nom>.json` (reprises de Mire) : adresse → `{ json | text | image, status? }`. */
export const loadRoutes = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/**
 * Contexte : `routes` (adresse exacte → réponse enregistrée, `{ unreachable: true }`, ou une fonction), journal et
 * requêtes notés. Une adresse absente répond 404 ; une image répond avec son type (`image/jpeg` par défaut).
 */
export function fakeContext({ routes = {}, locale = 'fr' } = {}) {
  const calls = [];
  const logs = [];
  const ctx = {
    id: 'mire.musicbrainz',
    version: '1.0.0',
    locale,
    http: {
      async request(url, options = {}) {
        calls.push({ url, method: options.method ?? 'GET', timeout: options.timeout });
        const route = routes[url];
        const reply = typeof route === 'function' ? route(url) : route;
        // Message technique du client HTTP de Mire, qui ne doit jamais remonter tel quel.
        if (reply?.unreachable) throw new Error(`musicbrainz.org could not be resolved (${url})`);
        if (!reply) return { status: 404, headers: { 'content-type': 'text/plain' }, text: 'introuvable' };
        const type = reply.image ? reply.image : reply.json !== undefined ? 'application/json' : 'text/plain';
        const text = reply.image ? '' : (reply.text ?? JSON.stringify(reply.json ?? {}));
        return { status: reply.status ?? 200, headers: { 'content-type': type }, text };
      },
      getJson: async () => {
        throw new Error('not used');
      },
      getText: async () => {
        throw new Error('not used');
      },
    },
    settings: { get: () => undefined, onChange: () => () => {} },
    log: {
      info: (...a) => logs.push(a),
      warn: (...a) => logs.push(a),
      error: (...a) => logs.push(a),
    },
    events: { on: () => () => {} },
    storage: {},
    files: {},
  };
  return { ctx, calls, logs };
}

/** Horloge simulée : `sleep` fait avancer le temps sans attendre (aucune minuterie réelle). */
export function fakeClock(start = 1_000_000) {
  let time = start;
  return { now: () => time, sleep: async (ms) => void (time += ms) };
}
