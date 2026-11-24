/**
 * Registre des tags et des infos : identifiants du cœur (anglais, stables), nom affiché tiré des catalogues de
 * textes (`catalog.tags.<id>`, `catalog.infos.<id>`), type de valeur d'une info, et tags créés par l'utilisateur
 * (identifiant : nom simplifié). Les plugins actifs y déclarent les leurs (`tags` et `infos` de leurs contributions,
 * P3-03) ; le cœur garde la priorité sur un identifiant qu'il déclare aussi.
 */
import { slug, type InfoType, type InfoValue } from '@mire/shared';
import type { InfoDeclaration } from '@mire/plugin-sdk';

/**
 * Tags posés par le cœur : type de fichier, tags des sources de la bibliothèque (P2-02), puis tags des sources des
 * jeux, de la télévision et des sites (P2-03). Les tags automatiques (`series`, `movie`…) sont ceux des plugins qui
 * les déclarent (P5-09) : un plugin désactivé emporte les siens.
 */
export const CORE_TAGS = ['video', 'audio', 'image', 'local', 'network', 'remote', 'game', 'tv', 'stream'] as const;

// Déclaration d'une info (type de valeur, recherche) : publiée dans le SDK, un plugin la reprend dans son manifeste.
export type { InfoDeclaration };

const text = (searchable = true): InfoDeclaration => (searchable ? { type: 'text' } : { type: 'text', searchable });
const list = (searchable = true): InfoDeclaration => (searchable ? { type: 'list' } : { type: 'list', searchable });
const NUMBER: InfoDeclaration = { type: 'number' };

/**
 * Infos du cœur. Ne sont pas cherchées : l'extension (`mkv` trouverait tous les fichiers de ce format), le genre de
 * média d'une entrée M3U (`video`, `audio` : déjà le nom des tags), le serveur (nom d'hôte d'une adresse) et les
 * fichiers de sous-titres. Le dossier, la liste M3U et la catégorie d'un site le sont : ce sont des noms donnés par
 * l'utilisateur, et l'interface historique cherche déjà dans le dossier.
 */
export const CORE_INFOS: Readonly<Record<string, InfoDeclaration>> = {
  // Type de fichier.
  extension: text(false),
  // Posées par les sources.
  mediaType: text(false),
  folder: text(),
  server: text(false),
  playlist: text(),
  subtitles: list(false),
  // Saisies à la main (et, plus tard, infos en ligne).
  title: text(),
  year: NUMBER,
  genres: list(),
  overview: text(),
  artist: text(),
  // Posées par les tags automatiques (plugins inclus depuis P5-09), saisies à la main ou venues des infos en ligne :
  // le cœur les déclare pour que les éditeurs, les pages et la recherche les connaissent sans ces plugins.
  series: text(),
  season: NUMBER,
  episode: NUMBER,
  album: text(),
  track: NUMBER,
  system: text(),
  // Sources des sites (P2-03) : rangement du site dans Streaming (`video`, `music`…).
  category: text(),
  // Source des chaînes (P2-07) : numéro de la chaîne, pour le tri de la page Télévision.
  channel: NUMBER,
};

/**
 * Ce que la recherche lit d'une info : sa valeur texte, les textes de sa liste, ou rien (nombre, oui/non, info
 * déclarée non cherchable). Une info non déclarée est lue si c'est un texte.
 */
export function searchedAs(decl: InfoDeclaration | undefined): 'text' | 'list' | null {
  if (!decl) return 'text';
  if (decl.searchable === false) return null;
  return decl.type === 'text' || decl.type === 'list' ? decl.type : null;
}

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

const infoDeclaration = (id: string): InfoDeclaration | undefined => (Object.hasOwn(CORE_INFOS, id) ? CORE_INFOS[id] : undefined);

export interface UserTag {
  name: string;
}

/** Tags et infos déclarés par un plugin, et le préfixe de ses textes dans les catalogues (`pluginTexts.<id>.`). */
export interface PluginDeclarations {
  tags: readonly string[];
  infos: Readonly<Record<string, InfoDeclaration>>;
  textPrefix: string;
}

/** Registre : tags du cœur et de l'utilisateur, infos du cœur. `translate` donne les noms affichés. */
export function createRegistry(translate: (key: string) => string) {
  const core = new Set<string>(CORE_TAGS);
  let user: Record<string, UserTag> = {};
  // Plugins actifs, dans l'ordre d'activation : le premier qui déclare un tag ou une info en donne le nom et le type.
  const plugins = new Map<string, PluginDeclarations>();
  const listeners = new Set<() => void>();
  const pluginTag = (id: string) => [...plugins.values()].find((p) => p.tags.includes(id));
  const pluginInfo = (id: string) => [...plugins.values()].find((p) => Object.hasOwn(p.infos, id));
  const declaration = (id: string): InfoDeclaration | undefined => {
    const own = infoDeclaration(id);
    if (own) return own;
    const p = pluginInfo(id);
    return p ? p.infos[id] : undefined;
  };
  const changed = () => {
    for (const l of listeners) l();
  };

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
      if (user[id]) return user[id].name;
      const p = pluginTag(id);
      return p ? translate(`${p.textPrefix}tags.${id}`) : id;
    },
    /** Nom affiché d'une info. */
    infoName(id: string): string {
      if (Object.hasOwn(CORE_INFOS, id)) return translate(`catalog.infos.${id}`);
      const p = pluginInfo(id);
      return p ? translate(`${p.textPrefix}infos.${id}`) : id;
    },
    infoType: (id: string): InfoType | undefined => declaration(id)?.type,
    /** Ce que la recherche lit de l'info (`searchedAs`). */
    infoSearch: (id: string): ReturnType<typeof searchedAs> => searchedAs(declaration(id)),
    /** Plugins actifs qui déclarent un tag (identifiants, dans l'ordre d'activation ; P4-21). */
    pluginsOf: (id: string): string[] => [...plugins].filter(([, p]) => p.tags.includes(id)).map(([pid]) => pid),
    /** Tags déclarés par les plugins actifs et pas par le cœur, sans doublon, dans l'ordre d'activation. */
    pluginTags: (): string[] => [...new Set([...plugins.values()].flatMap((p) => p.tags))].filter((id) => !core.has(id)),
    /** Tag déclaré par un plugin actif. */
    isPluginTag: (id: string): boolean => !core.has(id) && !!pluginTag(id),
    /** Infos déclarées par un plugin actif (en plus de celles du cœur). */
    pluginInfo: (id: string): InfoDeclaration | undefined => pluginInfo(id)?.infos[id],
    /** Un plugin activé déclare ses tags et ses infos ; les abonnés (recherche) oublient ce qu'ils en avaient retenu. */
    declarePlugin(pluginId: string, decl: PluginDeclarations): void {
      plugins.set(pluginId, { tags: [...decl.tags], infos: { ...decl.infos }, textPrefix: decl.textPrefix });
      changed();
    },
    /** Un plugin désactivé retire ses déclarations. */
    removePlugin(pluginId: string): void {
      if (plugins.delete(pluginId)) changed();
    },
    /** Abonnement aux changements de déclarations ; rend de quoi se désabonner. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;
