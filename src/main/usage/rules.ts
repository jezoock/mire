/**
 * Règles des données d'usage, en fonctions pures : bornes de « Reprendre » et des recherches, positions de reprise,
 * lecture tolérante d'un contenu reçu (fichier, interface, import), fusion de l'import « compléter » et reprise des
 * valeurs laissées dans le `localStorage` par une version précédente. Mêmes règles que l'ancien renderer.
 */
import { fold } from '@mire/shared';
import type { LegacyUsage, RecentEntry, UsageData } from '@mire/shared/ipc';

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

/** Entrée de « Reprendre » limitée aux champs utiles ; `null` sans chemin. */
export function recentEntry(raw: unknown): RecentEntry | null {
  if (!isObject(raw) || typeof raw.path !== 'string' || !raw.path) return null;
  return Object.fromEntries(RECENT_KEYS.map((k) => [k, raw[k] ?? null])) as unknown as RecentEntry;
}

/** Ajoute en tête (une seule fois par chemin), 18 au plus. */
export function addRecent(list: RecentEntry[], raw: unknown): RecentEntry[] {
  const entry = recentEntry(raw);
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

function normalizeRecent(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduceRight<RecentEntry[]>((list, item) => addRecent(list, item), []);
}

function normalizeQueries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.reduceRight<string[]>((list, q) => addQuery(list, q), []);
}

function normalizeResume(raw: unknown): Record<string, number> {
  if (!isObject(raw)) return {};
  const out: Record<string, number> = {};
  for (const [path, value] of Object.entries(raw)) {
    const t = Math.floor(Number(value));
    if (path && Number.isFinite(t) && t > 0) out[path] = t;
  }
  return out;
}

/** Données d'usage complètes et valides, quel que soit le contenu reçu. */
export function normalizeUsage(raw: unknown): UsageData {
  const data = isObject(raw) ? raw : {};
  return {
    recent: normalizeRecent(data.recent),
    resume: normalizeResume(data.resume),
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
export function mergeLegacy(base: UsageData, legacy: LegacyUsage): UsageData {
  const extra = normalizeUsage(legacy);
  return { ...mergeUsage(base, extra), volume: normalizeVolume(legacy?.volume, base.volume) };
}
