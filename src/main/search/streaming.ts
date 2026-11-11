/**
 * Recherche « où regarder » : titres trouvés sur TMDB (films et séries) avec les services qui les proposent dans
 * la région choisie (données JustWatch, servies par TMDB), rapprochés des sites de streaming configurés.
 */
import { fold, type Config, type WebSite } from '@mire/shared';
import { HttpError } from '../net/http.ts';
import { tmdbImageUrl, type TmdbClient, type TmdbParams } from '../net/tmdb.ts';
import { providerMatches } from '../lib/text.js';

/** Ce que l'appelant prête à un fournisseur de recherche. */
export interface SearchContext {
  getConfig(): Pick<Config, 'search' | 'web'>;
}

/** Fournisseur de recherche : interroge un catalogue et rend ses résultats. */
export interface SearchProvider<R> {
  id: string;
  search(query: string, ctx: SearchContext): Promise<R>;
}

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

export type StreamingSearch = { ok: true; results: StreamingResult[] } | { ok: false; reason: 'nokey' };

const TIMEOUT = 9000;
const MAX_RESULTS = 12;

// Les erreurs du client HTTP reprennent les messages propres à cette recherche.
function tmdbError(err: unknown): unknown {
  if (!(err instanceof HttpError)) return err;
  if (err.kind !== 'status') return new Error('Le catalogue TMDB est injoignable. Vérifiez la connexion Internet.');
  if (err.status === 401) return new Error('Clé TMDB refusée. Vérifiez-la dans Réglages.');
  return new Error(`TMDB a répondu avec le code ${err.status}.`);
}

/** Site configuré correspondant à un service TMDB, par son nom ou ses `providers` (« =nom » : nom exact). */
export function sourceForProvider(providerName: string, sites: WebSite[]): WebSite | null {
  const p = fold(providerName).trim();
  return (
    sites.find((w) => {
      const names = [w.name, ...(Array.isArray(w.providers) ? w.providers : [])].map((n) => fold(n).trim()).filter(Boolean);
      return names.some((n) => providerMatches(p, n));
    }) || null
  );
}

// Services d'un titre (abonnement, gratuit, avec publicité), sans doublon, les sites configurés en tête.
function offersOf(offers: any, sites: WebSite[]): StreamingOffer[] {
  const seen = new Set<number>();
  const providers: StreamingOffer[] = [];
  for (const o of [...(offers?.flatrate || []), ...(offers?.free || []), ...(offers?.ads || [])]) {
    if (seen.has(o.provider_id)) continue;
    seen.add(o.provider_id);
    const src = sourceForProvider(o.provider_name, sites);
    providers.push({ name: o.provider_name, webId: src ? src.id : null });
  }
  return providers.sort((a, b) => Number(!!b.webId) - Number(!!a.webId));
}

export function streamingSearchProvider(client: TmdbClient): SearchProvider<StreamingSearch> {
  const tmdb = (pathname: string, params: TmdbParams = {}) => client.get(pathname, params, { timeout: TIMEOUT }).catch((err) => Promise.reject(tmdbError(err)));

  async function resultOf(r: any, region: string, sites: WebSite[]): Promise<StreamingResult> {
    let offers = null;
    try {
      offers = (await tmdb(`/${r.media_type}/${r.id}/watch/providers`))?.results?.[region] || null;
    } catch {
      /* sans info */
    }
    const date = r.release_date || r.first_air_date || '';
    return {
      key: `${r.media_type}-${r.id}`,
      title: r.title || r.name || '',
      year: date.slice(0, 4),
      type: r.media_type,
      poster: r.poster_path ? tmdbImageUrl(r.poster_path, 'w342') : null,
      providers: offersOf(offers, sites),
    };
  }

  return {
    id: 'tmdb-streaming',
    async search(query, ctx) {
      const q = String(query || '').trim();
      if (!q) return { ok: true, results: [] };
      if (!client.hasKey()) return { ok: false, reason: 'nokey' };
      const { search, web } = ctx.getConfig();
      const language = search.language || 'fr-FR';
      const region = String(search.region || 'FR').toUpperCase();
      const data = await tmdb('/search/multi', { query: q, language, include_adult: 'false', page: '1' });
      const items = (data?.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, MAX_RESULTS);
      return { ok: true, results: await Promise.all(items.map((r: any) => resultOf(r, region, web))) };
    },
  };
}
