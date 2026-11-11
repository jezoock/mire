// Faux fetch pour les tests de récupération d'infos : sert des réponses HTTP enregistrées (fixtures JSON),
// sans aucun accès réseau. Une adresse absente des fixtures répond 404 et est notée dans `missing`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Réponse enregistrée : JSON, texte ou image (corps factice), avec un code éventuel. */
export interface Recorded {
  status?: number;
  json?: unknown;
  text?: string;
  /** Type de l'image servie (`image/jpeg` par défaut). */
  image?: string;
}

export type Routes = Record<string, Recorded>;

export interface FakeFetch {
  (url: string, init?: RequestInit): Promise<Response>;
  /** Adresses demandées, dans l'ordre. */
  calls: string[];
  /** Adresses demandées sans réponse enregistrée. */
  missing: string[];
  /** En-têtes envoyés, par requête (dans l'ordre). */
  headers: Record<string, string>[];
}

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'scrape');

/** Lit et fusionne des fichiers de `test/fixtures/scrape` (« tmdb », « steam »…). */
export function loadRoutes(...names: string[]): Routes {
  return Object.assign({}, ...names.map((n) => JSON.parse(readFileSync(path.join(FIXTURES, `${n}.json`), 'utf8'))));
}

function respond(url: string, r: Recorded): Response {
  const status = r.status ?? 200;
  if (r.image) return new Response(Buffer.from(`image:${url}`), { status, headers: { 'content-type': r.image } });
  if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
  return new Response(r.text ?? '', { status, headers: { 'content-type': 'text/plain' } });
}

export function fakeFetch(routes: Routes): FakeFetch {
  const fn = (async (url: string, init?: RequestInit) => {
    fn.calls.push(url);
    fn.headers.push({ ...((init?.headers as Record<string, string>) || {}) });
    init?.signal?.throwIfAborted();
    const r = routes[url];
    if (!r) {
      fn.missing.push(url);
      return new Response('introuvable', { status: 404 });
    }
    return respond(url, r);
  }) as FakeFetch;
  fn.calls = [];
  fn.missing = [];
  fn.headers = [];
  return fn;
}
