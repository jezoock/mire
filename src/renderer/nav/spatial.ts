/**
 * Navigation spatiale : flèches du clavier, croix et stick de la manette.
 * Le choix du voisin (`pickNeighbor`) ne dépend que des rectangles : il sert à tout élément focalisable,
 * qu'il porte la classe `.focusable` (interface actuelle) ou soit un composant dot-stash (`ds-trigger`…).
 * Le service qui déplace le focus dans le document est `focus.ts` (P4-03).
 */
import { $ } from '../core/dom.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Rectangle à l'écran, comme le renvoie `getBoundingClientRect`. */
export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Ce que la navigation attend d'un élément : sa place à l'écran, et s'il est affiché et actif. */
export interface Navigable {
  getBoundingClientRect(): Rect;
  getClientRects(): { length: number };
  disabled?: boolean;
}

/** Éléments parcourus par les flèches dans l'interface actuelle. */
export const NAV_SELECTOR = '.focusable';

/** Un élément masqué (sans boîte à l'écran) ou désactivé n'est jamais une destination. */
export const isShown = (el: Navigable): boolean => el.getClientRects().length > 0 && !el.disabled;

const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));

/**
 * Voisin le plus proche de `from` dans la direction donnée, parmi `candidates` (sans l'élément de départ).
 * Seuls comptent les éléments situés entièrement de ce côté (2 px de tolérance) ; on préfère le plus proche,
 * puis le moins décalé, puis le mieux aligné. À score égal, le premier dans l'ordre du document l'emporte.
 * Les éléments masqués ou désactivés sont ignorés. Renvoie `null` s'il n'y a aucun voisin.
 */
export function pickNeighbor<T extends Navigable>(from: Rect, candidates: Iterable<T>, dir: Direction): T | null {
  const r = from;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (!isShown(el)) continue;
    const b = el.getBoundingClientRect();
    let main: number;
    let cross: number;
    if (dir === 'right') {
      if (b.left < r.right - 2) continue;
      main = b.left - r.right;
      cross = overlap(r.top, r.bottom, b.top, b.bottom);
    } else if (dir === 'left') {
      if (b.right > r.left + 2) continue;
      main = r.left - b.right;
      cross = overlap(r.top, r.bottom, b.top, b.bottom);
    } else if (dir === 'down') {
      if (b.top < r.bottom - 2) continue;
      main = b.top - r.bottom;
      cross = overlap(r.left, r.right, b.left, b.right);
    } else {
      if (b.bottom > r.top + 2) continue;
      main = r.top - b.bottom;
      cross = overlap(r.left, r.right, b.left, b.right);
    }
    const align = dir === 'left' || dir === 'right' ? Math.abs(b.top - r.top) : Math.abs(b.left - r.left);
    const score = Math.max(0, main) + cross * 3 + align * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

const viewEl = () => $('#view') as HTMLElement;

/**
 * Sélecteur qui retrouve l'élément du contenu après un nouvel affichage (par ses `data-*` ou son id), ou `null`.
 * Dans un composant : par la clé stable (`data-key`) ou par l'action du `ds-trigger` qui le contient.
 */
export function focusSelectorOf(target: Element | null): string | null {
  if (!target || !viewEl().contains(target)) return null;
  const el = target as HTMLElement;
  const parts = ['action', 'index', 'console', 'go', 'id', 'key']
    .filter((k) => el.dataset[k] != null)
    .map((k) => `[data-${k}="${CSS.escape(el.dataset[k] as string)}"]`);
  if (parts.length) return parts.join('');
  if (el.id) return `#${CSS.escape(el.id)}`;
  const trigger = el.closest('ds-trigger[action]');
  if (!trigger || !viewEl().contains(trigger)) return null;
  const attr = (name: string) => (trigger.hasAttribute(name) ? `[${name}="${CSS.escape(trigger.getAttribute(name) as string)}"]` : '');
  const own = `ds-trigger${attr('target')}${attr('action')}`;
  return trigger === el ? own : `${own} ${el.localName}`;
}
