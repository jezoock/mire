/**
 * Moteur de récupération d'infos de base et d'une image pour les listes de Mire. Les sources sont des
 * fournisseurs (`MetadataProvider`) : le moteur tient la base des fiches (`ScrapeStore` : celle du catalogue, ou
 * `db.json`), décide de ce qui doit être récupéré (révision, nouvel essai après 14 jours), fait tourner les
 * récupérations avec la concurrence de chaque fournisseur, annonce la progression et gère l'annulation.
 *
 * Les images sont copiées dans <données de Mire>/scrape/img ; rien n'est écrit dans vos dossiers.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FetchLike } from '../net/http.ts';
import { createJsonStore } from '../storage/json-store.ts';
import { dataPaths } from '../storage/paths.ts';
import { createScrapeIo } from './io.ts';
import { ScrapeRefusal } from './refusal.ts';
import type {
  CandidateQuery,
  JobContext,
  ListRoms,
  MetadataProvider,
  ProviderContext,
  RunOptions,
  RunResult,
  ScrapeCandidate,
  ScrapeConfig,
  ScrapeDb,
  ScrapeFacts,
  ScrapeItem,
  ScrapeOverride,
  ScrapeProgress,
  ScrapeRecord,
  ScrapeStore,
} from './types.ts';
import { t } from '../i18n/current.ts';

/** Un titre introuvable est réessayé au bout de 14 jours. */
export const MISS_RETRY_MS = 14 * 24 * 3600 * 1000;
/** Révision des données : les fiches plus anciennes (sans genre ni fond) sont complétées. */
export const REV = 2;

export interface ScrapeEngineDeps {
  dataDir: string;
  getConfig: () => ScrapeConfig;
  listRoms: ListRoms;
  onProgress: (p: ScrapeProgress) => void;
  /** Sources, dans l'ordre où `run` les traite. */
  providers: MetadataProvider[];
  /** Fournisseurs des plugins actifs (contribution `metadata`, P3-04), après les autres ; relus à chaque usage. */
  extraProviders?: () => MetadataProvider[];
  /** Fetch des fournisseurs (tests) ; par défaut le fetch global. */
  fetch?: FetchLike;
  /** Horloge (tests). */
  now?: () => number;
  /** Base des fiches ; par défaut `<données>/scrape/db.json`. */
  store?: ScrapeStore;
}

export interface OneJob {
  kind: string;
  item: ScrapeItem;
  override?: ScrapeOverride;
  /** Clé sous laquelle enregistrer la fiche (marque-page de jeu `b:<id>`), sinon celle de l'élément. */
  key?: string;
}

export interface CandidatesJob extends Partial<CandidateQuery> {
  kind: string;
}

export type CandidatesResult = { ok: true; items: ScrapeCandidate[] } | { ok: false; error: string };

interface Task {
  provider: MetadataProvider;
  item: ScrapeItem;
  key: string;
}

/** Base des fiches dans `db.json` (fichier illisible : on repart de zéro, les infos seront récupérées de nouveau). */
export function createDbFileStore(file: string): ScrapeStore {
  const dbStore = createJsonStore<ScrapeDb>(file, { defaults: { items: {}, misses: {} }, debounceMs: 400 });
  let db = dbStore.load();
  const save = () => dbStore.set(db);
  return {
    get: (key) => db.items[key],
    set(key, record) {
      db.items[key] = record;
      delete db.misses[key];
      save();
    },
    remove(key) {
      delete db.items[key];
      delete db.misses[key];
      save();
    },
    missedAt: (key) => db.misses[key],
    miss(key, at) {
      db.misses[key] = at;
      save();
    },
    all: () => db.items,
    clear() {
      db = { items: {}, misses: {} };
      save();
    },
    flush: () => dbStore.flush(),
  };
}

/** Fait tourner `fn` sur `items`, `limit` à la fois, tant que `go()` est vrai. */
async function pool<T>(items: T[], limit: number, go: () => boolean, fn: (it: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && go()) {
      const it = items[i++];
      try {
        await fn(it);
      } catch (err) {
        console.error('scrape', (err as Error).message);
      }
    }
  });
  await Promise.all(workers);
}

export function createScrapeEngine(deps: ScrapeEngineDeps) {
  const { getConfig, listRoms, onProgress } = deps;
  const all = (): MetadataProvider[] => [...deps.providers, ...(deps.extraProviders?.() ?? [])];
  const now = deps.now || Date.now;
  const { scrapeImg: imgDir, scrapeDb: dbFile, scrapeCache: cacheDir } = dataPaths(deps.dataDir);
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const db = deps.store ?? createDbFileStore(dbFile);

  const state = { running: false, cancel: false };
  const ctx: ProviderContext = {
    getConfig,
    listRoms,
    cacheDir,
    io: createScrapeIo({ imgDir, fetch: deps.fetch }),
    cancelled: () => state.cancel,
  };

  function record(key: string, data: ScrapeFacts): void {
    db.set(key, { ...data, rev: REV, at: now() } as ScrapeRecord);
  }
  function miss(key: string): void {
    db.miss(key, now());
  }
  function wanted(key: string, force?: boolean): boolean {
    if (force) return true;
    const found = db.get(key);
    if (found) return found.rev !== REV;
    const m = db.missedAt(key);
    return !m || now() - m > MISS_RETRY_MS;
  }

  const providerFor = (kind: string) => all().find((p) => p.kinds.includes(kind as never));

  // Récupère et enregistre une fiche ; rend vrai si une fiche a été enregistrée.
  async function scrapeOne(provider: MetadataProvider, item: ScrapeItem, override: ScrapeOverride | undefined, key: string): Promise<boolean> {
    const job: JobContext = { ...ctx, key };
    const found = override?.pick ? await provider.byId(override.pick, item, job) : await provider.scrape(item, override, job);
    if (found) {
      record(key, found);
      return true;
    }
    if (found === null) miss(key);
    return false;
  }

  async function collect(opts: RunOptions, kinds: string[], stats: { skipped: string[] }): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const provider of all()) {
      if (!kinds.includes(provider.group)) continue;
      const missing = provider.requires?.(ctx);
      if (missing) {
        stats.skipped.push(missing.skipped);
        continue;
      }
      for (const item of await provider.collect(opts, ctx)) {
        const key = provider.key(item);
        if (wanted(key, opts.force)) tasks.push({ provider, item, key });
      }
    }
    return tasks;
  }

  async function run(opts: RunOptions = {}): Promise<RunResult> {
    if (state.running) return { ok: false, error: t('scrape.errors.alreadyRunning') };
    state.running = true;
    state.cancel = false;
    const { kinds = ['videos', 'music', 'games'] } = opts;
    const stats = { found: 0, missing: 0, skipped: [] as string[] };
    const tasks = await collect(opts, kinds, stats);
    const total = tasks.length;
    let done = 0;
    onProgress({ running: true, done, total });
    // Chaque source a sa propre cadence : on traite les fournisseurs l'un après l'autre.
    for (const provider of new Set(tasks.map((t) => t.provider))) {
      const group = tasks.filter((t) => t.provider === provider);
      if (!group.length) continue;
      await pool(
        group,
        provider.concurrency,
        () => !state.cancel,
        async (t) => {
          const ok = await scrapeOne(t.provider, t.item, undefined, t.key).catch(() => false);
          if (ok) stats.found += 1;
          else stats.missing += 1;
          done += 1;
          onProgress({ running: true, done, total });
        },
      );
      if (state.cancel) break;
    }
    state.running = false;
    const cancelled = state.cancel;
    onProgress({ running: false, done, total, ...stats, cancelled });
    return { ok: true, total, ...stats, cancelled };
  }

  async function one({ kind, item, override, key }: OneJob): Promise<{ ok: boolean; error?: string }> {
    const provider = providerFor(kind);
    if (!provider) return { ok: false };
    try {
      return { ok: await scrapeOne(provider, item, override, key || provider.key(item)) };
    } catch (err) {
      if (err instanceof ScrapeRefusal) return { ok: false, error: err.message };
      throw err;
    }
  }

  /**
   * Fiche choisie, récupérée sans être enregistrée (regroupements, P4-22) : ses infos, et ses images déjà copiées
   * dans le dossier d'images (nommées d'après `key`). Le catalogue en fait des modifications à la main.
   */
  async function lookup({ kind, item, override, key }: OneJob): Promise<{ ok: true; facts: ScrapeFacts } | { ok: false; error?: string }> {
    const provider = providerFor(kind);
    if (!provider || !override?.pick || !key) return { ok: false };
    try {
      const found = await provider.byId(override.pick, item, { ...ctx, key });
      return found ? { ok: true, facts: found } : { ok: false };
    } catch (err) {
      if (err instanceof ScrapeRefusal) return { ok: false, error: err.message };
      throw err;
    }
  }

  // Toutes les fiches qui correspondent à une recherche, pour laisser choisir la bonne.
  async function candidates({ kind, item, query, year, artist }: CandidatesJob): Promise<CandidatesResult> {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: t('scrape.errors.noTitle') };
    const provider = providerFor(kind);
    if (!provider) return { ok: false, error: t('scrape.errors.unknownType') };
    const missing = provider.requires?.(ctx);
    if (missing) return { ok: false, error: missing.error };
    try {
      return { ok: true, items: await provider.candidates({ item, query: q, year, artist }, ctx) };
    } catch (err) {
      if (err instanceof ScrapeRefusal) return { ok: false, error: err.message };
      throw err;
    }
  }

  return {
    imgDir,
    data: () => db.all(),
    run,
    one,
    lookup,
    candidates,
    cancel: () => {
      state.cancel = true;
      return true;
    },
    running: () => state.running,
    forget(key: string) {
      db.remove(key);
      return true;
    },
    /** Reporte une fiche sur une autre clé (marque-page de jeu → jeu téléchargé), sans écraser une fiche existante. */
    copy(from: string, to: string) {
      const found = db.get(from);
      if (!found || db.get(to)) return false;
      db.set(to, { ...found });
      return true;
    },
    async clear() {
      db.clear();
      for (const f of await fsp.readdir(imgDir).catch(() => [] as string[])) await fsp.unlink(path.join(imgDir, f)).catch(() => {});
      return true;
    },
    flush: () => db.flush(),
  };
}

export type ScrapeEngine = ReturnType<typeof createScrapeEngine>;
