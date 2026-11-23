/**
 * Recherche « Où regarder » : films et séries trouvés par un plugin (contribution `search`, comme `mire.tmdb`,
 * P5-15), avec les services qui les proposent, rapprochés ici des sites de streaming configurés. Le cœur ne connaît
 * aucun catalogue : il lit la réponse du plugin (forme ci-dessous), la vérifie, et y ajoute le site de chaque service.
 *
 * Réponse attendue d'un plugin : `{ ok: true, results: [{ key, title, year, type, poster, providers: [{ name }] }],
 * attribution }`, ou `{ ok: false, message, setup? }` (`setup` : clé du réglage du plugin à remplir, une clé d'API
 * par exemple). Les textes sont ceux du plugin, montrés comme du texte ; une affiche n'est gardée qu'en `https:`.
 */
import { fold, type WebSite } from '@mire/shared';
import { providerMatches } from '../lib/text.ts';

/** Service qui propose un titre ; `webId` : site configuré correspondant, s'il y en a un. */
export interface StreamingOffer {
  name: string;
  webId: string | null;
}

export interface StreamingResult {
  key: string;
  title: string;
  year: string;
  type: 'movie' | 'tv';
  poster: string | null;
  providers: StreamingOffer[];
}

export type StreamingSearch =
  | { ok: true; plugin: string; results: StreamingResult[]; attribution: string }
  | { ok: false; reason: 'noprovider' }
  | { ok: false; plugin: string; error: string; setup?: string };

/** Bornes d'une réponse. */
export const WATCH_LIMITS = Object.freeze({ results: 50, providers: 50, text: 300, message: 500 });

const SETTING_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Site configuré correspondant à un service, par son nom ou ses `providers` (« =nom » : nom exact). */
export function sourceForProvider(providerName: string, sites: readonly WebSite[]): WebSite | null {
  const p = fold(providerName).trim();
  return (
    sites.find((w) => {
      const names = [w.name, ...(Array.isArray(w.providers) ? w.providers : [])].map((n) => fold(n).trim()).filter(Boolean);
      return names.some((n) => providerMatches(p, n));
    }) || null
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const line = (v: unknown, max: number = WATCH_LIMITS.text): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const https = (v: unknown): string | null => (typeof v === 'string' && v.length <= 2048 && /^https:\/\/[^\s]+$/i.test(v) ? v : null);

/** Services d'un titre, sans doublon, les sites configurés en tête. */
function offersOf(raw: unknown, sites: readonly WebSite[]): StreamingOffer[] {
  const seen = new Set<string>();
  const out: StreamingOffer[] = [];
  for (const o of Array.isArray(raw) ? raw.slice(0, WATCH_LIMITS.providers) : []) {
    const name = isObject(o) ? line(o.name) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, webId: sourceForProvider(name, sites)?.id ?? null });
  }
  return out.sort((a, b) => Number(!!b.webId) - Number(!!a.webId));
}

function resultOf(raw: unknown, sites: readonly WebSite[]): StreamingResult | null {
  if (!isObject(raw)) return null;
  const key = line(raw.key);
  const title = line(raw.title);
  if (!key || !title) return null;
  return {
    key,
    title,
    year: line(raw.year, 10),
    type: raw.type === 'tv' ? 'tv' : 'movie',
    poster: https(raw.poster),
    providers: offersOf(raw.providers, sites),
  };
}

/** Réponse d'un plugin lue comme une recherche « Où regarder » ; `null` si elle n'en a pas la forme. */
export function readWatch(plugin: string, raw: unknown, sites: readonly WebSite[]): StreamingSearch | null {
  if (!isObject(raw)) return null;
  if (raw.ok === true && Array.isArray(raw.results)) {
    const results = raw.results
      .slice(0, WATCH_LIMITS.results)
      .map((r) => resultOf(r, sites))
      .filter((r): r is StreamingResult => !!r);
    return { ok: true, plugin, results, attribution: line(raw.attribution) };
  }
  if (raw.ok === false) {
    const setup = typeof raw.setup === 'string' && SETTING_KEY_RE.test(raw.setup) ? raw.setup : undefined;
    return { ok: false, plugin, error: line(raw.message, WATCH_LIMITS.message), ...(setup ? { setup } : {}) };
  }
  return null;
}

export interface WatchSearchDeps {
  /** Recherche des plugins actifs (ponts des plugins). */
  search(query: string): Promise<{ pluginId: string; id: string; result: unknown }[]>;
  /** Sites de streaming configurés. */
  sites(): readonly WebSite[];
}

/** « Où regarder » : la première réponse d'un plugin qui a la forme attendue ; `noprovider` s'il n'y en a aucune. */
export function createWatchSearch({ search, sites }: WatchSearchDeps) {
  return async (query: unknown): Promise<StreamingSearch> => {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return { ok: true, plugin: '', results: [], attribution: '' };
    const answers = await search(q);
    const configured = sites();
    for (const a of answers) {
      const read = readWatch(a.pluginId, a.result, configured);
      if (read) return read;
    }
    return { ok: false, reason: 'noprovider' };
  };
}
