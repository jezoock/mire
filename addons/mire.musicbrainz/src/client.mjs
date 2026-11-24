/**
 * Accès à MusicBrainz et à Cover Art Archive par le client HTTP du contexte (seuls les hôtes déclarés sont
 * joignables). Règle de MusicBrainz : une requête par seconde au plus, d'où le limiteur. Les erreurs rendues sont des
 * textes du plugin (`MusicBrainzFailure`), jamais celles du client HTTP (techniques, en anglais).
 */

/** Intervalle minimal entre deux requêtes à MusicBrainz (une par seconde, avec une marge). */
export const INTERVAL_MS = 1100;
const TIMEOUT = 12000;

/** Échec attendu (MusicBrainz injoignable, code d'erreur) : `message` est un texte pour l'utilisateur. */
export class MusicBrainzFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'MusicBrainzFailure';
  }
}

/**
 * Limiteur : les appels de `run` partent l'un après l'autre, espacés d'au moins `intervalMs`, même lancés ensemble.
 * `now` et `sleep` sont remplaçables (tests : une horloge simulée, sans minuterie réelle).
 */
export function createLimiter(intervalMs, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let next = -Infinity;
  let queue = Promise.resolve();
  return function run(fn) {
    const turn = queue.then(async () => {
      const wait = next - now();
      if (wait > 0) await sleep(wait);
      next = now() + intervalMs;
    });
    // Un appel en échec ne bloque pas les suivants.
    queue = turn.catch(() => {});
    return turn.then(fn);
  };
}

/** Client d'un plugin : `getJson` (limité), `isImage` (pochette disponible). */
export function createClient(ctx, t, { intervalMs = INTERVAL_MS, now, sleep } = {}) {
  const limit = createLimiter(intervalMs, { now, sleep });

  async function request(url, method) {
    try {
      return await ctx.http.request(url, { method, headers: method === 'GET' ? { accept: 'application/json' } : {}, timeout: TIMEOUT });
    } catch {
      throw new MusicBrainzFailure(t('unreachable'));
    }
  }

  return {
    /** JSON d'une adresse de MusicBrainz ; `null` pour 404. Lève `MusicBrainzFailure` sinon. */
    async getJson(url) {
      const res = await limit(() => request(url, 'GET'));
      if (res.status === 404) return null;
      if (res.status < 200 || res.status > 299) throw new MusicBrainzFailure(t('status', { status: res.status }));
      try {
        return JSON.parse(res.text);
      } catch {
        throw new MusicBrainzFailure(t('unreachable'));
      }
    },
    /** Vrai si l'adresse mène à une image (Cover Art Archive : sans limite de débit). */
    async isImage(url) {
      const res = await request(url, 'HEAD');
      const type = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      return res.status >= 200 && res.status <= 299 && String(type).startsWith('image/');
    },
  };
}

/** Exécute `run` ; un échec attendu devient `{ failure }` (le contrat de Mire), le reste est relancé. */
export async function orFailure(run) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MusicBrainzFailure) return { failure: err.message };
    throw err;
  }
}
