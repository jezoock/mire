/**
 * Listes de lecture M3U (contribution `sources`, id `src-m3u`) : reprise du fournisseur « m3u » du cœur de Mire (avant
 * P5-12), qui ne lisait que les listes en ligne ; une liste de cet ordinateur est lue aussi.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`, P5-11a et P5-12) : les emplacements restent dans la configuration de
 * Mire ; le cœur propose chacun à `handles`. Une liste en ligne acceptée est accordée au plugin (`ctx.http` : son
 * origine exacte et sous son chemin, réseau local compris) tant qu'elle reste dans la bibliothèque : le plugin ne
 * déclare donc ni hôte ni réseau local. Une liste de cet ordinateur est accordée de la même façon avec son dossier
 * (`ctx.files`, permission `folders`). Une liste sur un partage réseau n'est pas lue ici (le partage va au plugin
 * `mire.source.network`).
 */
import { isWebUrl, listElements } from './list.mjs';
import { parseM3U } from './parse.mjs';
import { translator } from './texts.mjs';

/** Nombre maximal d'éléments d'une analyse (borne du cœur). */
export const MAX_ITEMS = 150000;
/** Délai de lecture d'une liste en ligne (comme le cœur). */
export const LIST_TIMEOUT = 15000;

const MEDIA_KINDS = ['video', 'audio', 'image'];
const mediaKinds = (location) => (Array.isArray(location.kinds) ? location.kinds.filter((k) => MEDIA_KINDS.includes(k)) : []);

const PLAYLIST = /\.m3u8?$/i;

function onlineList(location) {
  if (typeof location.url !== 'string' || !isWebUrl(location.url)) return false;
  try {
    return PLAYLIST.test(new URL(location.url).pathname);
  } catch {
    return false;
  }
}

const localList = (location) => typeof location.path === 'string' && location.network !== true && PLAYLIST.test(location.path);

const isList = (location) => !!location && mediaKinds(location).length > 0 && (onlineList(location) || localList(location));

export default function createSource(ctx) {
  const t = translator(ctx.locale);

  async function read(location) {
    try {
      const text = onlineList(location) ? await ctx.http.getText(location.url, { timeout: LIST_TIMEOUT }) : await ctx.files.readText(location.path);
      if (typeof text !== 'string') throw new Error('absent');
      return text;
    } catch {
      throw new Error(t('unavailable'));
    }
  }

  return {
    id: 'src-m3u',
    tags: ['remote'],
    handles: (location) => isList(location),
    instance: (location) => location.url ?? location.path,
    async scan(location) {
      if (!isList(location)) return [];
      const list = onlineList(location) ? location.url : location.path;
      return listElements(list, parseM3U(await read(location)), mediaKinds(location), MAX_ITEMS);
    },
  };
}
