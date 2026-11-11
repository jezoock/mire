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
  /** Écrit tout de suite ce qui attend (fermeture de l'application). */
  flush(): Promise<void>;
}

export function createUsageService({ file, debounceMs = 1000, log = (m) => console.error(m) }: UsageServiceOptions): UsageService {
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
      current = rules.normalizeUsage(store.load());
      return current;
    },
    get: () => current,
    snapshot: () => ({ recent: current.recent, volume: current.volume, queries: current.queries }),
    addRecent: (entry) => patch({ recent: rules.addRecent(current.recent, entry) }).recent,
    removeRecent: (path) => patch({ recent: rules.removeRecent(current.recent, path) }).recent,
    resume: (path) => current.resume[path] ?? 0,
    saveResume(path, time, duration) {
      const resume = rules.resumeAfter(current.resume, path, time, duration);
      if (resume[path] !== current.resume[path]) patch({ resume });
      return true;
    },
    clearResume(path) {
      if (!Object.hasOwn(current.resume, path)) return true;
      const { [path]: _gone, ...resume } = current.resume;
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
    replace: (data) => commit(rules.normalizeUsage(data)),
    merge: (data) => commit(rules.mergeUsage(current, rules.normalizeUsage(data))),
    migrate: (legacy) => commit(rules.mergeLegacy(current, rules.isObject(legacy) ? legacy : {})),
    flush: () => store.flush(),
  };
}
