/**
 * Registre des tags et des infos : identifiants du cœur (anglais, stables), nom affiché tiré des catalogues de
 * textes (`catalog.tags.<id>`, `catalog.infos.<id>`), type de valeur d'une info, et tags créés par l'utilisateur
 * (identifiant : nom simplifié). Les plugins y déclareront les leurs (phase 3).
 */
import { slug, type InfoType, type InfoValue } from '@mire/shared';

/**
 * Tags posés par le cœur : type de fichier, tags des sources de la bibliothèque (P2-02), tags automatiques internes
 * (P2-05, plugins inclus en phase 5), puis tags des sources des jeux, de la télévision et des sites (P2-03).
 */
export const CORE_TAGS = ['video', 'audio', 'image', 'local', 'network', 'remote', 'series', 'movie', 'game', 'tv', 'stream'] as const;

/** Infos du cœur et leur type de valeur. */
export const CORE_INFOS: Readonly<Record<string, InfoType>> = {
  // Type de fichier.
  extension: 'text',
  // Posées par les sources.
  mediaType: 'text',
  folder: 'text',
  server: 'text',
  playlist: 'text',
  subtitles: 'list',
  // Saisies à la main (et, plus tard, infos en ligne).
  title: 'text',
  year: 'number',
  genres: 'list',
  overview: 'text',
  artist: 'text',
  // Tags automatiques (P2-05).
  series: 'text',
  season: 'number',
  episode: 'number',
  album: 'text',
  track: 'number',
  system: 'text',
  // Sources des sites (P2-03) : rangement du site dans Streaming (`video`, `music`…).
  category: 'text',
  // Source des chaînes (P2-07) : numéro de la chaîne, pour le tri de la page Télévision.
  channel: 'number',
};

/** Identifiant d'une info : lettres et chiffres, en commençant par une minuscule (`season`, `releaseDate`). */
export const INFO_ID_RE = /^[a-z][a-zA-Z0-9]{0,63}$/;

/** Identifiant d'un tag créé par l'utilisateur : son nom simplifié (« Vus en 2024 » → `vus-en-2024`). */
export const userTagId = (name: unknown): string => slug(name).slice(0, 64);

/** Vrai si la valeur convient à une info (texte, nombre fini, oui/non, liste de textes). */
export function isInfoValue(v: unknown): v is InfoValue {
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Valeur saisie ramenée au type de l'info : un nombre écrit en texte devient un nombre, un texte devient une liste
 * (séparée par des virgules). `undefined` si elle ne convient pas ; une info sans type connu garde toute valeur admise.
 */
export function coerceInfo(type: InfoType | undefined, v: unknown): InfoValue | undefined {
  if (type === 'number') {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : undefined;
  }
  if (type === 'list') {
    const items = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : null;
    if (!items || !items.every((x) => typeof x === 'string')) return undefined;
    const list = items.map((x: string) => x.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (type === 'boolean') return typeof v === 'boolean' ? v : undefined;
  if (type === 'text') return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  return isInfoValue(v) ? v : undefined;
}

export interface UserTag {
  name: string;
}

/** Registre : tags du cœur et de l'utilisateur, infos du cœur. `translate` donne les noms affichés. */
export function createRegistry(translate: (key: string) => string) {
  const core = new Set<string>(CORE_TAGS);
  let user: Record<string, UserTag> = {};

  return {
    /** Tags créés par l'utilisateur (lus depuis `overrides.json`). */
    setUserTags(tags: Record<string, UserTag>): void {
      user = tags;
    },
    isCoreTag: (id: string) => core.has(id),
    isUserTag: (id: string) => Object.hasOwn(user, id),
    /** Identifiants des tags du cœur, dans l'ordre. */
    coreTags: (): string[] => [...core],
    userTags: (): string[] => Object.keys(user),
    /** Nom affiché d'un tag : catalogue de textes pour le cœur, nom saisi pour l'utilisateur, identifiant sinon. */
    tagName(id: string): string {
      if (core.has(id)) return translate(`catalog.tags.${id}`);
      return user[id]?.name ?? id;
    },
    /** Nom affiché d'une info. */
    infoName: (id: string): string => (Object.hasOwn(CORE_INFOS, id) ? translate(`catalog.infos.${id}`) : id),
    infoType: (id: string): InfoType | undefined => (Object.hasOwn(CORE_INFOS, id) ? CORE_INFOS[id] : undefined),
  };
}

export type Registry = ReturnType<typeof createRegistry>;
