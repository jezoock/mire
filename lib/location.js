'use strict';
const path = require('node:path');

/**
 * Emplacement d'une source :
 *   D:\\Films, /home/moi/Films        dossier
 *   \\\\NAS\\Films, //NAS/Films        partage réseau (Windows le lit directement)
 *   smb://nas/films                  partage réseau : chemin Windows, /Volumes (macOS) ou gvfs (Linux)
 *   http(s)://…/films/ ou …/liste.m3u  page d'index d'un serveur web, ou liste de lecture M3U
 */
function resolveLocation(loc, { platform = process.platform, uid = typeof process.getuid === 'function' ? process.getuid() : 1000 } = {}) {
  const IS_WIN = platform === 'win32';
  const IS_MAC = platform === 'darwin';
  const s = String(loc || '').trim();
  if (/^https?:\/\//i.test(s)) return { type: 'url', url: s };
  const smb = /^smb:\/\/([^/]+)\/([^/]+)(\/.*)?$/i.exec(s);
  if (smb) {
    const [, host, share, rest = ''] = smb;
    const tail = rest
      .split('/')
      .filter(Boolean)
      .map((x) => {
        try {
          return decodeURIComponent(x);
        } catch {
          return x;
        }
      });
    if (IS_WIN) return { type: 'path', path: `\\\\${host}\\${share}${tail.length ? `\\${tail.join('\\')}` : ''}`, network: true };
    if (IS_MAC) return { type: 'path', path: path.join('/Volumes', share, ...tail), network: true };
    return {
      type: 'path',
      path: path.join(`/run/user/${uid}/gvfs`, `smb-share:server=${host.toLowerCase()},share=${share.toLowerCase()}`, ...tail),
      network: true,
    };
  }
  if (IS_WIN && /^\/\/[^/]/.test(s)) return { type: 'path', path: s.replace(/\//g, '\\'), network: true };
  return { type: 'path', path: s, network: /^\\\\/.test(s) };
}

module.exports = { resolveLocation };
