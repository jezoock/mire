/**
 * Modèle d'élément du catalogue : les types de l'élément sont publiés dans le SDK des plugins (P3-01) et réexportés
 * ici ; ce fichier ajoute ce que seuls le cœur et l'interface échangent (tags et infos modifiés à la main, liste des
 * tags).
 */
import type { InfoValue } from '../../plugin-sdk/src/element.ts';

export type * from '../../plugin-sdk/src/element.ts';

/**
 * Tags modifiés à la main pour un élément, par tag : `true` l'ajoute, `false` le retire (même s'il est posé
 * automatiquement), `null` revient à l'automatique. Un tag inconnu est créé (tag de l'utilisateur) : son identifiant
 * est son nom simplifié.
 */
export type TagChanges = Record<string, boolean | null>;

/** Infos modifiées à la main pour un élément, par info : la valeur saisie, ou `null` pour revenir à l'automatique. */
export type InfoChanges = Record<string, InfoValue | null>;

/** Tag connu de Mire (`tags.list`). */
export interface TagSummary {
  /** Identifiant stable (`video`, `series`, ou nom simplifié d'un tag de l'utilisateur). */
  id: string;
  /** Nom affiché, dans la langue de l'interface. */
  name: string;
  /** Tag du cœur, créé par l'utilisateur, ou posé sans être déclaré (`other`). */
  origin: 'core' | 'user' | 'other';
  /** Nombre d'éléments qui le portent. */
  count: number;
}
