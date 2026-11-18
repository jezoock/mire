/**
 * Tags automatiques des plugins branchés sur le moteur de tags. Le moteur appelle ses contributions de façon
 * synchrone ; un plugin répond par messages (ADR 0002, précision 3 : `compute` devient asynchrone vue du cœur). Le
 * pont garde donc le dernier résultat de chaque élément : un élément inconnu, ou changé depuis, est mis en file et
 * calculé par lots dans l'hôte ; à chaque lot rendu, le moteur recalcule ces éléments, qui trouvent alors leur
 * résultat. Les résultats sont filtrés : seulement les tags et les infos que la contribution déclare, avec le type
 * déclaré.
 */
import type { Element, ElementKey, InfoValue } from '@mire/shared';
import type { InfoDeclaration, TaggerResult } from '@mire/plugin-sdk';
import type { Contributor } from '../catalog/tags/engine.ts';
import type { Layer } from '../catalog/tags/merge.ts';
import { coerceInfo } from '../catalog/tags/registry.ts';

/** Contribution `taggers` d'un plugin actif. */
export interface PluginTagger {
  pluginId: string;
  id: string;
  tags: readonly string[];
  infos: Readonly<Record<string, InfoDeclaration>>;
  /** Calcule un lot dans l'hôte (`runtime.computeBatch`). */
  computeBatch(elements: Readonly<Element>[]): Promise<unknown[]>;
}

export interface PluginTaggersOptions {
  /** Éléments à recalculer (moteur de tags). */
  refresh(keys: ElementKey[]): void;
  /** Un lot a échoué : le service désactive le plugin. */
  onError(pluginId: string, err: unknown): void;
  batchSize?: number;
}

type Result = Omit<Layer, 'origin'>;

interface Cached {
  print: string;
  result: Result | null;
}

/** Résultat d'un plugin ramené à ce que la contribution déclare. */
export function sanitizeTaggerResult(raw: unknown, tagger: Pick<PluginTagger, 'tags' | 'infos'>): Result | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as TaggerResult;
  const tags = Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === 'string' && tagger.tags.includes(t)))] : [];
  const infos: Record<string, InfoValue> = {};
  if (r.infos && typeof r.infos === 'object' && !Array.isArray(r.infos)) {
    for (const [id, v] of Object.entries(r.infos)) {
      if (!Object.hasOwn(tagger.infos, id)) continue;
      const value = coerceInfo(tagger.infos[id].type, v);
      if (value !== undefined) infos[id] = value;
    }
  }
  if (!tags.length && !Object.keys(infos).length) return null;
  return { tags, infos };
}

export function createPluginTaggers({ refresh, onError, batchSize = 500 }: PluginTaggersOptions) {
  const taggers = new Map<string, { tagger: PluginTagger; cache: Map<ElementKey, Cached>; queue: Map<ElementKey, Readonly<Element>>; running: boolean }>();
  const name = (t: Pick<PluginTagger, 'pluginId' | 'id'>) => `${t.pluginId}/${t.id}`;

  async function drain(id: string): Promise<void> {
    const entry = taggers.get(id);
    if (!entry || entry.running) return;
    entry.running = true;
    try {
      while (entry.queue.size && taggers.get(id) === entry) {
        const batch = [...entry.queue.entries()].slice(0, batchSize);
        for (const [key] of batch) entry.queue.delete(key);
        const elements = batch.map(([, e]) => e);
        const results = await entry.tagger.computeBatch(elements);
        if (taggers.get(id) !== entry) return;
        const keys: ElementKey[] = [];
        batch.forEach(([key, e], i) => {
          entry.cache.set(key, { print: JSON.stringify(e), result: sanitizeTaggerResult(results[i], entry.tagger) });
          keys.push(key);
        });
        refresh(keys);
      }
    } catch (err) {
      if (taggers.get(id) === entry) onError(entry.tagger.pluginId, err);
    } finally {
      entry.running = false;
    }
  }

  function contributor(id: string): Contributor {
    return {
      id,
      origin: 'tagger',
      compute(e) {
        const entry = taggers.get(id);
        if (!entry) return null;
        const cached = entry.cache.get(e.key);
        if (cached && cached.print === JSON.stringify(e)) return cached.result;
        // Inconnu ou changé : calculé au prochain lot ; en attendant, l'ancien résultat (rien pour un nouvel élément).
        if (!entry.queue.has(e.key)) {
          entry.queue.set(e.key, e);
          queueMicrotask(() => void drain(id));
        }
        return cached?.result ?? null;
      },
    };
  }

  return {
    add(tagger: PluginTagger): void {
      taggers.set(name(tagger), { tagger, cache: new Map(), queue: new Map(), running: false });
    },
    /** Retire les tags automatiques d'un plugin (désactivé, ou en faute). */
    remove(pluginId: string): void {
      for (const [id, entry] of taggers) if (entry.tagger.pluginId === pluginId) taggers.delete(id);
    },
    /** Contributions à donner au moteur, dans l'ordre d'activation. */
    contributors: (): Contributor[] => [...taggers.keys()].map(contributor),
    /** Éléments en attente d'un lot (tests, journal). */
    pending: (): number => [...taggers.values()].reduce((n, e) => n + e.queue.size, 0),
  };
}

export type PluginTaggers = ReturnType<typeof createPluginTaggers>;
