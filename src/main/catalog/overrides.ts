/**
 * Modifications faites à la main (`userData/catalog/overrides.json`) : tags ajoutés ou retirés, infos et images
 * saisies, par clé d'élément, et tags créés par l'utilisateur. Reprend l'ancien `meta/meta.json`
 * (`src/main/meta/user-meta.ts`, devenu une façade) :
 * - au premier démarrage, chaque fiche de `meta.json` est rangée sous la clé de son élément (`legacy-meta.ts`).
 *   Celles qui ne correspondent à aucun élément (dossier d'album, jeu PC identifié par son nom, console, adresse pas
 *   encore analysée) sont gardées telles quelles dans `unmatched`, sous leur ancienne clé ; une adresse retrouvée par
 *   une analyse suivante rejoint son élément (`adopt`). `meta.json` est laissé en place, sans plus être écrit ;
 * - la façade lit et écrit les fiches sous leurs anciennes clés (`legacyAll`, `legacySet`).
 */
import fs from 'node:fs';
import type { Element, ElementKey, InfoValue, OpenKind } from '@mire/shared';
import type { UserMeta } from '@mire/shared/ipc';
import { corruptReason, createJsonStore, readJsonFile } from '../storage/json-store.ts';
import { movedKey } from './keys.ts';
import { FACADE_IMAGES, FACADE_INFOS, legacyTarget, metaToOverride, movedLegacyKey, overrideToMeta } from './legacy-meta.ts';
import type { Override } from './tags/merge.ts';
import { isInfoValue, type UserTag } from './tags/registry.ts';
import { targetsOf } from './targets.ts';

export const OVERRIDES_VERSION = 1;

export interface OverridesFile {
  version: number;
  /** Tags créés par l'utilisateur, par identifiant. */
  tags: Record<string, UserTag>;
  /** Modifications par clé d'élément. */
  elements: Record<ElementKey, Override>;
  /** Fiches de l'ancien `meta.json` qui ne correspondent (encore) à aucun élément, par ancienne clé. */
  unmatched: Record<string, Override>;
}

export interface OverridesOptions {
  /** `userData/catalog/overrides.json` */
  file: string;
  /** Ancien `userData/meta/meta.json`, repris au premier démarrage. */
  legacyFile?: string;
  platform?: NodeJS.Platform;
  /** Clé de l'élément qui s'ouvre par ce chemin ou cette adresse (`open`), ou `null`. */
  find?: (target: string, kinds: readonly OpenKind[]) => ElementKey | null;
  /** Fichier illisible : écarté (journal par défaut). */
  onIgnored?: (file: string, reason: string) => void;
}

/** Bilan de la reprise de `meta.json`. */
export interface MigrationReport {
  /** Fiches rangées sous la clé d'un élément. */
  matched: number;
  /** Fiches gardées sous leur ancienne clé. */
  unmatched: string[];
}

export type OverridesListener = (keys: ElementKey[]) => void;

const empty = (): OverridesFile => ({ version: OVERRIDES_VERSION, tags: {}, elements: {}, unmatched: {} });
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

function isEmpty(o: Override): boolean {
  return !Object.keys(o.tags ?? {}).length && !Object.keys(o.infos ?? {}).length && !Object.keys(o.images ?? {}).length;
}

/** Retire les objets vides d'une modification. */
function tidy(o: Override): Override {
  for (const k of ['tags', 'infos', 'images'] as const) if (o[k] && !Object.keys(o[k]).length) delete o[k];
  return o;
}

/** Remplace les infos et images de la façade (titre, année, genres, résumé, artiste, images). */
function writeFacade(o: Override, parts: Pick<Override, 'infos' | 'images'>): Override {
  const infos = { ...o.infos };
  const images = { ...o.images };
  for (const id of FACADE_INFOS) delete infos[id];
  for (const id of FACADE_IMAGES) delete images[id];
  o.infos = { ...infos, ...parts.infos };
  o.images = { ...images, ...parts.images };
  return tidy(o);
}

/** Fichier relu : ce qui ne s'y lit pas est écarté. */
function readFile(raw: OverridesFile): OverridesFile {
  const out = empty();
  for (const [id, tag] of Object.entries(isObject(raw.tags) ? raw.tags : {}))
    if (isObject(tag) && typeof tag.name === 'string') out.tags[id] = { name: tag.name };
  for (const section of ['elements', 'unmatched'] as const) {
    for (const [key, o] of Object.entries(isObject(raw[section]) ? raw[section] : {})) {
      if (!isObject(o)) continue;
      const next: Override = {};
      if (isObject(o.tags)) next.tags = Object.fromEntries(Object.entries(o.tags).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
      if (isObject(o.infos)) next.infos = Object.fromEntries(Object.entries(o.infos).filter(([, v]) => isInfoValue(v))) as Record<string, InfoValue>;
      if (isObject(o.images)) next.images = Object.fromEntries(Object.entries(o.images).filter(([, v]) => typeof v === 'string' && v));
      if (typeof o.legacy === 'string') next.legacy = o.legacy;
      out[section][key] = tidy(next);
    }
  }
  return out;
}

export function createOverrides({ file, legacyFile, platform = process.platform, find, onIgnored }: OverridesOptions) {
  const ignored = onIgnored ?? ((f: string, reason: string) => console.error(`Catalogue : ${f} écarté (${reason}).`));
  const store = createJsonStore<OverridesFile>(file, {
    defaults: empty,
    space: 2,
    setAside: true,
    onCorrupt: (err, f, kept) => ignored(f, corruptReason(err, kept)),
  });
  let data = empty();
  // Ancienne clé → clé de l'élément qui porte sa fiche.
  const legacyIndex = new Map<string, ElementKey>();
  const listeners = new Set<OverridesListener>();
  let facade: Record<string, UserMeta> | null = null;

  function save(keys: ElementKey[]): void {
    facade = null;
    store.set(data);
    if (keys.length) for (const listener of listeners) listener(keys);
  }

  /** Clé de l'élément visé par une ancienne clé, s'il y en a un. */
  function resolve(legacyKey: string): ElementKey | null {
    const t = legacyTarget(legacyKey, platform);
    return (t.find && find?.(t.find.target, t.find.kinds)) || t.key || null;
  }

  /** Range une fiche de l'ancien format sous la clé de son élément, ou sous son ancienne clé. */
  function place(legacyKey: string, parts: Pick<Override, 'infos' | 'images'>): ElementKey | null {
    const key = resolve(legacyKey);
    const there = key ? data.elements[key] : undefined;
    // Deux anciennes clés pour un même élément (même fichier écrit autrement) : la seconde reste à part.
    if (key && !(there?.legacy && there.legacy !== legacyKey)) {
      data.elements[key] = writeFacade({ ...there, legacy: legacyKey }, parts);
      legacyIndex.set(legacyKey, key);
      delete data.unmatched[legacyKey];
      return key;
    }
    data.unmatched[legacyKey] = writeFacade(data.unmatched[legacyKey] ?? {}, parts);
    return null;
  }

  function migrate(raw: Record<string, unknown>): MigrationReport {
    const report: MigrationReport = { matched: 0, unmatched: [] };
    for (const [legacyKey, meta] of Object.entries(raw)) {
      if (!isObject(meta)) continue;
      if (place(legacyKey, metaToOverride(meta))) report.matched++;
      else report.unmatched.push(legacyKey);
    }
    return report;
  }

  function change(key: ElementKey, edit: (o: Override) => void): void {
    const o = data.elements[key] ?? {};
    edit(o);
    tidy(o);
    // Une modification vide garde sa place tant qu'elle relie une ancienne clé (la façade la retrouve).
    if (isEmpty(o) && !o.legacy) delete data.elements[key];
    else data.elements[key] = o;
    save([key]);
  }

  return {
    /**
     * Lit `overrides.json`. Absent, et `meta.json` présent : reprend ses fiches (premier démarrage après la mise à
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
          const raw = readJsonFile(legacyFile);
          if (raw) {
            report = migrate(raw);
            store.set(data);
          }
        } catch (err) {
          ignored(legacyFile, (err as Error).message);
        }
      }
      legacyIndex.clear();
      for (const [key, o] of Object.entries(data.elements)) if (o.legacy) legacyIndex.set(o.legacy, key);
      facade = null;
      return report;
    },

    /** Modifications d'un élément (lecture seule). */
    get: (key: ElementKey): Readonly<Override> | undefined => data.elements[key],

    /** Clés des éléments modifiés à la main. */
    keys: (): ElementKey[] => Object.keys(data.elements),

    /** Fiches gardées sous leur ancienne clé. */
    unmatched: (): string[] => Object.keys(data.unmatched),

    userTags: (): Record<string, UserTag> => data.tags,

    /** Crée un tag de l'utilisateur (sans effet s'il existe). */
    addUserTag(id: string, name: string): void {
      if (Object.hasOwn(data.tags, id)) return;
      data.tags[id] = { name };
      save([]);
    },

    /** Tags d'un élément : `true` ajouté, `false` retiré, `null` revient à l'automatique. */
    setTags(key: ElementKey, changes: Record<string, boolean | null>): void {
      change(key, (o) => {
        const tags = { ...o.tags };
        for (const [id, on] of Object.entries(changes)) {
          if (on === null) delete tags[id];
          else tags[id] = on;
        }
        o.tags = tags;
      });
    },

    /** Infos d'un élément (valeurs déjà vérifiées) ; `null` revient à l'automatique. */
    setInfos(key: ElementKey, changes: Record<string, InfoValue | null>): void {
      change(key, (o) => {
        const infos = { ...o.infos };
        for (const [id, v] of Object.entries(changes)) {
          if (v === null) delete infos[id];
          else infos[id] = v;
        }
        o.infos = infos;
      });
    },

    /** Façade : toutes les fiches, sous leurs anciennes clés (comme l'ancien `meta.json`). */
    legacyAll(): Record<string, UserMeta> {
      if (facade) return facade;
      const out: Record<string, UserMeta> = {};
      for (const o of Object.values(data.elements)) {
        const meta = o.legacy ? overrideToMeta(o) : null;
        if (meta) out[o.legacy!] = meta;
      }
      for (const [legacyKey, o] of Object.entries(data.unmatched)) {
        const meta = overrideToMeta(o);
        if (meta) out[legacyKey] = meta;
      }
      return (facade = out);
    },

    /** Façade : remplace la fiche d'une ancienne clé (`null` l'efface ; les tags modifiés à la main restent). */
    legacySet(legacyKey: string, meta: UserMeta | null): void {
      const parts = meta ? metaToOverride(meta) : { infos: {}, images: {} };
      const known = legacyIndex.get(legacyKey);
      if (known && data.elements[known]) {
        data.elements[known] = writeFacade(data.elements[known], parts);
        if (isEmpty(data.elements[known])) {
          delete data.elements[known];
          legacyIndex.delete(legacyKey);
        }
        save([known]);
        return;
      }
      if (!meta) {
        delete data.unmatched[legacyKey];
        save([]);
        return;
      }
      // Fiche nouvelle, ou gardée à part : rangée sous son élément s'il est maintenant connu.
      delete data.unmatched[legacyKey];
      const key = place(legacyKey, parts);
      save(key ? [key] : []);
    },

    /**
     * Fichier ou dossier renommé ou déplacé de `from` vers `to` (P2-10) : ses modifications, et celles de tout ce qu'il
     * contient, passent sous les nouvelles clés (une modification restée à l'arrivée, d'un ancien fichier, est
     * remplacée) ; les anciennes clés qui les relient à `meta.json` suivent. Rend les clés touchées (anciennes et
     * nouvelles).
     */
    movePath(from: string, to: string): ElementKey[] {
      const touched: ElementKey[] = [];
      const moved: [ElementKey, Override][] = [];
      let dirty = false;
      for (const [key, o] of Object.entries(data.elements)) {
        const next = movedKey(key, from, to, platform);
        if (!next) continue;
        delete data.elements[key];
        if (o.legacy) {
          legacyIndex.delete(o.legacy);
          o.legacy = movedLegacyKey(o.legacy, from, to, platform) ?? o.legacy;
        }
        moved.push([next, o]);
        touched.push(key, next);
      }
      for (const [key, o] of moved) {
        data.elements[key] = o;
        if (o.legacy) legacyIndex.set(o.legacy, key);
      }
      for (const [legacyKey, o] of Object.entries(data.unmatched)) {
        const next = movedLegacyKey(legacyKey, from, to, platform);
        if (!next) continue;
        delete data.unmatched[legacyKey];
        data.unmatched[next] = o;
        dirty = true;
      }
      if (dirty || touched.length) save(touched);
      return touched;
    },

    /**
     * Éléments arrivés dans le catalogue : les fiches gardées sous une adresse qui les désigne les rejoignent.
     * Rend les clés des éléments concernés.
     */
    adopt(elements: Iterable<Readonly<Element>>): ElementKey[] {
      const pending = new Map<string, { legacyKey: string; kinds: readonly OpenKind[] }>();
      for (const legacyKey of Object.keys(data.unmatched)) {
        const t = legacyTarget(legacyKey, platform).find;
        if (t) pending.set(t.target, { legacyKey, kinds: t.kinds });
      }
      if (!pending.size) return [];
      const moved: ElementKey[] = [];
      for (const e of elements) {
        for (const target of targetsOf(e)) {
          const hit = pending.get(target);
          if (!hit || !hit.kinds.includes(e.open.kind) || data.elements[e.key]?.legacy) continue;
          const o = data.unmatched[hit.legacyKey];
          delete data.unmatched[hit.legacyKey];
          data.elements[e.key] = writeFacade({ ...data.elements[e.key], legacy: hit.legacyKey }, o);
          legacyIndex.set(hit.legacyKey, e.key);
          pending.delete(target);
          moved.push(e.key);
        }
      }
      if (moved.length) save(moved);
      return moved;
    },

    /** Abonnement aux modifications (clés des éléments concernés). */
    onChange(listener: OverridesListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    flush: () => store.flush(),
  };
}

export type Overrides = ReturnType<typeof createOverrides>;
