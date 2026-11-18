/**
 * Logique sans DOM de l'accueil (P4-12) : ce que `mire-home-view` affiche (horloge, barres de la mire, rangées,
 * sites épinglés), mise en page du thème, actions par cible et par clé. Testée sous `node:test` (`test/ui/home.test.ts`).
 */
import type { PageGroup, PagePath } from '@mire/shared';
import type { CardElement, CardVariant } from './elements.ts';

/** Mise en page de l'accueil voulue par le thème (`home.layout` de `theme.json`). */
export type HomeLayout = 'rows' | 'grid';

/** Mise en page reconnue, sinon les rangées (celle du thème Mire). */
export const homeLayout = (value: string | null | undefined): HomeLayout => (value === 'grid' ? 'grid' : 'rows');

/** Barre de la mire : une cible de la coquille (page, écran), son nom, un mot sur son contenu et sa couleur. */
export interface HomeBar {
  target: string;
  label: string;
  meta: string;
  /** Couleur (variable CSS de la palette, `var(--bar-yellow)`). */
  color: string;
}

/** Site épinglé (anciennement « Vos services ») : clé de l'élément (`web:<id>`), nom, couleurs, déjà ouvert ou non. */
export interface HomeSite {
  key: string;
  name: string;
  color: string;
  /** Couleur du texte sur `color`. */
  ink: string;
  open: boolean;
}

/**
 * Partie de l'accueil, dans l'ordre des rangées choisies :
 * - `bars` : les barres de la mire ;
 * - `sites` : les sites épinglés ;
 * - `elements` : « Reprendre », ou les premiers éléments d'une page ou d'une liste (`target` : la page à ouvrir) ;
 * - `groups` : les premiers regroupements d'une page (Films par genre…).
 * `id` : identifiant stable de la rangée (`bars`, `recent`, `page:movies`, `list:favoris`).
 */
export type HomeSection =
  | { kind: 'bars'; id: string; bars: HomeBar[] }
  | { kind: 'sites'; id: string; heading: string; sites: HomeSite[] }
  | { kind: 'elements'; id: string; heading: string; target?: string; action: string; variant: CardVariant; elements: CardElement[] }
  | { kind: 'groups'; id: string; heading: string; target: string; variant: CardVariant; groups: PageGroup[] };

/** Textes de l'accueil, tirés des catalogues par la page (attribut `labels`, JSON). */
export interface HomeLabels {
  /** Nom de la mire pour les lecteurs d'écran. */
  bars?: string;
  /** Badge d'un site déjà ouvert. */
  open?: string;
  /** Lien d'une rangée vers sa page : « Tout voir ». */
  seeAll?: string;
  /** Accueil sans rien à montrer. */
  empty?: string;
  /** Bouton vers les réglages de l'accueil. */
  customize?: string;
}

/**
 * Arguments de l'action qui ouvre une cible de la coquille (`open:<arguments>` vers `mire-home`), avec un chemin dans
 * ses regroupements : `[{"target":"movies"}]`.
 */
export function targetArgs(target: string, path: PagePath = []): string {
  return JSON.stringify([path.length ? { target, path } : { target }]);
}

/** Arguments d'une action qui désigne un élément (un site épinglé) par sa clé : `[{"key":"web:arte"}]`. */
export const keyArgs = (key: string): string => JSON.stringify([{ key }]);

/** L'accueil n'a rien à montrer : ni horloge, ni partie non vide. */
export function homeIsEmpty(clock: boolean, sections: readonly HomeSection[]): boolean {
  return !clock && !sections.some(sectionHasContent);
}

/** Une partie a-t-elle quelque chose à montrer ? Une rangée vide n'est pas affichée. */
export function sectionHasContent(s: HomeSection): boolean {
  if (s.kind === 'bars') return s.bars.length > 0;
  if (s.kind === 'sites') return s.sites.length > 0;
  return s.kind === 'elements' ? s.elements.length > 0 : s.groups.length > 0;
}
