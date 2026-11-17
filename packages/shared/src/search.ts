// Recherche dans le catalogue (P2-09) : `catalog.search(query, options)` de l'architecture cible.
import type { Element } from './element.ts';

/** Options de `catalog.search`. */
export interface SearchOptions {
  /** Nombre d'éléments rendus par groupe (24 par défaut, 100 au plus) ; `total` donne le nombre trouvé. */
  limit?: number;
}

/** Éléments trouvés qui entrent dans une page, ou qui n'entrent dans aucune (`page: null`). */
export interface SearchGroup {
  page: string | null;
  /** Nom affiché de la page, ou du groupe des éléments hors pages. */
  name: string;
  /** Nombre d'éléments trouvés dans ce groupe. */
  total: number;
  /** Les premiers (`limit`) : ceux dont le nom correspond d'abord, puis par nom. */
  elements: Element[];
}

/** Réponse de `catalog.search` : un groupe par page qui a des résultats, dans l'ordre du menu, puis les hors pages. */
export interface SearchResult {
  query: string;
  /** Nombre d'éléments trouvés (un élément compte une fois, même s'il entre dans plusieurs pages). */
  total: number;
  groups: SearchGroup[];
}
