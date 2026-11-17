/**
 * Règles des données d'usage, en fonctions pures : bornes de « Reprendre » et des recherches, positions de reprise,
 * lecture tolérante d'un contenu reçu (fichier, interface, import), fusion de l'import « compléter » et reprise des
 * valeurs laissées dans le `localStorage` par une version précédente. Mêmes règles que l'ancien renderer.
 */
import path from 'node:path';
import { fold, isHttpUrl } from '@mire/shared';
import type { LegacyUsage, RecentEntry, UsageData } from '@mire/shared/ipc';
import { isSameOrUnder, keyGenre, localFileKey, movedKey, remoteFileKey } from '../catalog/keys.ts';

export const RECENT_MAX = 18;
export const QUERIES_MAX = 10;
export const DEFAULT_VOLUME = 0.9;
/** Une position n'est gardée qu'après 30 s de lecture… */
export const RESUME_MIN = 30;
/** … et plus de 90 s avant la fin ; les vidéos de moins de 5 min n'en ont pas. */
export const RESUME_END_MARGIN = 90;
export const RESUME_MIN_DURATION = 300;

const RECENT_KEYS = ['path', 'name', 'kind', 'ext', 'cover', 'fanart', 'native', 'folder', 'dir', 'remote'] as const;

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const emptyUsage = (): UsageData => ({ recent: [], resume: {}, volume: DEFAULT_VOLUME, queries: [] });

/**
 * Clé d'élément d'un chemin de « Reprendre » ou d'une position de reprise (P2-11) : `remote:` pour une adresse web,
 * `local:` pour un chemin absolu (dont un partage réseau). Une clé `local:`/`remote:` est rendue telle quelle (données
 * déjà rattachées). `null` pour le reste (lien magnet, adresse d'un autre protocole, chemin relatif).
 */
export function usageKey(target: string, platform: NodeJS.Platform = process.platform): string | null {
  const genre = keyGenre(target);
  if (genre === 'local' || genre === 'remote') return target;
  if (isHttpUrl(target)) return remoteFileKey(target);
  const absolute = platform === 'win32' ? path.win32.isAbsolute(target) : path.posix.isAbsolute(target);
  return absolute ? localFileKey(target, platform) : null;
}

/** Nom sous lequel ranger la position de reprise d'un chemin : sa clé, ou le chemin lui-même s'il n'en a pas. */
export const resumeId = (target: string, platform: NodeJS.Platform = process.platform): string => usageKey(target, platform) ?? target;

/** Entrée de « Reprendre » limitée aux champs utiles, avec sa clé ; `null` sans chemin. */
export function recentEntry(raw: unknown, platform: NodeJS.Platform = process.platform): RecentEntry | null {
  if (!isObject(raw) || typeof raw.path !== 'string' || !raw.path) return null;
  const entry = Object.fromEntries(RECENT_KEYS.map((k) => [k, raw[k] ?? null])) as unknown as RecentEntry;
  entry.key = usageKey(raw.path, platform);
  return entry;
}

/** Ajoute en tête (une seule fois par chemin), 18 au plus. */
export function addRecent(list: RecentEntry[], raw: unknown, platform: NodeJS.Platform = process.platform): RecentEntry[] {
  const entry = recentEntry(raw, platform);
  if (!entry) return list;
  return [entry, ...list.filter((x) => x.path !== entry.path)].slice(0, RECENT_MAX);
}

export const removeRecent = (list: RecentEntry[], path: string): RecentEntry[] => list.filter((x) => x.path !== path);

/** Ajoute une recherche en tête ; une recherche déjà là (sans tenir compte des accents ni de la casse) remonte. */
export function addQuery(list: string[], query: unknown): string[] {
  if (typeof query !== 'string' || !query) return list;
  return [query, ...list.filter((x) => fold(x) !== fold(query))].slice(0, QUERIES_MAX);
}

/**
 * Positions de reprise après la lecture de `path` jusqu'à `time` : gardée entre 30 s et la fin moins 90 s,
 * effacée sinon. Une durée inconnue ou une vidéo de moins de 5 min ne change rien.
 */
export function resumeAfter(resume: Record<string, number>, path: string, time: number, duration: number): Record<string, number> {
  if (typeof path !== 'string' || !path || !Number.isFinite(duration) || duration < RESUME_MIN_DURATION) return resume;
  const next = { ...resume };
  if (Number.isFinite(time) && time > RESUME_MIN && time < duration - RESUME_END_MARGIN) next[path] = Math.floor(time);
  else delete next[path];
  return next;
}

export function normalizeVolume(raw: unknown, fallback = DEFAULT_VOLUME): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? clamp(v, 0, 1) : fallback;
}

function normalizeRecent(raw: unknown, platform: NodeJS.Platform): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduceRight<RecentEntry[]>((list, item) => addRecent(list, item, platform), []);
}

function normalizeQueries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduceRight<string[]>((list, q) => addQuery(list, q), []);
}

/**
 * Positions de reprise rangées par clé d'élément (une position rangée par chemin, d'avant P2-11, y passe). Deux
 * chemins de même clé (casse différente sous Windows) : la plus grande position est gardée.
 */
function normalizeResume(raw: unknown, platform: NodeJS.Platform): Record<string, number> {
  if (!isObject(raw)) return {};
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    const t = Math.floor(Number(value));
    if (!name || !Number.isFinite(t) || t <= 0) continue;
    const id = resumeId(name, platform);
    out[id] = Math.max(out[id] ?? 0, t);
  }
  return out;
}

/** Données d'usage complètes et valides, quel que soit le contenu reçu ; rattachées aux clés d'éléments. */
export function normalizeUsage(raw: unknown, platform: NodeJS.Platform = process.platform): UsageData {
  const data = isObject(raw) ? raw : {};
  return {
    recent: normalizeRecent(data.recent, platform),
    resume: normalizeResume(data.resume, platform),
    volume: normalizeVolume(data.volume),
    queries: normalizeQueries(data.queries),
  };
}

/**
 * Import « compléter » : ajoute ce qui manque sans doublon. « Reprendre » par chemin et recherches par texte, à la
 * suite des existants (bornes respectées) ; une position de reprise existante est gardée ; le volume ne change pas.
 */
export function mergeUsage(base: UsageData, extra: UsageData): UsageData {
  const known = new Set(base.recent.map((x) => x.path));
  const knownQueries = new Set(base.queries.map(fold));
  return {
    recent: [...base.recent, ...extra.recent.filter((x) => !known.has(x.path))].slice(0, RECENT_MAX),
    resume: { ...extra.resume, ...base.resume },
    volume: base.volume,
    queries: [...base.queries, ...extra.queries.filter((q) => !knownQueries.has(fold(q)))].slice(0, QUERIES_MAX),
  };
}

/** Reprise du `localStorage` d'une version précédente : comme « compléter », mais le volume réglé alors est repris. */
export function mergeLegacy(base: UsageData, legacy: LegacyUsage, platform: NodeJS.Platform = process.platform): UsageData {
  const extra = normalizeUsage(legacy, platform);
  return { ...mergeUsage(base, extra), volume: normalizeVolume(legacy?.volume, base.volume) };
}

/** Chemin `p` une fois `from` renommé ou déplacé en `to` (fichier ou dossier) ; `null` s'il n'est pas dessous. */
function movedFilePath(p: string, from: string, to: string, platform: NodeJS.Platform): string | null {
  if (!isSameOrUnder(p, from, platform)) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const rest = paths.relative(from, p);
  return rest ? paths.join(to, rest) : to;
}

/**
 * Données d'usage après le renommage ou le déplacement de `from` vers `to` par Mire (P2-10, comme `movedKey`) : les
 * positions de reprise rangées sous la clé d'un fichier concerné et les entrées de « Reprendre » (chemin et clé)
 * passent sous le nouveau chemin. Le reste de l'entrée (nom, image…) est gardé tel quel. Rend `data` s'il n'y a rien
 * à changer.
 */
export function movePath(data: UsageData, from: string, to: string, platform: NodeJS.Platform = process.platform): UsageData {
  let changed = false;
  const resume: Record<string, number> = {};
  for (const [id, t] of Object.entries(data.resume)) {
    const next = movedKey(id, from, to, platform);
    if (next) changed = true;
    // La position du fichier déplacé l'emporte sur une ancienne restée sous la nouvelle clé.
    if (next || !Object.hasOwn(resume, id)) resume[next ?? id] = t;
  }
  const recent = data.recent.map((entry) => {
    const next = entry.key && movedKey(entry.key, from, to, platform) ? movedFilePath(entry.path, from, to, platform) : null;
    if (!next) return entry;
    changed = true;
    return { ...entry, path: next, key: usageKey(next, platform) };
  });
  if (!changed) return data;
  // Une entrée déjà là sous le nouveau chemin : la plus récente (la première) reste.
  return { ...data, resume, recent: recent.filter((x, i) => recent.findIndex((y) => y.path === x.path) === i) };
}
