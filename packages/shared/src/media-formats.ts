// Formats de fichiers reconnus par Mire : médias de la bibliothèque, illustrations, jeux et index de disques.

import type { MediaKind } from './config.ts';

export const MEDIA_KINDS: readonly MediaKind[] = ['video', 'audio', 'image'];

export const EXT: Record<MediaKind, string[]> = {
  video: ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.ogv', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mts', '.mpg', '.mpeg', '.vob', '.3gp', '.divx', '.rmvb'],
  audio: ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wma', '.aiff', '.aif', '.ape', '.mka'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico', '.tif', '.tiff', '.heic'],
};
/** Type de média d'une extension (« .mkv » → « video ») ; absent pour une extension inconnue. */
export const KIND: Record<string, MediaKind> = {};
for (const kind of MEDIA_KINDS) for (const e of EXT[kind]) KIND[e] = kind;

// Ce que le lecteur intégré (Chromium) lit directement. Le reste part dans mpv ou VLC.
export const NATIVE: ReadonlySet<string> = new Set([
  '.mp4',
  '.m4v',
  '.mkv',
  '.webm',
  '.mov',
  '.ogv',
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.svg',
  '.ico',
]);

export const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Pochettes d'album et affiches de dossier.
export const COVER_RE = /^(cover|folder|front|poster|album|albumart)\.(jpe?g|png|webp)$/i;
// Illustrations à ne pas montrer dans la galerie d'images (pochettes, fonds façon Kodi…).
export const ART_RE =
  /^(cover|folder|front|poster|album|albumart|fanart|backdrop|background|banner|clearlogo|clearart|landscape|logo|thumb|disc)\.(jpe?g|png|webp)$/i;
// Fonds d'écran (convention Kodi) : fanart.jpg dans le dossier, ou film-fanart.jpg à côté du film.
export const FANART_RE = /^(fanart|backdrop|background)\.(jpe?g|png|webp)$/i;

// Fichiers de jeux : un lien vers l'un d'eux, ouvert dans une nouvelle fenêtre, devient un téléchargement.
export const GAME_FILE_RE =
  /\.(zip|7z|iso|chd|cue|bin|cso|pbp|rvz|wbfs|wud|wux|gcm|ciso|nes|fds|sfc|smc|gb|gbc|gba|n64|z64|v64|md|gen|smd|sms|gg|pce|nds|3ds|cia|cci|3dsx|a26)$/i;

// Index de jeux sur disque : le fichier lancé ne fait que renvoyer aux vrais fichiers de données (voir discfiles).
export const DISC_INDEX_EXT: ReadonlySet<string> = new Set(['.cue', '.gdi', '.m3u', '.ccd', '.mds', '.toc']);
