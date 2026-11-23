/**
 * Packs de données des plugins actifs (contribution `packs`, P5-07). Un pack est un fichier JSON dont le champ `kind`
 * dit à quoi il sert ; le cœur lit deux usages, les autres packs (chaînes de télévision, P5-06…) ajoutent le leur.
 *
 *   { "kind": "romSites",
 *     "systems": { "<système>": [ { "name": "PDRoms", "url": "https://…", "search": "https://…?s={q}" } ] } }
 *
 *   { "kind": "freeGames",
 *     "games": [ { "id": "nova", "name": "…", "system": "nes", "author": "…", "basedOn": "…",
 *                  "url": "https://…", "file": "Nova.nes", "desc": "freeGames.nova.desc" } ] }
 *
 * - `romSites` : sites proposés d'office par « Ajouter des jeux », par système (nom libretro de `SYSTEMS`) ; `search`
 *   (adresse de recherche, `{q}` = les mots cherchés) peut être vide ;
 * - `freeGames` : jeux libres de la boutique ; `desc` est la clé d'un texte du plugin (`pluginTexts.<plugin>.<clé>`).
 * Toutes les adresses sont en `https:` sans identifiants ; les noms sont du texte brut (jamais interprété comme du
 * HTML : `<` et `>` refusés, comme les caractères de contrôle) ; les nombres d'éléments et les longueurs sont bornés.
 * Un pack mal formé ne donne rien ; un élément mal formé est ignoré.
 */
import type { LinkSite } from '@mire/shared';
import type { FreeGame } from '../store/catalog/types.ts';
import type { ContributionEntry } from './registry.ts';
import { pluginTextPrefix } from './service.ts';

export const MAX_SYSTEMS = 64;
export const MAX_SITES_PER_SYSTEM = 8;
export const MAX_GAMES = 64;
export const MAX_URL_LENGTH = 500;
export const MAX_NAME_LENGTH = 80;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SYSTEM_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,79}$/;
const STORE_SYSTEM_RE = /^[a-z0-9]{1,16}$/;
const TEXT_KEY_RE = /^[A-Za-z0-9_-]{1,32}(?:\.[A-Za-z0-9_-]{1,32}){0,3}$/;
// Nom de fichier simple : ni dossier ni caractère interdit sous Windows, extension courte, ne commence pas par un point.
// eslint-disable-next-line no-control-regex
const FILE_RE = /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]{0,95}\.[A-Za-z0-9]{1,5}$/;
const BAD_TEXT = /[\p{Cc}\p{Cf}<>]/u;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Texte brut court, ou `null`. */
export function checkText(v: unknown, max = MAX_NAME_LENGTH): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max && !BAD_TEXT.test(s) ? s : null;
}

/** Adresse `https:` sans identifiants, ou `null`. */
export function checkHttpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > MAX_URL_LENGTH || /[\s\u0000-\u001f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? v : null;
  } catch {
    return null;
  }
}

function readSite(v: unknown): LinkSite | null {
  if (!isRecord(v)) return null;
  const name = checkText(v.name);
  const url = checkHttpsUrl(v.url);
  if (!name || !url) return null;
  const search = typeof v.search === 'string' && v.search.includes('{q}') ? checkHttpsUrl(v.search) : null;
  return { name, url, search: search ?? '' };
}

/** Sites par système d'un pack `romSites` (`{}` si le pack ne convient pas). */
export function readRomSitesPack(data: unknown): Record<string, LinkSite[]> {
  const out: Record<string, LinkSite[]> = Object.create(null);
  if (!isRecord(data) || data.kind !== 'romSites' || !isRecord(data.systems)) return out;
  for (const [system, list] of Object.entries(data.systems).slice(0, MAX_SYSTEMS)) {
    if (!SYSTEM_RE.test(system) || !Array.isArray(list)) continue;
    const sites = list.slice(0, MAX_SITES_PER_SYSTEM).flatMap((s) => readSite(s) ?? []);
    if (sites.length) out[system] = sites;
  }
  return out;
}

/** Sites proposés pour un système par les plugins actifs, dans l'ordre d'activation (une adresse n'apparaît qu'une fois). */
export function romSitesFor(entries: readonly ContributionEntry[], system: string): LinkSite[] {
  const seen = new Set<string>();
  const out: LinkSite[] = [];
  for (const e of entries) {
    if (e.kind !== 'packs') continue;
    const sites = readRomSitesPack(e.data);
    for (const s of Object.hasOwn(sites, system) ? sites[system] : []) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push({ ...s });
    }
  }
  return out;
}

function readGame(v: unknown, prefix: string): FreeGame | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
  const name = checkText(v.name);
  const author = checkText(v.author);
  const url = checkHttpsUrl(v.url);
  if (!name || !author || !url) return null;
  if (typeof v.system !== 'string' || !STORE_SYSTEM_RE.test(v.system)) return null;
  if (typeof v.file !== 'string' || !FILE_RE.test(v.file) || v.file.includes('..')) return null;
  const game: FreeGame = { id: v.id, name, system: v.system, author, url, file: v.file };
  if (v.basedOn !== undefined) {
    const based = checkText(v.basedOn);
    if (!based) return null;
    game.basedOn = based;
  }
  if (typeof v.desc === 'string' && TEXT_KEY_RE.test(v.desc)) game.descKey = prefix + v.desc;
  return game;
}

/** Jeux libres d'un pack `freeGames` (liste vide si le pack ne convient pas). */
export function readFreeGamesPack(entry: ContributionEntry): FreeGame[] {
  const d = entry.data;
  if (!isRecord(d) || d.kind !== 'freeGames' || !Array.isArray(d.games)) return [];
  const prefix = pluginTextPrefix(entry.pluginId);
  return d.games.slice(0, MAX_GAMES).flatMap((g) => readGame(g, prefix) ?? []);
}

/** Jeux libres des plugins actifs ; à identifiant égal, le premier plugin activé l'emporte. */
export function freeGamesOf(entries: readonly ContributionEntry[]): FreeGame[] {
  const seen = new Set<string>();
  const out: FreeGame[] = [];
  for (const e of entries) {
    if (e.kind !== 'packs') continue;
    for (const g of readFreeGamesPack(e)) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return out;
}
