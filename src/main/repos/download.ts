/**
 * Téléchargement des index et des paquets : `https:` seulement (redirections comprises), taille maximale vérifiée
 * avant et pendant la réception, délai d'attente pour l'ensemble (corps compris). Passe par le client HTTP du cœur
 * (`net/http.ts`) pour l'identité et la traduction des erreurs réseau.
 */
import { HttpError, request, type FetchLike } from '../net/http.ts';
import { RepoError } from './errors.ts';

export interface DownloadLimits {
  /** Taille maximale de la réponse, en octets. */
  maxBytes: number;
  /** Délai pour l'ensemble du téléchargement (ms). */
  timeout: number;
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Appelé pendant la réception (au plus toutes les 200 ms) et à la fin. */
  onProgress?: (received: number, total: number) => void;
}

const MAX_REDIRECTS = 5;

/** Adresse `https:` valide, ou `null`. */
export function httpsUrl(url: string, base?: string): string | null {
  try {
    const u = new URL(url, base);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Octets d'une adresse `https:`. Lève une `RepoError` : `url`, `network` ou `too-big`. */
export async function downloadBytes(url: string, limits: DownloadLimits): Promise<Buffer> {
  const signal = AbortSignal.any([AbortSignal.timeout(limits.timeout), ...(limits.signal ? [limits.signal] : [])]);
  let current = httpsUrl(url);
  if (!current) throw new RepoError('url', `URL refused (https only): ${url}`);
  try {
    for (let hop = 0; ; hop++) {
      const res = await request(current, { fetch: limits.fetch, signal, redirect: 'manual', headers: { accept: '*/*' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel().catch(() => {});
        const next = httpsUrl(res.headers.get('location')!, current);
        if (!next) throw new RepoError('url', `Redirect refused (https only) from ${current}`);
        if (hop >= MAX_REDIRECTS) throw new RepoError('network', `Too many redirects: ${url}`);
        current = next;
        continue;
      }
      if (!res.ok || !res.body) throw new RepoError('network', `${current}: status ${res.status}`, { status: String(res.status) });
      return await readLimited(res, limits);
    }
  } catch (err) {
    if (err instanceof RepoError) throw err;
    if (err instanceof HttpError || signal.aborted) throw new RepoError('network', `${url} : ${(err as Error).message}`);
    throw new RepoError('network', `${url} : ${(err as Error)?.message ?? err}`);
  }
}

async function readLimited(res: Response, { maxBytes, onProgress }: DownloadLimits): Promise<Buffer> {
  const announced = Number(res.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await res.body!.cancel().catch(() => {});
    throw new RepoError('too-big', `Response too big (${announced} bytes, at most ${maxBytes}).`);
  }
  const total = Number.isFinite(announced) && announced > 0 ? announced : 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let last = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new RepoError('too-big', `Response too big (more than ${maxBytes} bytes).`);
    }
    chunks.push(value);
    const now = Date.now();
    if (onProgress && now - last >= 200) {
      last = now;
      onProgress(received, total);
    }
  }
  onProgress?.(received, total || received);
  return Buffer.concat(chunks);
}
