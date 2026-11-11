/**
 * Client unique de l'API TMDB (films et séries), pour la récupération d'infos et la recherche « où regarder ».
 * La clé saisie dans Réglages est soit un jeton d'accès long (envoyé dans l'en-tête `Authorization`), soit une
 * clé d'API courte (envoyée dans l'adresse, paramètre `api_key`).
 */
import * as http from './http.ts';

export const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGES = 'https://image.tmdb.org/t/p/';

// Au-delà de cette longueur, la clé est un jeton d'accès (« lecture seule »), pas une clé d'API.
const TOKEN_MIN_LENGTH = 61;

export type TmdbParams = Record<string, string | number | null | undefined>;

/** Adresse et en-têtes d'une requête TMDB ; les paramètres vides ou absents sont omis. */
export function tmdbRequest(pathname: string, params: TmdbParams, key: string): { url: string; headers: Record<string, string> } {
  const url = new URL(`${TMDB_API}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (key.length >= TOKEN_MIN_LENGTH) headers.authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  return { url: url.toString(), headers };
}

/** Adresse d'une image TMDB (`size` : « w154 », « w342 », « w1280 »…). */
export const tmdbImageUrl = (file: string, size: string): string => `${TMDB_IMAGES}${size}${file}`;

export interface TmdbClientOptions {
  /** Clé saisie dans Réglages (lue à chaque requête). */
  key: () => string;
  /** Implémentation de fetch (tests) ; par défaut le fetch global. */
  fetch?: http.FetchLike;
}

export interface TmdbClient {
  /** Une clé est saisie. */
  hasKey(): boolean;
  /** JSON d'une route de l'API ; les erreurs sont celles de `http.getJson` (HttpError). */
  get<T = any>(pathname: string, params?: TmdbParams, opts?: http.GetJsonOptions): Promise<T | null>;
}

export function createTmdbClient({ key, fetch }: TmdbClientOptions): TmdbClient {
  const currentKey = () => String(key() || '').trim();
  return {
    hasKey: () => !!currentKey(),
    get(pathname, params = {}, opts = {}) {
      const { url, headers } = tmdbRequest(pathname, params, currentKey());
      return http.getJson(url, { ...opts, headers: { ...(opts.headers || {}), ...headers }, fetch: opts.fetch || fetch });
    },
  };
}
