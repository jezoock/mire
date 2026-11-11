/** Télévision : chaînes des playlists M3U, détection de la box, service actif (fournisseurs playlist et web). */
export { parseM3U, qualityOf, groupChannels } from './channels.ts';
export { detectTvService } from './detect.ts';
export { createTv, playlistProvider, webProvider, DEFAULT_TV_PROVIDERS, type Tv } from './service.ts';
export type * from './types.ts';
