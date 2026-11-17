/**
 * Service des données d'usage (`usage.json`) : seul détenteur, dans le processus principal, de « Reprendre », des
 * positions de reprise des vidéos, du volume et des recherches récentes (décision D-06).
 * Les écritures sont différées et regroupées : la position de reprise, envoyée toutes les 5 s pendant la lecture,
 * et le volume, envoyé à chaque cran du curseur, ne donnent pas une écriture sur le disque chacun.
 */
import type { RecentEntry, UsageData, UsageSnapshot } from '@mire/shared/ipc';
import { createJsonStore } from '../storage/json-store.ts';
import * as rules from './rules.ts';

export interface UsageServiceOptions {
  /** Chemin de `usage.json` (`dataPaths(...).usage`). */
  file: string;
  /** Délai de regroupement des écritures (1 s par défaut). */
  debounceMs?: number;
  /** Message d'erreur (fichier illisible) ; `console.error` par défaut. */
  log?: (message: string) => void;
  /** Règle des clés d'éléments (celle de Mire par défaut ; paramètre pour les tests). */
  platform?: NodeJS.Platform;
}

export interface UsageService {
  readonly file: string;
  load(): UsageData;
  get(): UsageData;
  /** Ce que l'interface lit au démarrage. */
  snapshot(): UsageSnapshot;
  addRecent(entry: unknown): RecentEntry[];
  removeRecent(path: string): RecentEntry[];
  resume(path: string): number;
  saveResume(path: string, time: number, duration: number): boolean;
  clearResume(path: string): boolean;
  setVolume(volume: unknown): number;
  addQuery(query: unknown): string[];
  clearQueries(): boolean;
  /** Remplace tout (import « remplacer »). */
  replace(data: unknown): UsageData;
  /** Complète sans doublon (import « compléter »). */
  merge(data: unknown): UsageData;
  /** Reprend les valeurs du `localStorage` d'une version précédente. */
  migrate(legacy: unknown): UsageData;
  /** Fichier ou dossier renommé ou déplacé par Mire : positions et « Reprendre » le suivent (`rules.movePath`). */
  movePath(from: string, to: string): void;
  /** Écrit tout de suite ce qui attend (fermeture de l'application). */
  flush(): Promise<void>;
}

export function createUsageService({ file, debounceMs = 1000, log = (m) => console.error(m), platform = process.platform }: UsageServiceOptions): UsageService {
  const store = createJsonStore<UsageData>(file, {
    defaults: rules.emptyUsage,
    debounceMs,
    space: 1,
    onCorrupt: (err) => log(`Données d'usage illisibles (${file}) : ${err.message}`),
  });
  let current = rules.emptyUsage();

  function commit(next: UsageData): UsageData {
    current = next;
    store.set(next);
    return next;
  }
  const patch = (changes: Partial<UsageData>) => commit({ ...current, ...changes });

  return {
    file,
    load() {
      const raw = store.load();
      current = rules.normalizeUsage(raw, platform);
      // Fichier d'avant P2-11 (positions rangées par chemin, « Reprendre » sans clé) : réécrit une fois, rattaché.
      if (JSON.stringify(raw) !== JSON.stringify(current)) store.set(current);
      return current;
    },
    get: () => current,
    snapshot: () => ({ recent: current.recent, volume: current.volume, queries: current.queries }),
    addRecent: (entry) => patch({ recent: rules.addRecent(current.recent, entry, platform) }).recent,
    removeRecent: (path) => patch({ recent: rules.removeRecent(current.recent, path) }).recent,
    resume: (path) => current.resume[rules.resumeId(path, platform)] ?? 0,
    saveResume(path, time, duration) {
      if (typeof path !== 'string' || !path) return true;
      const id = rules.resumeId(path, platform);
      const resume = rules.resumeAfter(current.resume, id, time, duration);
      if (resume[id] !== current.resume[id]) patch({ resume });
      return true;
    },
    clearResume(path) {
      const id = typeof path === 'string' && path ? rules.resumeId(path, platform) : '';
      if (!id || !Object.hasOwn(current.resume, id)) return true;
      const { [id]: _gone, ...resume } = current.resume;
      patch({ resume });
      return true;
    },
    setVolume(volume) {
      const next = rules.normalizeVolume(volume, current.volume);
      if (next !== current.volume) patch({ volume: next });
      return next;
    },
    addQuery: (query) => patch({ queries: rules.addQuery(current.queries, query) }).queries,
    clearQueries: () => (patch({ queries: [] }), true),
    replace: (data) => commit(rules.normalizeUsage(data, platform)),
    merge: (data) => commit(rules.mergeUsage(current, rules.normalizeUsage(data, platform))),
    migrate: (legacy) => commit(rules.mergeLegacy(current, rules.isObject(legacy) ? legacy : {}, platform)),
    movePath(from, to) {
      const next = rules.movePath(current, from, to, platform);
      if (next !== current) commit(next);
    },
    flush: () => store.flush(),
  };
}
