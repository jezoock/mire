/**
 * Protocole media:// : sert les fichiers locaux à l'interface (`media://local/?p=<chemin>`), avec gestion des
 * plages d'octets pour l'avance rapide. Chaque requête passe par la politique d'accès.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = 'media';

/** Plage d'octets demandée : bornes incluses, `'unsatisfiable'` (réponse 416), ou `null` (fichier entier). */
export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Analyse un en-tête `Range` pour un fichier de `size` octets. Un en-tête absent, mal formé ou portant plusieurs
 * plages donne `null` : le fichier est servi en entier, comme avant.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] !== '') {
    // Suffixe : les N derniers octets.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1] || 0);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** Ce que le gestionnaire lit d'une requête (une `Request` d'Electron convient). */
export interface MediaRequest {
  url: string;
  headers: { get(name: string): string | null };
}

export interface MediaHandlerOptions {
  isAllowed: (file: unknown) => boolean;
  /** Type MIME d'un fichier d'après son nom. */
  mimeType: (file: string) => string;
}

export function createMediaHandler({ isAllowed, mimeType }: MediaHandlerOptions) {
  return async (request: MediaRequest): Promise<Response> => {
    let file: string | null;
    try {
      file = new URL(request.url).searchParams.get('p');
    } catch {
      return new Response('Requête invalide', { status: 400 });
    }
    if (!isAllowed(file)) return new Response('Accès refusé', { status: 403 });
    const target = file as string;

    let size: number;
    try {
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw new Error('pas un fichier');
      size = stat.size;
    } catch {
      return new Response('Introuvable', { status: 404 });
    }

    const type = mimeType(target);
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    if (range) {
      const { start, end } = range;
      return new Response(Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(target)) as ReadableStream, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  };
}

/** Sous-ensemble du module `protocol` d'Electron utilisé ici. */
interface ProtocolApi {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void;
  handle(scheme: string, handler: (request: any) => Promise<Response>): void;
}

/** À appeler avant `app.whenReady()` : media:// se comporte comme une origine sûre, lisible en flux. */
export function registerMediaScheme(protocol: ProtocolApi): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

export function registerMediaProtocol(protocol: ProtocolApi, options: MediaHandlerOptions): void {
  protocol.handle(MEDIA_SCHEME, createMediaHandler(options));
}
