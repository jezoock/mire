/**
 * Infos en ligne dans le catalogue (`userData/catalog/metadata.json`) : les fiches des fournisseurs d'infos
 * (`src/main/scrape/`), rangées par clé d'élément. Reprend l'ancien `scrape/db.json` :
 * - au premier démarrage, chaque fiche est rangée sous la clé de son élément (même correspondance que les infos
 *   modifiées à la main, `legacy-meta.ts`). Celles qui ne correspondent à aucun élément (dossier d'album, jeu PC
 *   identifié par son nom, adresse pas encore analysée) sont gardées dans `unmatched`, sous leur ancienne clé ; une
 *   adresse retrouvée par une analyse suivante rejoint son élément (`adopt`). `db.json` est laissé en place, sans plus
 *   être écrit ;
 * - le moteur de récupération lit et écrit toujours sous les anciennes clés (`ScrapeStore`) : recherches en cours,
 *   annulation et interface historique ne changent pas ;
 * - une fiche devient des infos (titre, année, genres, résumé, artiste) et des images (affiche, fond) d'origine
 *   `metadata` (`metadataContributors`) : une contribution par fournisseur, dans l'ordre de la configuration.
 */
import fs from 'node:fs';
import type { CatalogSettings, Element, ElementKey, OpenKind } from '@mire/shared';
import type { ScrapeDb, ScrapeRecord, ScrapeStore } from '../scrape/types.ts';
import { corruptReason, createJsonStore, readJsonFile } from '../storage/json-store.ts';
import { providerRenames } from '../config/migrations/continuity.ts';
import { movedKey } from './keys.ts';
import { legacyTarget, metaToOverride, movedLegacyKey } from './legacy-meta.ts';
import type { MigrationReport } from './overrides.ts';
import type { Contributor } from './tags/engine.ts';
import type { Layer } from './tags/merge.ts';
import { targetsOf } from './targets.ts';

export const METADATA_VERSION = 1;

/** Fournisseurs d'infos du cœur, dans l'ordre par défaut (celui de la récupération groupée) ; TMDB : plugin `mire.tmdb`. */
export const METADATA_PROVIDERS: readonly string[] = ['musicbrainz', 'libretro', 'steam'];

export interface MetadataFile {
  version: number;
  /** Fiches par clé d'élément, puis par clé du fournisseur (`v:<chemin>`…) : un élément peut en avoir plusieurs. */
  elements: Record<ElementKey, Record<string, ScrapeRecord>>;
  /** Fiches qui ne correspondent (encore) à aucun élément, par clé du fournisseur. */
  unmatched: Record<string, ScrapeRecord>;
  /** Dernier échec par clé du fournisseur (nouvel essai au bout de 14 jours). */
  misses: Record<string, number>;
}

export interface MetadataStoreOptions {
  /** `userData/catalog/metadata.json` */
  file: string;
  /** Ancien `userData/scrape/db.json`, repris au premier démarrage. */
  legacyFile?: string;
  platform?: NodeJS.Platform;
  /** Clé de l'élément qui s'ouvre par ce chemin ou cette adresse (`open`), ou `null`. */
  find?: (target: string, kinds: readonly OpenKind[]) => ElementKey | null;
  /** Fichier illisible : écarté (journal par défaut). */
  onIgnored?: (file: string, reason: string) => void;
  /**
   * Fournisseurs devenus des plugins (continuité, P5-01) : source des fiches déjà enregistrées (`tmdb`) → fournisseur
   * du plugin (`mire.tmdb/tmdb`). Ces fiches restent montrées sous le fournisseur du plugin, qui l'emporte dès qu'il en
   * a enregistré une pour le même élément.
   */
  renamed?: Readonly<Record<string, string>>;
}

export type MetadataListener = (keys: ElementKey[]) => void;
type Parts = Omit<Layer, 'origin'>;

const empty = (): MetadataFile => ({ version: METADATA_VERSION, elements: {}, unmatched: {}, misses: {} });
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isRecord = (v: unknown): v is ScrapeRecord => isObject(v);

/** Infos et images tirées d'une fiche (mêmes champs et mêmes conversions que les infos modifiées à la main). */
export function recordParts(r: Readonly<ScrapeRecord>): Parts {
  const { title, year, genre, overview, artist, image, backdrop } = r;
  const fields = Object.fromEntries(Object.entries({ title, year, genre, overview, artist, image, backdrop }).filter(([, v]) => v != null));
  return metaToOverride(fields);
}

/** Fichier relu : ce qui ne s'y lit pas est écarté. */
function readFile(raw: MetadataFile): MetadataFile {
  const out = empty();
  for (const [key, recs] of Object.entries(isObject(raw.elements) ? raw.elements : {})) {
    if (!isObject(recs)) continue;
    const kept = Object.fromEntries(Object.entries(recs).filter(([, r]) => isRecord(r)));
    if (Object.keys(kept).length) out.elements[key] = kept;
  }
  for (const [key, r] of Object.entries(isObject(raw.unmatched) ? raw.unmatched : {})) if (isRecord(r)) out.unmatched[key] = r;
  for (const [key, at] of Object.entries(isObject(raw.misses) ? raw.misses : {})) if (typeof at === 'number') out.misses[key] = at;
  return out;
}

export function createMetadataStore({ file, legacyFile, platform = process.platform, find, onIgnored, renamed = providerRenames() }: MetadataStoreOptions) {
  const ignored = onIgnored ?? ((f: string, reason: string) => console.error(`Catalogue : ${f} écarté (${reason}).`));
  const store = createJsonStore<MetadataFile>(file, {
    defaults: empty,
    debounceMs: 400,
    setAside: true,
    onCorrupt: (err, f, kept) => ignored(f, corruptReason(err, kept)),
  });
  let data = empty();
  // Clé du fournisseur → clé de l'élément qui porte sa fiche.
  const legacyIndex = new Map<string, ElementKey>();
  // Infos et images par élément, puis par fournisseur (`tmdb`…), calculées à la première question.
  const parts = new Map<ElementKey, Map<string, Parts>>();
  const listeners = new Set<MetadataListener>();
  let facade: Record<string, ScrapeRecord> | null = null;

  function save(keys: ElementKey[]): void {
    facade = null;
    for (const key of keys) parts.delete(key);
    store.set(data);
    if (keys.length) for (const listener of listeners) listener(keys);
  }

  /** Clé de l'élément visé par une clé du fournisseur, s'il y en a un. */
  function resolve(legacyKey: string): ElementKey | null {
    const t = legacyTarget(legacyKey, platform);
    return (t.find && find?.(t.find.target, t.find.kinds)) || t.key || null;
  }

  /** Range une fiche sous la clé de son élément, ou sous son ancienne clé ; rend la clé de l'élément. */
  function place(legacyKey: string, record: ScrapeRecord): ElementKey | null {
    const key = legacyIndex.get(legacyKey) ?? resolve(legacyKey);
    if (!key) {
      data.unmatched[legacyKey] = record;
      return null;
    }
    (data.elements[key] ??= {})[legacyKey] = record;
    legacyIndex.set(legacyKey, key);
    delete data.unmatched[legacyKey];
    return key;
  }

  function migrate(raw: ScrapeDb): MigrationReport {
    const report: MigrationReport = { matched: 0, unmatched: [] };
    for (const [legacyKey, r] of Object.entries(isObject(raw.items) ? raw.items : {})) {
      if (!isRecord(r)) continue;
      if (place(legacyKey, r)) report.matched++;
      else report.unmatched.push(legacyKey);
    }
    for (const [legacyKey, at] of Object.entries(isObject(raw.misses) ? raw.misses : {})) if (typeof at === 'number') data.misses[legacyKey] = at;
    return report;
  }

  function reindex(): void {
    legacyIndex.clear();
    parts.clear();
    for (const [key, recs] of Object.entries(data.elements)) for (const legacyKey of Object.keys(recs)) legacyIndex.set(legacyKey, key);
    facade = null;
  }

  /** Vue du moteur de récupération, sous les clés des fournisseurs. */
  const scrapeStore: ScrapeStore = {
    get(legacyKey) {
      const key = legacyIndex.get(legacyKey);
      return key ? data.elements[key]?.[legacyKey] : data.unmatched[legacyKey];
    },
    set(legacyKey, record) {
      delete data.misses[legacyKey];
      const key = place(legacyKey, record);
      save(key ? [key] : []);
    },
    remove(legacyKey) {
      delete data.misses[legacyKey];
      delete data.unmatched[legacyKey];
      const key = legacyIndex.get(legacyKey);
      if (key && data.elements[key]) {
        delete data.elements[key][legacyKey];
        if (!Object.keys(data.elements[key]).length) delete data.elements[key];
      }
      legacyIndex.delete(legacyKey);
      save(key ? [key] : []);
    },
    missedAt: (legacyKey) => data.misses[legacyKey],
    miss(legacyKey, at) {
      data.misses[legacyKey] = at;
      save([]);
    },
    all() {
      if (facade) return facade;
      const out: Record<string, ScrapeRecord> = {};
      for (const recs of Object.values(data.elements)) Object.assign(out, recs);
      Object.assign(out, data.unmatched);
      return (facade = out);
    },
    clear() {
      const keys = Object.keys(data.elements);
      data = empty();
      reindex();
      save(keys);
    },
    flush: () => store.flush(),
  };

  return {
    scrapeStore,

    /**
     * Lit `metadata.json`. Absent, et `db.json` présent : reprend ses fiches (premier démarrage après la mise à
     * jour). À appeler une fois le catalogue lu, pour retrouver les éléments par leur adresse.
     */
    load(): MigrationReport | null {
      const exists = fs.existsSync(file);
      data = readFile(store.load());
      // Fichier illisible mis de côté : un fichier vide le remplace tout de suite, pour que l'ancien fichier de
      // l'interface historique ne soit pas repris une seconde fois au démarrage suivant.
      if (exists && !fs.existsSync(file)) store.set(data);
      let report: MigrationReport | null = null;
      if (!exists && legacyFile && fs.existsSync(legacyFile)) {
        try {
          const raw = readJsonFile(legacyFile) as ScrapeDb | null;
          if (raw) {
            report = migrate(raw);
            store.set(data);
          }
        } catch (err) {
          ignored(legacyFile, (err as Error).message);
        }
      }
      reindex();
      return report;
    },

    /** Infos et images d'un élément, par fournisseur (`tmdb`, `musicbrainz`…). */
    forElement(key: ElementKey): ReadonlyMap<string, Parts> | undefined {
      const recs = data.elements[key];
      if (!recs) return undefined;
      let found = parts.get(key);
      if (!found) {
        found = new Map();
        // Deux fiches du même fournisseur (même fichier écrit autrement) : la première l'emporte ; une fiche du
        // plugin l'emporte sur celle de l'ancien fournisseur qu'il reprend.
        const old = new Map<string, Parts>();
        for (const r of Object.values(recs)) {
          const source = String(r.source ?? '').toLowerCase();
          const provider = Object.hasOwn(renamed, source) ? renamed[source] : source;
          const target = provider === source ? found : old;
          if (!target.has(provider)) target.set(provider, recordParts(r));
        }
        for (const [provider, parts] of old) if (!found.has(provider)) found.set(provider, parts);
        parts.set(key, found);
      }
      return found;
    },

    /** Fiches gardées sous leur ancienne clé. */
    unmatched: (): string[] => Object.keys(data.unmatched),

    /**
     * Éléments arrivés dans le catalogue : les fiches gardées sous une adresse qui les désigne les rejoignent.
     * Rend les clés des éléments concernés.
     */
    adopt(elements: Iterable<Readonly<Element>>): ElementKey[] {
      const pending = new Map<string, { legacyKey: string; kinds: readonly OpenKind[] }[]>();
      for (const legacyKey of Object.keys(data.unmatched)) {
        const t = legacyTarget(legacyKey, platform).find;
        if (!t) continue;
        const list = pending.get(t.target);
        if (list) list.push({ legacyKey, kinds: t.kinds });
        else pending.set(t.target, [{ legacyKey, kinds: t.kinds }]);
      }
      if (!pending.size) return [];
      const moved = new Set<ElementKey>();
      for (const e of elements) {
        for (const hit of targetsOf(e).flatMap((target) => pending.get(target) ?? [])) {
          if (!hit.kinds.includes(e.open.kind) || !data.unmatched[hit.legacyKey]) continue;
          place(hit.legacyKey, data.unmatched[hit.legacyKey]);
          moved.add(e.key);
        }
      }
      if (moved.size) save([...moved]);
      return [...moved];
    },

    /**
     * Fichier ou dossier renommé ou déplacé de `from` vers `to` (P2-10) : ses fiches, et celles de tout ce qu'il
     * contient, passent sous les nouvelles clés d'éléments et de fournisseurs (une fiche restée à l'arrivée, d'un
     * ancien fichier, est remplacée). Rend les clés d'éléments touchées (anciennes et nouvelles).
     */
    movePath(from: string, to: string): ElementKey[] {
      const touched: ElementKey[] = [];
      const moved: [ElementKey, Record<string, ScrapeRecord>][] = [];
      const rename = <T>(rec: Record<string, T>): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [legacyKey, v] of Object.entries(rec)) out[movedLegacyKey(legacyKey, from, to, platform) ?? legacyKey] = v;
        return out;
      };
      for (const [key, recs] of Object.entries(data.elements)) {
        const next = movedKey(key, from, to, platform);
        if (!next) continue;
        delete data.elements[key];
        moved.push([next, rename(recs)]);
        touched.push(key, next);
      }
      for (const [key, recs] of moved) data.elements[key] = recs;
      data.unmatched = rename(data.unmatched);
      data.misses = rename(data.misses);
      reindex();
      save(touched);
      return touched;
    },

    /** Abonnement aux fiches modifiées (clés des éléments concernés). */
    onChange(listener: MetadataListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    flush: () => store.flush(),
  };
}

export type MetadataStore = ReturnType<typeof createMetadataStore>;

/** Fournisseurs connus sans plugin actif : ceux du cœur, puis ceux qui reprennent des fiches déjà enregistrées. */
export const defaultKnown = (): string[] => [...new Set([...METADATA_PROVIDERS, ...Object.values(providerRenames())])];

/** Ordre des fournisseurs : ceux de la configuration (`catalog.metadataProviders`), puis les autres. */
export function metadataOrder(settings: CatalogSettings | undefined, known: readonly string[] = defaultKnown()): string[] {
  const chosen = (settings?.metadataProviders ?? []).filter((id) => known.includes(id));
  return [...new Set([...chosen, ...known])];
}

/** Une contribution d'origine `metadata` par fournisseur, dans l'ordre donné (le premier l'emporte). */
export function metadataContributors(store: Pick<MetadataStore, 'forElement'>, order: readonly string[]): Contributor[] {
  return order.map((provider): Contributor => ({
    id: `metadata:${provider}`,
    origin: 'metadata',
    compute: (e) => store.forElement(e.key)?.get(provider) ?? null,
  }));
}
