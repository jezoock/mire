/**
 * Fusion des origines (architecture cible, « D'où viennent les tags et les infos ») :
 * - tags : réunion des tags posés automatiquement (type de fichier, source, tags automatiques, infos en ligne),
 *   puis les ajouts et les **retraits** faits à la main, qui l'emportent toujours ;
 * - infos et images : la valeur saisie à la main l'emporte, puis les infos en ligne (dans l'ordre des fournisseurs),
 *   puis les tags automatiques, puis la source, puis le type de fichier.
 */
import type { ElementImages, InfoValue, ValueOrigin } from '@mire/shared';

/** Ce qu'une origine automatique pose sur un élément. */
export interface Layer {
  origin: Exclude<ValueOrigin, 'user'>;
  tags?: readonly string[];
  infos?: Readonly<Record<string, InfoValue>>;
  images?: Readonly<ElementImages>;
}

/** Modifications faites à la main pour un élément (`overrides.json`). */
export interface Override {
  /** Par tag : `true` ajouté à la main, `false` retiré à la main. */
  tags?: Record<string, boolean>;
  infos?: Record<string, InfoValue>;
  images?: ElementImages;
  /** Clé de l'ancien `meta.json` (`v:<chemin>`…), pour la façade de l'interface historique. */
  legacy?: string;
}

export interface Effective {
  tags: string[];
  infos: Record<string, InfoValue>;
  images: ElementImages;
}

// Origines automatiques, de la plus faible à la plus forte.
const ORDER: readonly Layer['origin'][] = ['file', 'source', 'tagger', 'metadata'];

/**
 * Tags, infos et images effectifs. `layers` : origines automatiques ; entre deux couches de même origine, la
 * première l'emporte (ordre des fournisseurs choisi par l'utilisateur).
 */
export function mergeLayers(layers: readonly Layer[], override?: Readonly<Override>): Effective {
  // Du plus faible au plus fort : chaque couche écrase la précédente (sans tri : appelé pour chaque élément).
  const ordered: Layer[] = [];
  for (const origin of ORDER) for (let i = layers.length - 1; i >= 0; i--) if (layers[i].origin === origin) ordered.push(layers[i]);
  const tags = new Set<string>();
  const infos: Record<string, InfoValue> = {};
  const images: ElementImages = {};
  for (const layer of ordered) {
    for (const t of layer.tags ?? []) tags.add(t);
    Object.assign(infos, layer.infos);
    Object.assign(images, layer.images);
  }
  if (override) {
    for (const [t, on] of Object.entries(override.tags ?? {})) {
      if (on) tags.add(t);
      else tags.delete(t);
    }
    Object.assign(infos, override.infos);
    Object.assign(images, override.images);
  }
  return { tags: [...tags], infos, images };
}
