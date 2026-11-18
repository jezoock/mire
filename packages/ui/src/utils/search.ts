/**
 * Logique sans DOM de la Recherche (P4-13) : ce que `mire-search-view` affiche (recherches récentes, groupes du
 * catalogue par page, « Où regarder », sites où chercher) et les arguments de ses actions. Les textes arrivent déjà
 * rédigés par la page (`src/renderer/search/`). Testée sous `node:test` (`test/ui/search.test.ts`).
 */
import type { CardElement, CardVariant } from './elements.ts';

/** Éléments du catalogue trouvés dans une page (`page` : son identifiant, `null` hors des pages). */
export interface SearchGroupView {
  /** Identifiant stable du groupe : la page, ou `none`. */
  id: string;
  page: string | null;
  heading: string;
  /** Nombre d'éléments trouvés dans ce groupe (les cartes n'en montrent que les premiers). */
  total: number;
  variant: CardVariant;
  elements: CardElement[];
}

/** Service qui propose un titre ; `color` et `ink` seulement pour un site configuré dans Mire. */
export interface WatchChip {
  name: string;
  color?: string;
  ink?: string;
}

/** Film ou série trouvé par un fournisseur `search` (« Où regarder ») : clé, textes, affiche et services. */
export interface WatchCard {
  key: string;
  title: string;
  /** « Film, 2001 ». */
  meta: string;
  poster: string;
  chips: WatchChip[];
  /** Texte de la puce « +2 » ou « Pas en abonnement ». */
  more: string;
}

/**
 * Partie « Où regarder » :
 * - `nokey` : il manque la clé du catalogue (bouton vers les réglages) ;
 * - `loading`, `error`, `empty` : un message ;
 * - `done` : les titres trouvés.
 */
export interface WatchView {
  status: 'nokey' | 'loading' | 'error' | 'empty' | 'done';
  message: string;
  cards: WatchCard[];
}

/** Site où chercher la recherche en cours : identifiant, nom, couleurs, et ce qu'il fera (« Chercher « amélie » »). */
export interface SearchSiteView {
  id: string;
  name: string;
  color: string;
  ink: string;
  how: string;
}

/** Textes de la Recherche, tirés des catalogues par la page (attribut `labels`, JSON). */
export interface SearchLabels {
  /** Champ : nom et texte d'exemple. */
  field?: string;
  placeholder?: string;
  /** Recherche vide : présentation, recherches récentes et bouton qui les efface. */
  intro?: string;
  recent?: string;
  clearRecent?: string;
  /** Lien d'un groupe vers sa page : « Tout voir ». */
  seeAll?: string;
  /** Parties fixes. */
  watch?: string;
  sites?: string;
  /** Bouton qui mène à la clé du catalogue, et source des données. */
  addKey?: string;
  attribution?: string;
  /** Aucun résultat dans le catalogue. */
  none?: string;
}

/** Arguments d'une action qui désigne quelque chose par une clé ou un identifiant : `[{"key":"local:/a.mkv"}]`. */
export const searchArgs = (args: Record<string, string>): string => JSON.stringify([args]);

/** Les deux listes de cartes montrent-elles la même chose (mêmes éléments, dans le même ordre) ? */
export function sameCards(a: readonly CardElement[], b: readonly CardElement[]): boolean {
  return a.length === b.length && a.every((el, i) => JSON.stringify(el) === JSON.stringify(b[i]));
}

/**
 * Groupes à afficher : un groupe dont les cartes n'ont pas changé garde l'objet précédent, pour que sa rangée
 * (`mire-row`) ne soit pas redessinée pendant la frappe.
 */
export function keepGroups(prev: readonly SearchGroupView[], next: readonly SearchGroupView[]): SearchGroupView[] {
  return next.map((g) => {
    const old = prev.find((p) => p.id === g.id);
    if (!old || old.heading !== g.heading || old.total !== g.total || old.variant !== g.variant || !sameCards(old.elements, g.elements)) return g;
    return old;
  });
}
