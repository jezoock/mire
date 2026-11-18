/**
 * Coquille (P4-07) : ce que `mire-rail`, `mire-header` et `mire-padbar` reçoivent de la page, et les règles sans DOM
 * qu'ils appliquent. Testé sous `node:test` (`test/ui/shell.test.ts`).
 */

/** Position du menu : barre latérale (gauche, droite) ou carrousel (haut, bas). */
export type MenuPosition = 'left' | 'right' | 'top' | 'bottom';

export const MENU_POSITIONS: readonly MenuPosition[] = ['left', 'right', 'top', 'bottom'];

/** Position reconnue, `left` sinon (réglage absent ou abîmé). */
export const menuPosition = (v: unknown): MenuPosition => (MENU_POSITIONS.includes(v as MenuPosition) ? (v as MenuPosition) : 'left');

/** En haut ou en bas, le menu est un carrousel horizontal. */
export const isCarousel = (position: MenuPosition): boolean => position === 'top' || position === 'bottom';

/**
 * Entrée du menu :
 * - `screen` ou `page` : ouvre sa cible (`open` du contrôleur `mire-app`) ;
 * - `openFile`, `quit` : outils du menu.
 */
export interface RailEntry {
  /** Clé stable de l'entrée : sa cible, ou le nom de l'outil. */
  key: string;
  kind: 'screen' | 'page' | 'openFile' | 'quit';
  /** Cible ouverte (`screen:home`, `movies`). */
  target?: string;
  label: string;
  /** Vue historique qui l'affiche (`videos`) : sert aux tests et aux raccourcis de l'interface historique. */
  view?: string;
  /** Pastille de couleur (pages) ou icône (écrans, outils), nom d'une icône de la page. */
  icon?: string;
  /** Couleur de la pastille ou de l'icône (variable CSS). */
  color: string;
  /** Rangée du bas (Centre, Réglages, outils), séparée des autres. */
  bottom?: boolean;
  /** Les sites ouverts depuis cette entrée s'affichent sous elle. */
  sessions?: boolean;
}

/** Site ouvert, affiché sous l'entrée d'où il vient. */
export interface RailSession {
  id: string;
  name: string;
  color: string;
}

/** Textes du menu, tirés des catalogues par la page. */
export interface RailLabels {
  menu?: string;
  brand?: string;
  prev?: string;
  next?: string;
  /** Liste des sites ouverts sous une entrée, par clé d'entrée. */
  sessions?: Record<string, string>;
}

/** Texte du badge d'un nombre (téléchargements en cours) ; vide quand il n'y a rien à signaler. */
export const badgeText = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '');

/** Lit une propriété reçue en JSON (attribut) ou telle quelle (propriété). */
export function readProp<T>(value: T | string | null | undefined, fallback: T): T {
  if (typeof value !== 'string') return value ?? fallback;
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Fermeture du menu rétractable : il reste ouvert tant que la souris le survole ou que le focus y est. */
export const railStaysOpen = (state: { hover: boolean; focusInside: boolean }): boolean => state.hover || state.focusInside;

/** Délai avant de refermer le menu rétractable : la souris qui sort, le focus qui part (plus court). */
export const RAIL_CLOSE_DELAY = { leave: 450, blur: 150 } as const;

/** Aide de la manette : les boutons (libellés de la famille) et ce qu'ils font. */
export interface PadHint {
  glyphs: string[];
  label: string;
}

/** Un libellé de bouton de plus de deux caractères (« Affichage ») prend une pastille allongée. */
export const isLongGlyph = (glyph: string): boolean => glyph.length > 2;

/** En dessous de cet écart entre deux déplacements (en ms), une touche reste enfoncée ou se répète. */
export const RAPID_MOVE_MS = 200;

/**
 * Défilement qui montre l'élément sélectionné : en douceur pour un déplacement isolé, immédiat quand les
 * déplacements se suivent de près (touche enfoncée, croix de la manette maintenue) — sinon chaque défilement en
 * douceur repart du précédent et la vue prend du retard sur le focus — ou si le système demande moins d'animations.
 */
export function scrollBehavior({ reducedMotion, sinceLast }: { reducedMotion: boolean; sinceLast: number }): ScrollBehavior {
  return reducedMotion || sinceLast < RAPID_MOVE_MS ? 'auto' : 'smooth';
}
