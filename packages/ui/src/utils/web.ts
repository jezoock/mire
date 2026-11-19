/**
 * Vue web (P4-16) : ce qu'affiche la barre d'un site (`mire-webbar`), déjà rédigé par la page (`src/renderer/web/`) à
 * partir de l'état publié par le processus principal (`web-state`), et le calcul de la place laissée à la vue native
 * (`mire-web-slot`). Sans DOM.
 */

/** Genre d'une vue web, publié par le processus principal. */
export type WebViewKind = 'site' | 'rom' | 'bookmark' | 'tv';

/** Bouclier du bloqueur de publicités : actif ou non sur ce site, éléments bloqués, textes déjà rédigés. */
export interface WebBarAdblock {
  on: boolean;
  blocked: number;
  label: string;
  title: string;
}

/** La barre d'un site. */
export interface WebBarView {
  id: string;
  kind: WebViewKind;
  /** Nom du site (« Netflix », « Jeux : Super Nintendo », titre du marque-page, nom du service TV). */
  name: string;
  /** Couleur du site (`#rrggbb`, contrôlée par le processus principal). */
  color: string;
  /** Titre de la page affichée ; vide pour les sites de jeux (le choix du site prend sa place). */
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Recherche du site mémorisée. */
  hasSearch: boolean;
  /** `null` : bloqueur éteint dans les réglages. */
  adblock: WebBarAdblock | null;
  /** Sites de jeux d'une console : leurs noms et celui choisi. */
  rom: { sites: string[]; site: number } | null;
}

/** Textes fixes de la barre. */
export interface WebBarLabels {
  label?: string;
  back?: string;
  forward?: string;
  reload?: string;
  site?: string;
  siteChoice?: string;
  learn?: string;
  learnTitle?: string;
  learned?: string;
  learnedTitle?: string;
  bookmarkPage?: string;
  bookmarkPageTitle?: string;
  bookmarkGame?: string;
  bookmarkGameTitle?: string;
  immersive?: string;
  immersiveTitle?: string;
  browser?: string;
  browserTitle?: string;
  close?: string;
  closeTitle?: string;
}

/** Icônes SVG de la barre, fournies par la page. */
export interface WebBarIcons {
  back?: string;
  forward?: string;
  reload?: string;
  search?: string;
  shield?: string;
  shieldOff?: string;
  star?: string;
  fullscreen?: string;
  globe?: string;
  close?: string;
}

/** Arguments de `navigate` du contrôleur `mire-web`. */
export const navArgs = (id: string): string => JSON.stringify([{ id }]);

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Côté du menu qui se déplie au-dessus du contenu (menu automatique). */
export type MenuSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Place de la vue native : la zone réservée (`slot`), moins le menu automatique quand il est déplié par-dessus
 * (`menu` : sa zone et son côté ; `null` sinon). La vue native passe devant le HTML : sans cela, elle cacherait le menu.
 */
export function slotBounds(slot: Box, menu: { box: Box; side: MenuSide } | null): Box {
  let left = slot.x;
  let top = slot.y;
  let right = slot.x + slot.width;
  let bottom = slot.y + slot.height;
  if (menu) {
    const m = menu.box;
    if (menu.side === 'left') left = Math.max(left, m.x + m.width);
    if (menu.side === 'right') right = Math.min(right, m.x);
    if (menu.side === 'top') top = Math.max(top, m.y + m.height);
    if (menu.side === 'bottom') bottom = Math.min(bottom, m.y);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
