/**
 * Emplacement d'une source :
 *   D:\\Films, /home/moi/Films        dossier
 *   \\\\NAS\\Films, //NAS/Films        partage réseau (Windows le lit directement)
 *   smb://nas/films                  partage réseau : chemin Windows, /Volumes (macOS) ou gvfs (Linux)
 *   http(s)://…/films/ ou …/liste.m3u  page d'index d'un serveur web, ou liste de lecture M3U
 */
import path from 'node:path';
import { safeDecode, isHttpUrl } from '@mire/shared';

export type ResolvedLocation = { type: 'url'; url: string } | { type: 'path'; path: string; network: boolean };

export interface ResolveOptions {
  platform?: NodeJS.Platform;
  uid?: number;
}

const currentUid = () => (typeof process.getuid === 'function' ? process.getuid() : 1000);

export function resolveLocation(loc: unknown, { platform = process.platform, uid = currentUid() }: ResolveOptions = {}): ResolvedLocation {
  const IS_WIN = platform === 'win32';
  const IS_MAC = platform === 'darwin';
  const s = String(loc || '').trim();
  if (isHttpUrl(s)) return { type: 'url', url: s };
  const smb = /^smb:\/\/([^/]+)\/([^/]+)(\/.*)?$/i.exec(s);
  if (smb) {
    const [, host, share, rest = ''] = smb;
    const tail = rest.split('/').filter(Boolean).map(safeDecode);
    if (IS_WIN) return { type: 'path', path: `\\\\${host}\\${share}${tail.length ? `\\${tail.join('\\')}` : ''}`, network: true };
    // path.posix : barres obliques même quand on simule macOS ou Linux depuis Windows.
    if (IS_MAC) return { type: 'path', path: path.posix.join('/Volumes', share, ...tail), network: true };
    return {
      type: 'path',
      path: path.posix.join(`/run/user/${uid}/gvfs`, `smb-share:server=${host.toLowerCase()},share=${share.toLowerCase()}`, ...tail),
      network: true,
    };
  }
  if (IS_WIN && /^\/\/[^/]/.test(s)) return { type: 'path', path: s.replace(/\//g, '\\'), network: true };
  return { type: 'path', path: s, network: /^\\\\/.test(s) };
}

/** Message affiché quand le dossier ou le partage d'une source est inaccessible. */
export function locationError(loc: string, r: { network?: boolean }): string {
  if (r.network) return `Partage réseau inaccessible : ${loc}. Vérifiez que l’ordinateur du partage est allumé et que vous y êtes connecté.`;
  return `Dossier introuvable : ${loc}`;
}
