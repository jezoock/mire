'use strict';

const EXT = {
  video: ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.ogv', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mts', '.mpg', '.mpeg', '.vob', '.3gp', '.divx', '.rmvb'],
  audio: ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wma', '.aiff', '.aif', '.ape', '.mka'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico', '.tif', '.tiff', '.heic'],
};
const KIND = {};
for (const [kind, list] of Object.entries(EXT)) for (const e of list) KIND[e] = kind;

// Ce que le lecteur intégré (Chromium) lit directement. Le reste part dans mpv ou VLC.
const NATIVE = new Set([
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

const MIME = {
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
const COVER_RE = /^(cover|folder|front|poster|album|albumart)\.(jpe?g|png|webp)$/i;
// Illustrations à ne pas montrer dans la galerie d'images (pochettes, fonds façon Kodi…).
const ART_RE = /^(cover|folder|front|poster|album|albumart|fanart|backdrop|background|banner|clearlogo|clearart|landscape|logo|thumb|disc)\.(jpe?g|png|webp)$/i;
// Fonds d'écran (convention Kodi) : fanart.jpg dans le dossier, ou film-fanart.jpg à côté du film.
const FANART_RE = /^(fanart|backdrop|background)\.(jpe?g|png|webp)$/i;
const MEDIA_KINDS = ['video', 'audio', 'image'];

module.exports = { EXT, KIND, NATIVE, MIME, COVER_RE, ART_RE, FANART_RE, MEDIA_KINDS };
