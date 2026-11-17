/**
 * Sources dont les éléments viennent de la configuration (jeux ajoutés à la main, marque-pages, sites…) ou dont les
 * emplacements y sont déclarés (consoles, dossiers de jeux, services de télévision) : à chaque changement de la
 * configuration, chacune reçoit ses éléments, et les emplacements qui n'y sont plus quittent le catalogue.
 */
import type { Config, ElementSourceRef } from '@mire/shared';
import type { Catalog } from './index.ts';
import { sourceId } from './persistence.ts';
import type { ElementInput, ElementSource } from './types.ts';

/** Éléments d'un emplacement de source. */
export interface SourceElements {
  source: ElementSourceRef;
  elements: ElementInput[];
}

/** Ce qu'un domaine tire de la configuration pour le catalogue. */
export interface ConfigFeed {
  /** Vrai pour les sources que ce domaine gère. */
  owns(plugin: string): boolean;
  /** Emplacements dont les éléments se déduisent de la configuration. */
  sets: SourceElements[];
  /** Emplacements analysés ailleurs (consoles, dossiers…) toujours présents dans la configuration. */
  keeps?(ref: ElementSourceRef): boolean;
}

/** Instance des sources tirées de la configuration elle-même : une seule liste. */
export const CONFIG_INSTANCE = 'config';

/** Source dont les éléments se lisent dans la configuration (pas d'analyse, pas d'erreur possible). */
export interface ConfigSource extends ElementSource<Config> {
  elementsOf(config: Config): ElementInput[];
}

export function configSource(id: string, tags: readonly string[], elementsOf: (config: Config) => ElementInput[]): ConfigSource {
  return { id, tags, handles: () => true, instance: () => CONFIG_INSTANCE, elementsOf, scan: async (config) => elementsOf(config) };
}

/** Emplacement d'une source tirée de la configuration, avec ses éléments. */
export const configSet = (src: ConfigSource, config: Config): SourceElements => ({
  source: { plugin: src.id, instance: src.instance(config) },
  elements: src.elementsOf(config),
});

/** Donne ses éléments à chaque emplacement, puis retire ceux des sources gérées qui ne sont plus dans la configuration. */
export function syncFeeds(catalog: Pick<Catalog, 'setSource' | 'removeSource' | 'sources'>, feeds: readonly ConfigFeed[]): void {
  const set = new Set<string>();
  for (const feed of feeds) {
    for (const { source, elements } of feed.sets) {
      catalog.setSource(source, elements);
      set.add(sourceId(source));
    }
  }
  for (const ref of catalog.sources()) {
    const feed = feeds.find((f) => f.owns(ref.plugin));
    if (feed && !set.has(sourceId(ref)) && !feed.keeps?.(ref)) catalog.removeSource(ref);
  }
}

/** Objet sans les valeurs absentes ou vides : un élément ne garde que ce qu'on sait de lui. */
export function compact<T>(o: Record<string, T | null | undefined>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  return out;
}
