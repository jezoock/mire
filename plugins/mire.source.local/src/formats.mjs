// Formats reconnus, repris du cœur de Mire (`packages/shared/src/media-formats.ts`) : l'hôte isolé n'importe pas le
// cœur. Un test compare les deux listes.

export const EXT = {
  video: ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.ogv', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mts', '.mpg', '.mpeg', '.vob', '.3gp', '.divx', '.rmvb'],
  audio: ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wma', '.aiff', '.aif', '.ape', '.mka'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico', '.tif', '.tiff', '.heic'],
};

/** Type de média d'une extension (« .mkv » → « video »). */
export const KIND = Object.fromEntries(Object.entries(EXT).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));

export const SUBTITLE_EXTS = ['.srt', '.vtt'];

// Pochettes d'album et affiches de dossier.
export const COVER_RE = /^(cover|folder|front|poster|album|albumart)\.(jpe?g|png|webp)$/i;
// Illustrations à ne pas montrer dans la galerie d'images (pochettes, fonds façon Kodi…).
export const ART_RE =
  /^(cover|folder|front|poster|album|albumart|fanart|backdrop|background|banner|clearlogo|clearart|landscape|logo|thumb|disc)\.(jpe?g|png|webp)$/i;
// Fonds d'écran (convention Kodi) : fanart.jpg dans le dossier, ou film-fanart.jpg à côté du film.
export const FANART_RE = /^(fanart|backdrop|background)\.(jpe?g|png|webp)$/i;
