/**
 * Règles de la navigation sur les composants (`ds-*` de dot-stash, `mire-*` de `@mire/ui`), sans DOM réel :
 * composant ou non, élément désactivé, touches relayées au composant, choix dans une navigation par colonnes.
 * Le service (`focus.ts`) les applique au document ; elles se testent sous Node avec de faux éléments.
 */
import type { Direction, Navigable, Rect } from './spatial.ts';

/** Ce que les règles lisent d'un élément. */
export interface ElementLike {
  localName: string;
  parentElement: ElementLike | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  disabled?: boolean;
}

/** Balise d'un composant : `ds-*` (dot-stash) ou `mire-*` (`@mire/ui`). */
export const isComponentTag = (name: string): boolean => name.startsWith('ds-') || name.startsWith('mire-');

/** Le composant le plus proche qui contient l'élément (l'élément lui-même compris), ou `null`. */
export function componentOf<T extends ElementLike>(el: T | null): T | null {
  for (let x: ElementLike | null = el; x; x = x.parentElement) if (isComponentTag(x.localName)) return x as T;
  return null;
}

/**
 * Règle des éléments désactivés (P4-03) : un élément n'est pas une destination si sa propriété `disabled` est vraie,
 * ou si lui-même ou l'un de ses parents porte l'attribut `disabled` ou `aria-disabled="true"`. Un `ds-trigger`
 * désactivé qui contient un vrai bouton écarte donc ce bouton, et un composant désactivé tout son contenu.
 */
export function isDisabled(el: ElementLike): boolean {
  if (el.disabled === true) return true;
  for (let x: ElementLike | null = el; x; x = x.parentElement) {
    if (x.hasAttribute('disabled') || x.getAttribute('aria-disabled') === 'true') return true;
  }
  return false;
}

/** Touches qu'un composant peut traiter lui-même (onglets, listes déroulantes, boîtes de dialogue…). */
export const RELAYED_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']);

/**
 * Touche de la manette à proposer d'abord au composant qui a le focus. Haut et bas ne le sont pas sur une liste
 * fermée (`aria-haspopup` et `aria-expanded="false"`, comme `ds-combo`) : la manette passe alors à l'élément voisin,
 * comme sur une liste déroulante des vues historiques ; A l'ouvre.
 */
export function relaysPadKey(el: ElementLike | null, key: string): boolean {
  if (!el || !RELAYED_KEYS.has(key) || !componentOf(el)) return false;
  const closedPopup = el.hasAttribute('aria-haspopup') && el.getAttribute('aria-expanded') === 'false';
  return !(closedPopup && (key === 'ArrowUp' || key === 'ArrowDown'));
}

/** Navigation par colonnes : attribut du conteneur et de chacune de ses colonnes. */
export const COLUMNS_ATTR = 'data-nav';
export const COLUMNS_VALUE = 'columns';
export const COLUMN_ATTR = 'data-nav-column';

/** Élément choisi en priorité en arrivant dans une colonne : la ligne sélectionnée ou en cours. */
export function isSelectedRow(el: ElementLike): boolean {
  const current = el.getAttribute('aria-current');
  return el.getAttribute('aria-selected') === 'true' || (current !== null && current !== 'false');
}

/**
 * Colonne d'arrivée quand gauche ou droite quitte la colonne `from` (indice dans `columns`) : la plus proche dans ce
 * sens qui a au moins une destination ; `-1` s'il n'y en a pas (on sort alors du conteneur).
 */
export function nextColumn(count: number, from: number, dir: Direction, hasTargets: (index: number) => boolean): number {
  const step = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  if (!step) return -1;
  for (let i = from + step; i >= 0 && i < count; i += step) if (hasTargets(i)) return i;
  return -1;
}

/**
 * Destination dans la colonne d'arrivée : la dernière visitée (`remembered`), sinon la ligne sélectionnée, sinon la
 * plus proche en hauteur de l'élément de départ (la première à égalité).
 */
export function pickInColumn<T extends Navigable & ElementLike>(from: Rect, targets: readonly T[], remembered: T | null = null): T | null {
  if (remembered && targets.includes(remembered)) return remembered;
  const selected = targets.find(isSelectedRow);
  if (selected) return selected;
  const middle = (r: Rect) => (r.top + r.bottom) / 2;
  let best: T | null = null;
  let bestGap = Infinity;
  for (const el of targets) {
    const gap = Math.abs(middle(el.getBoundingClientRect()) - middle(from));
    if (gap < bestGap) {
      bestGap = gap;
      best = el;
    }
  }
  return best;
}

/** Une demande de focus automatique différée (premier élément, retour d'un lecteur) en attente du rendu. */
export interface DeferredFocus<T> {
  /** Numéro de la demande ; chaque demande de focus (flèche comprise) en prend un nouveau. */
  ticket: number;
  /** L'élément focalisé au moment de la demande. */
  from: T | null;
}

/**
 * Une demande différée s'applique encore si aucune demande n'est venue après elle (une flèche pressée pendant
 * l'attente part de l'élément focalisé, elle ne doit pas être écrasée ensuite) et si personne n'a placé le focus
 * entre-temps (le focus est resté où il était, ou s'est perdu sur `body` quand la vue a été réaffichée).
 */
export function deferredFocusStands<T>(req: DeferredFocus<T>, latest: number, now: T | null, body: T | null): boolean {
  return req.ticket === latest && (now === req.from || now === body || now === null);
}
