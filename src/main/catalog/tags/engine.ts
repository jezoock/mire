/**
 * Moteur de tags et d'infos : calcule les tags, infos et images effectifs de chaque élément du catalogue (type de
 * fichier, source, tags automatiques, infos en ligne, modifications à la main), les garde dans un index en mémoire
 * et le tient à jour à chaque changement du catalogue, des modifications à la main ou des règles par extension.
 */
import type { Element, ElementKey, InfoChanges, InfoValue, TagChanges, TagSummary } from '@mire/shared';
import type { Catalog } from '../index.ts';
import type { Overrides } from '../overrides.ts';
import { keyGenre } from '../keys.ts';
import { fileLayer, type FileTagRules } from './file-rules.ts';
import { mergeLayers, type Effective, type Layer } from './merge.ts';
import { coerceInfo, INFO_ID_RE, userTagId, type Registry } from './registry.ts';
import { createTagIndex } from './tag-index.ts';

/**
 * Contribution automatique (tags automatiques, infos en ligne) : ce qu'elle pose sur un élément, ou `null`.
 * Les plugins `taggers` (P2-05) et `metadata` (P2-06) passeront par là.
 */
export interface Contributor {
  id: string;
  origin: 'tagger' | 'metadata';
  compute(element: Readonly<Element>): Omit<Layer, 'origin'> | null;
}

export interface TagEngineOptions {
  catalog: Pick<Catalog, 'keys' | 'get' | 'onChange'>;
  overrides: Overrides;
  registry: Registry;
  /** Règles par extension en vigueur (configuration). */
  rules: () => FileTagRules;
  /** Contributions automatiques dès le départ (tags automatiques internes), sans second calcul. */
  contributors?: readonly Contributor[];
}

export type TagEngineListener = (keys: ElementKey[]) => void;

export function createTagEngine({ catalog, overrides, registry, rules, contributors: initial = [] }: TagEngineOptions) {
  const effective = new Map<ElementKey, Effective>();
  const index = createTagIndex();
  const listeners = new Set<TagEngineListener>();
  let contributors: readonly Contributor[] = [...initial];
  let currentRules = rules();

  function compute(e: Readonly<Element>): Effective {
    const layers: Layer[] = [
      { origin: 'file', ...fileLayer(e, currentRules) },
      { origin: 'source', tags: e.tags, infos: e.infos, images: e.images },
    ];
    for (const c of contributors) {
      const layer = c.compute(e);
      if (layer) layers.push({ ...layer, origin: c.origin });
    }
    return mergeLayers(layers, overrides.get(e.key));
  }

  /** Recalcule un élément et met l'index à jour. */
  function update(key: ElementKey): void {
    const old = effective.get(key);
    if (old) index.remove(key, old);
    const e = catalog.get(key);
    if (!e) {
      effective.delete(key);
      return;
    }
    const next = compute(e);
    effective.set(key, next);
    index.add(key, next);
  }

  function emit(keys: ElementKey[]): void {
    if (keys.length) for (const listener of listeners) listener(keys);
  }

  function rebuild(): void {
    effective.clear();
    index.clear();
    for (const key of catalog.keys()) update(key);
  }

  registry.setUserTags(overrides.userTags());
  rebuild();

  catalog.onChange(({ added, changed, removed }) => {
    for (const key of added) update(key);
    for (const key of changed) update(key);
    for (const key of removed) update(key);
    // Fiches de l'ancien `meta.json` gardées sous une adresse : elles rejoignent leur élément quand il arrive.
    if (added.length) overrides.adopt(added.map((k) => catalog.get(k)).filter((e): e is Readonly<Element> => !!e));
    emit([...added, ...changed, ...removed]);
  });

  overrides.onChange((keys) => {
    registry.setUserTags(overrides.userTags());
    for (const key of keys) update(key);
    emit(keys);
  });

  /** Élément avec ses tags, infos et images effectifs (copie), ou `null`. */
  function element(key: unknown): Element | null {
    if (typeof key !== 'string') return null;
    const e = catalog.get(key);
    const eff = effective.get(key);
    if (!e || !eff) return null;
    return structuredClone({ ...e, tags: eff.tags, infos: eff.infos, images: eff.images });
  }

  /** Identifiant d'un tag nommé à la main : tag connu, ou nom simplifié (nouveau tag de l'utilisateur). */
  function tagId(name: string): string {
    if (registry.isCoreTag(name) || registry.isUserTag(name) || index.tagCount(name)) return name;
    return userTagId(name);
  }

  const validKey = (key: unknown): key is ElementKey => typeof key === 'string' && keyGenre(key) !== null;

  return {
    element,

    /** Clés des éléments qui portent tous les tags de `require` et aucun de `exclude`. */
    query: (require: readonly string[], exclude: readonly string[] = []): ElementKey[] => index.withTags(require, exclude),
    withInfo: index.withInfo,
    infoValues: index.infoValues,

    /**
     * Tags modifiés à la main (`catalog.setTags`) : `true` ajoute, `false` retire, `null` revient à l'automatique.
     * Un tag inconnu ajouté devient un tag de l'utilisateur. Rend l'élément, ou `null` s'il n'est pas (encore) dans le
     * catalogue : la modification est gardée.
     */
    setTags(key: unknown, changes: unknown): Element | null {
      if (!validKey(key) || !changes || typeof changes !== 'object') return null;
      const next: Record<string, boolean | null> = {};
      for (const [name, on] of Object.entries(changes as TagChanges)) {
        if (on !== true && on !== false && on !== null) continue;
        const id = tagId(name.trim());
        if (!id) continue;
        if (on && !registry.isCoreTag(id) && !registry.isUserTag(id) && !index.tagCount(id)) overrides.addUserTag(id, name.trim());
        next[id] = on;
      }
      if (Object.keys(next).length) overrides.setTags(key, next);
      return element(key);
    },

    /**
     * Infos modifiées à la main (`catalog.setInfos`) : la valeur, ramenée au type de l'info, ou `null` pour revenir à
     * l'automatique. Une valeur qui ne convient pas est ignorée.
     */
    setInfos(key: unknown, changes: unknown): Element | null {
      if (!validKey(key) || !changes || typeof changes !== 'object') return null;
      const next: Record<string, InfoValue | null> = {};
      for (const [id, v] of Object.entries(changes as InfoChanges)) {
        if (!INFO_ID_RE.test(id)) continue;
        if (v === null) next[id] = null;
        else {
          const value = coerceInfo(registry.infoType(id), v);
          if (value !== undefined) next[id] = value;
        }
      }
      if (Object.keys(next).length) overrides.setInfos(key, next);
      return element(key);
    },

    /** Tags connus (`tags.list`) : ceux du cœur, puis de l'utilisateur, puis ceux posés sans être déclarés. */
    tagsList(): TagSummary[] {
      const core = registry.coreTags().map((id): TagSummary => ({ id, name: registry.tagName(id), origin: 'core', count: index.tagCount(id) }));
      const user = registry.userTags().map((id): TagSummary => ({ id, name: registry.tagName(id), origin: 'user', count: index.tagCount(id) }));
      user.sort((a, b) => a.name.localeCompare(b.name));
      const known = new Set([...core, ...user].map((t) => t.id));
      const other = index
        .tags()
        .filter((id) => !known.has(id))
        .sort()
        .map((id): TagSummary => ({ id, name: id, origin: 'other', count: index.tagCount(id) }));
      return [...core, ...user, ...other];
    },

    /** Règles par extension changées (configuration) : tout est recalculé. */
    refreshRules(): void {
      currentRules = rules();
      rebuild();
      emit([...effective.keys()]);
    },

    /** Contributions automatiques, dans l'ordre (pour les infos en ligne : ordre des fournisseurs). */
    setContributors(list: readonly Contributor[]): void {
      contributors = [...list];
      rebuild();
      emit([...effective.keys()]);
    },

    /** Éléments dont une contribution a changé (fiche d'infos en ligne enregistrée…) : recalculés. */
    refresh(keys: readonly ElementKey[]): void {
      for (const key of keys) update(key);
      emit([...keys]);
    },

    /** Abonnement aux éléments dont les tags ou les infos ont pu changer. */
    onChange(listener: TagEngineListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type TagEngine = ReturnType<typeof createTagEngine>;
