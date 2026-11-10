/**
 * Client HTTP unique du processus principal : toutes les requêtes sortantes passent par ici.
 * - identité « Mire/1.0 » envoyée par défaut ;
 * - délai maximal par requête (corps de la réponse compris) ;
 * - erreurs en français, avec leur nature (`HttpError.kind`) pour que chaque appelant garde ses propres
 *   messages quand il en a.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hostOf } from '@mire/shared';

export const USER_AGENT = 'Mire/1.0 (lecteur multimédia personnel)';

/** Signature de fetch : le fetch de Node ou celui d'une session Electron (avec ses cookies). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RequestOptions {
  /** Délai maximal en millisecondes, lecture du corps comprise. */
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  redirect?: RequestRedirect;
  /** Identité envoyée ; `null` laisse celle du fetch utilisé (session Electron). */
  userAgent?: string | null;
  /** Implémentation de fetch ; par défaut le fetch global. */
  fetch?: FetchLike;
}

export type HttpErrorKind = 'unreachable' | 'timeout' | 'aborted' | 'status';

export class HttpError extends Error {
  kind: HttpErrorKind;
  url: string;
  host: string;
  status: number | null;

  constructor(kind: HttpErrorKind, url: string, message: string, { status = null as number | null, cause = undefined as unknown } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.kind = kind;
    this.url = url;
    this.host = hostOrUrl(url);
    this.status = status;
  }
}

// Pour une adresse invalide, les messages citent l'adresse telle quelle.
const hostOrUrl = (url: string): string => hostOf(url) || url;

/** Erreur « code de réponse » avec le message habituel (« exemple.fr a répondu avec le code 500 »). */
export function statusError(url: string, status: number, message = `${hostOrUrl(url)} a répondu avec le code ${status}`): HttpError {
  return new HttpError('status', url, message, { status });
}

interface Call {
  url: string;
  signal: AbortSignal;
  timeoutSignal: AbortSignal | null;
  external: AbortSignal | undefined;
}

// Traduit l'erreur d'un fetch en HttpError. Pendant la lecture du corps (`reading`), seuls le délai dépassé
// et l'annulation sont traduits : une autre erreur (JSON invalide, disque plein…) est rendue telle quelle.
function failure(call: Call, err: unknown, reading = false): unknown {
  if (err instanceof HttpError) return err;
  const host = hostOrUrl(call.url);
  if (call.timeoutSignal?.aborted) return new HttpError('timeout', call.url, `${host} met trop de temps à répondre.`, { cause: err });
  if (call.external?.aborted) return new HttpError('aborted', call.url, 'Requête annulée.', { cause: err });
  if (reading) return err;
  return new HttpError('unreachable', call.url, `Impossible de joindre ${host}. Vérifiez la connexion Internet.`, { cause: err });
}

function prepare(url: string, opts: RequestOptions): Call {
  const timeoutSignal = opts.timeout ? AbortSignal.timeout(opts.timeout) : null;
  const signals = [timeoutSignal, opts.signal].filter((s): s is AbortSignal => !!s);
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  return { url, signal, timeoutSignal, external: opts.signal };
}

async function send(call: Call, opts: RequestOptions): Promise<Response> {
  const userAgent = opts.userAgent === undefined ? USER_AGENT : opts.userAgent;
  const headers: Record<string, string> = { ...(userAgent ? { 'user-agent': userAgent } : {}), ...(opts.headers || {}) };
  const init: RequestInit = { headers, signal: call.signal };
  if (opts.method) init.method = opts.method;
  if (opts.redirect) init.redirect = opts.redirect;
  try {
    return await (opts.fetch || fetch)(call.url, init);
  } catch (err) {
    throw failure(call, err);
  }
}

// Envoie la requête puis lit la réponse avec `read`, les erreurs de lecture étant traduites comme les autres.
async function exchange<T>(url: string, opts: RequestOptions, read: (res: Response) => Promise<T>): Promise<T> {
  const call = prepare(url, opts);
  const res = await send(call, opts);
  try {
    return await read(res);
  } catch (err) {
    throw failure(call, err, true);
  }
}

/**
 * Requête brute : la réponse est rendue quel que soit son code. Seuls l'absence de réponse, le délai dépassé
 * et l'annulation lèvent une HttpError. Le délai continue de courir pendant la lecture du corps.
 */
export function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  return send(prepare(url, opts), opts);
}

/** Requête HEAD ; la réponse est rendue quel que soit son code. */
export function head(url: string, opts: RequestOptions = {}): Promise<Response> {
  return request(url, { ...opts, method: 'HEAD' });
}

export interface GetJsonOptions extends RequestOptions {
  /** Une réponse 404 rend `null` au lieu de lever une erreur. */
  notFoundAsNull?: boolean;
}

/** JSON d'une adresse ; un code d'erreur lève une HttpError (`kind: 'status'`). */
export function getJson<T = unknown>(url: string, opts: GetJsonOptions = {}): Promise<T | null> {
  const headers = { accept: 'application/json', ...(opts.headers || {}) };
  return exchange(url, { ...opts, headers }, async (res) => {
    if (res.status === 404 && opts.notFoundAsNull) return null;
    if (!res.ok) throw statusError(url, res.status);
    return (await res.json()) as T;
  });
}

/** Contenu brut d'une adresse ; un code d'erreur lève une HttpError (`kind: 'status'`). */
export function getBuffer(url: string, opts: RequestOptions = {}): Promise<Buffer> {
  return exchange(url, opts, async (res) => {
    if (!res.ok) throw statusError(url, res.status);
    return Buffer.from(await res.arrayBuffer());
  });
}

/** Texte d'une adresse (UTF-8) ; un code d'erreur lève une HttpError (`kind: 'status'`). */
export function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  return exchange(url, opts, async (res) => {
    if (!res.ok) throw statusError(url, res.status);
    return res.text();
  });
}

export interface DownloadOptions extends RequestOptions {
  /** Appelé au plus toutes les 200 ms pendant la réception, puis une dernière fois à la fin. */
  onProgress?: (received: number, total: number) => void;
}

/**
 * Télécharge `url` dans `dest` : le fichier est écrit dans `dest.part` puis renommé, et `dest.part` est
 * supprimé en cas d'échec. Rend `dest`.
 */
export async function downloadToFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<string> {
  const { onProgress } = opts;
  const part = `${dest}.part`;
  const call = prepare(url, opts);
  const res = await send(call, opts);
  if (!res.ok || !res.body) {
    throw statusError(url, res.status, `Téléchargement impossible : ${hostOrUrl(url)} a répondu avec le code ${res.status}.`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let last = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - last > 200) {
        last = now;
        onProgress?.(received, total);
      }
      cb(null, chunk);
    },
  });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, fs.createWriteStream(part));
    await fsp.rename(part, dest);
  } catch (err) {
    await fsp.unlink(part).catch(() => {});
    throw failure(call, err, true);
  }
  onProgress?.(received, total || received);
  return dest;
}

const nextSlot = new Map<string, number>();

/**
 * Limiteur de débit partagé par clé : les tâches passées à la fonction rendue démarrent au plus une fois
 * toutes les `intervalMs` millisecondes (MusicBrainz : une requête par seconde), même lancées en même temps.
 */
export function rateLimited(key: string, intervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  return async (task) => {
    const now = Date.now();
    // Le créneau est réservé avant d'attendre : deux appels simultanés ne prennent pas le même.
    const at = Math.max(now, nextSlot.get(key) ?? 0);
    nextSlot.set(key, at + intervalMs);
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
    return task();
  };
}
