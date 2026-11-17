/**
 * Règles des clés stables des éléments du catalogue, une par genre d'élément actuel.
 *
 * Une clé est `<genre>:<partie>[|<partie>…]`. Elle ne dépend jamais du rang d'un élément ni d'un nom affiché : seulement
 * de ce qui l'identifie durablement (chemin, adresse, identifiant attribué une fois pour toutes dans la configuration).
 * Chaque genre a un nombre de parties fixe. Dans toutes les parties sauf la dernière, `%` et `|` sont échappés (`%25`,
 * `%7C`) : deux suites de parties différentes ne donnent jamais la même clé, et la dernière partie (souvent un chemin
 * ou une adresse) reste telle quelle, lisible.
 *
 * Chemins : la plateforme est passée explicitement (par défaut, celle de Mire), pour que la règle soit la même quel
 * que soit le système qui exécute les tests. Sous Windows, le chemin est sans casse et ses séparateurs deviennent `/`.
 */
import path from 'node:path';
import { isHttpUrl, isUrlTarget } from '@mire/shared';
import type { ElementKey } from '@mire/shared';

/** Préfixe de chaque genre d'élément. */
export const KEY_PREFIX = {
  /** Fichier local ou d'un partage réseau. */
  local: 'local',
  /** Fichier d'un serveur web (page d'index). */
  remote: 'remote',
  /** Entrée d'une liste de lecture M3U. */
  m3u: 'm3u',
  /** Jeu de console. */
  rom: 'rom',
  /** Jeu PC (trouvé dans un dossier ou ajouté à la main). */
  pc: 'pc',
  /** Chaîne de télévision. */
  tv: 'tv',
  /** Site de streaming. */
  site: 'web',
  /** Marque-page d'une page de streaming. */
  bookmark: 'bm',
  /** Marque-page d'un jeu à télécharger. */
  gameBookmark: 'gamebm',
} as const;

export type KeyGenre = keyof typeof KEY_PREFIX;

const escapePart = (s: string) => s.replace(/%/g, '%25').replace(/\|/g, '%7C');

function required(value: unknown, what: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`Clé d’élément : ${what} manquant.`);
  return s;
}

/** Assemble une clé à partir de son genre et de ses parties. */
export function joinKey(genre: KeyGenre, ...parts: string[]): ElementKey {
  const last = parts.length - 1;
  return `${KEY_PREFIX[genre]}:${parts.map((p, i) => (i < last ? escapePart(p) : p)).join('|')}`;
}

/** Genre d'une clé (`null` pour un préfixe inconnu). */
export function keyGenre(key: string): KeyGenre | null {
  const prefix = key.slice(0, key.indexOf(':'));
  const found = Object.entries(KEY_PREFIX).find(([, p]) => p === prefix);
  return found ? (found[0] as KeyGenre) : null;
}

/**
 * Chemin sous sa forme de clé : normalisé (`.` et `..` résolus, séparateurs doublés retirés, pas de séparateur
 * final) ; sous Windows, en minuscules et avec des `/`.
 */
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
  const s = required(p, 'chemin');
  if (platform === 'win32') {
    const n = path.win32.normalize(s).replace(/\\/g, '/').toLowerCase();
    // Racine d'un lecteur (« c:/ ») ou d'un partage (« //nas/films/ ») : on retire seulement le séparateur final.
    return n.length > 1 && n.endsWith('/') && !/^[a-z]:\/$/.test(n) ? n.slice(0, -1) : n;
  }
  const n = path.posix.normalize(s);
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
}

/** Adresse sous sa forme de clé : forme canonique de `URL` (schéma et hôte en minuscules, port par défaut retiré), sans fragment. */
export function normalizeUrl(u: string): string {
  const s = required(u, 'adresse');
  try {
    const url = new URL(s);
    url.hash = '';
    return url.href;
  } catch {
    return s;
  }
}

/** Chemin ou adresse : chacun selon sa règle. */
export function normalizeLocation(loc: string, platform: NodeJS.Platform = process.platform): string {
  return isHttpUrl(loc) ? normalizeUrl(loc) : normalizePath(loc, platform);
}

/** Fichier local ou d'un partage réseau : `local:/films/Intouchables.mkv`, `local:c:/films/intouchables.mkv`. */
export const localFileKey = (file: string, platform: NodeJS.Platform = process.platform): ElementKey => joinKey('local', normalizePath(file, platform));

/** Fichier d'un serveur web : `remote:https://nas.local/films/a.mkv`. */
export const remoteFileKey = (url: string): ElementKey => joinKey('remote', normalizeUrl(url));

/** Fichier de la bibliothèque, local ou sur un serveur web, d'après son chemin. */
export const fileKey = (target: string, platform: NodeJS.Platform = process.platform): ElementKey =>
  isHttpUrl(target) ? remoteFileKey(target) : localFileKey(target, platform);

/**
 * Entrée d'une liste M3U : la liste (adresse ou fichier) et l'adresse du flux. Deux entrées de la même liste qui
 * pointent vers le même flux sont le même élément.
 */
export const m3uEntryKey = (playlist: string, url: string, platform: NodeJS.Platform = process.platform): ElementKey =>
  joinKey('m3u', normalizeLocation(playlist, platform), normalizeUrl(url));

/** Jeu de console : identifiant de la console (`Emulator.id`, stable depuis la migration v6) et fichier ou adresse du jeu. */
export const romKey = (consoleId: string, file: string, platform: NodeJS.Platform = process.platform): ElementKey =>
  joinKey('rom', required(consoleId, 'console'), normalizeLocation(file, platform));

/**
 * Jeu PC : chemin du programme ou du raccourci, ou adresse d'un lanceur (`steam://rungameid/…`, gardée telle quelle).
 * Un jeu ajouté à la main et le même jeu trouvé dans un dossier ont la même clé (la position dans `config.games` n'y
 * entre pas).
 */
export function pcGameKey(file: string, platform: NodeJS.Platform = process.platform): ElementKey {
  const target = required(file, 'programme');
  return joinKey('pc', isUrlTarget(target) ? target : normalizePath(target, platform));
}

/** Ce qui identifie une chaîne de télévision : son numéro, sinon les adresses de ses flux. */
export interface ChannelIdentity {
  number: number | null;
  urls: string[];
}

/**
 * Chaîne de télévision : service (`TvService.id`) et numéro de la chaîne chez ce service. Sans numéro, la plus
 * petite adresse de ses flux (dans l'ordre alphabétique : l'ordre de la liste n'y entre pas).
 */
export function tvChannelKey(serviceId: string, channel: ChannelIdentity): ElementKey {
  const service = required(serviceId, 'service');
  if (channel.number != null && Number.isFinite(channel.number)) return joinKey('tv', service, String(channel.number));
  const urls = channel.urls.map((u) => normalizeUrl(u)).sort();
  return joinKey('tv', service, required(urls[0], 'adresse de la chaîne'));
}

/** Site de streaming : `web:netflix` (`WebSite.id`). */
export const siteKey = (siteId: string): ElementKey => joinKey('site', required(siteId, 'site'));

/** Marque-page d'une page de streaming (`Bookmark.id`). */
export const bookmarkKey = (id: string): ElementKey => joinKey('bookmark', required(id, 'marque-page'));

/** Marque-page d'un jeu à télécharger (`GameBookmark.id`). */
export const gameBookmarkKey = (id: string): ElementKey => joinKey('gameBookmark', required(id, 'marque-page'));

/** Chemin `p` (déjà sous sa forme de clé) une fois `from` devenu `to`, ou `null` s'il n'est pas `from` ni dessous. */
function movedNormalized(p: string, from: string, to: string): string | null {
  if (p === from) return to;
  return p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : null;
}

/**
 * Clé d'un élément après le renommage ou le déplacement de `from` (fichier ou dossier) vers `to` : fichier local,
 * jeu de console ou jeu PC dont le chemin est `from` ou dessous. `null` pour toute autre clé (rien ne change).
 */
export function movedKey(key: string, from: string, to: string, platform: NodeJS.Platform = process.platform): ElementKey | null {
  const genre = keyGenre(key);
  if (genre !== 'local' && genre !== 'rom' && genre !== 'pc') return null;
  const body = key.slice(key.indexOf(':') + 1);
  // Jeu de console : la console (échappée, sans `|`) puis le chemin.
  const cut = genre === 'rom' ? body.indexOf('|') + 1 : 0;
  if (genre === 'rom' && cut === 0) return null;
  const p = body.slice(cut);
  if (isUrlTarget(p) || isHttpUrl(p)) return null;
  const next = movedNormalized(p, normalizePath(from, platform), normalizePath(to, platform));
  return next === null ? null : `${key.slice(0, key.indexOf(':') + 1)}${body.slice(0, cut)}${next}`;
}

/** Vrai si le chemin `p` est `from` ou se trouve dessous (comparés sous leur forme de clé). */
export function isSameOrUnder(p: string, from: string, platform: NodeJS.Platform = process.platform): boolean {
  return movedNormalized(normalizePath(p, platform), normalizePath(from, platform), '') !== null;
}
