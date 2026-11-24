/**
 * Serveur web (contribution `sources`, id `src-http`) : reprise du fournisseur « http-index » du cœur de Mire (avant
 * P5-12). Une adresse de la bibliothèque (`http://192.168.1.10/films/`, `https://nas.local/musique/`) dont le serveur
 * affiche ses dossiers (page d'index Apache, nginx, NAS) est parcourue page par page.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`, P5-11a et P5-12) : les emplacements restent dans la configuration
 * de Mire ; le cœur propose chacun à `handles`, et une adresse acceptée est accordée au plugin (`ctx.http` : son
 * origine exacte et sous son chemin, réseau local compris) tant qu'elle reste dans la bibliothèque. Le plugin ne
 * déclare donc ni hôte ni réseau local. Une liste de lecture (`.m3u`, `.m3u8`) va au plugin `mire.source.m3u`.
 */
import { crawl } from './crawl.mjs';
import { pageElements } from './page.mjs';
import { translator } from './texts.mjs';

/** Nombre maximal d'éléments d'une analyse (borne du cœur). */
export const MAX_ITEMS = 150000;

/** Types de fichiers lus ici. */
const MEDIA_KINDS = ['video', 'audio', 'image'];
const mediaKinds = (location) => (Array.isArray(location.kinds) ? location.kinds.filter((k) => MEDIA_KINDS.includes(k)) : []);

function isPlaylist(url) {
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const isServer = (location) =>
  !!location && typeof location.url === 'string' && /^https?:\/\//i.test(location.url) && !isPlaylist(location.url) && mediaKinds(location).length > 0;

export default function createSource(ctx) {
  const t = translator(ctx.locale);
  return {
    id: 'src-http',
    tags: ['remote'],
    handles: (location) => isServer(location),
    instance: (location) => location.url,
    async scan(location) {
      if (!isServer(location)) return [];
      const kinds = new Set(mediaKinds(location));
      const out = [];
      await crawl(ctx.http, location.url, (_dirUrl, dirName, files) => pageElements(dirName, files, kinds, out, MAX_ITEMS), { t });
      return out;
    },
  };
}
