/**
 * Service de focus (P4-03) : la navigation spatiale de Mire sur les vues historiques (`.focusable`) et sur les
 * composants (`ds-*`, `mire-*`), qui cohabitent. Il choisit les destinations (aides de dot-stash et `pickNeighbor`),
 * attend qu'un composant soit rendu (`hydrated`) avant de choisir, limite la portée à la boîte de dialogue au premier
 * plan (historique ou `ds-modal`), gère la navigation par colonnes, relaie les touches de la manette aux composants qui
 * les traitent eux-mêmes, restaure le focus au retour d'un lecteur et fait défiler au stick droit.
 * Les règles sans DOM sont dans `targets.ts` ; le choix du voisin dans `spatial.ts`.
 */
import { getTabbableElements, isTabbable } from 'dot-stash/dist/collection/utils/focus.js';
import { $, $$ } from '../core/dom.ts';
import { NAV_SELECTOR, focusSelectorOf, isShown, pickNeighbor, type Direction } from './spatial.ts';
import { COLUMN_ATTR, COLUMNS_ATTR, COLUMNS_VALUE, componentOf, isComponentTag, isDisabled, nextColumn, pickInColumn, relaysPadKey } from './targets.ts';

const viewEl = () => $('#view') as HTMLElement;
const COLUMNS_SELECTOR = `[${COLUMNS_ATTR}="${COLUMNS_VALUE}"]`;
const COLUMN_SELECTOR = `[${COLUMN_ATTR}]`;

/* ------------------------------------------------------------------ */
/* Destinations                                                         */
/* ------------------------------------------------------------------ */

const asElement = (scope: ParentNode): Element | null => (scope instanceof Document ? scope.body : scope instanceof Element ? scope : null);

/**
 * Composants les plus extérieurs de `scope`, hors des parties masquées (`hidden`). Une portée située dans un composant
 * (le cadre d'un `ds-modal`) compte elle-même comme un composant.
 */
function componentHosts(scope: ParentNode): Element[] {
  const root = asElement(scope);
  if (!root) return [];
  if (componentOf(root)) return [root];
  const hosts: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.hasAttribute('hidden')) return NodeFilter.FILTER_REJECT;
      if (isComponentTag(el.localName)) {
        hosts.push(el);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  while (walker.nextNode());
  return hosts;
}

function componentTargets(host: Element): HTMLElement[] {
  // Aides de dot-stash : atteint par Tab (ni masqué, ni inerte, ni `tabindex="-1"`) ; règle des désactivés de Mire.
  const inside = getTabbableElements(host);
  const all = host instanceof HTMLElement && isComponentTag(host.localName) && isTabbable(host) ? [host, ...inside] : inside;
  // Un `.focusable` d'un composant suit la règle des vues historiques (liste `NAV_SELECTOR`).
  return all.filter((el) => !el.matches(NAV_SELECTOR) && isShown(el) && !isDisabled(el));
}

const inDocumentOrder = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

/**
 * Destinations des flèches dans `scope`, dans l'ordre du document : les `.focusable` des vues historiques (affichés,
 * propriété `disabled` fausse : règle inchangée) et les éléments focalisables des composants.
 */
export function navTargets(scope: ParentNode = document): HTMLElement[] {
  const legacy = $$(NAV_SELECTOR, scope).filter(isShown);
  const hosts = componentHosts(scope);
  if (!hosts.length) return legacy;
  return [...legacy, ...hosts.flatMap(componentTargets)].sort(inDocumentOrder);
}

/* ------------------------------------------------------------------ */
/* Composants pas encore rendus                                        */
/* ------------------------------------------------------------------ */

const isPending = (el: Element) =>
  isComponentTag(el.localName) && !!customElements.get(el.localName) && !el.classList.contains('hydrated') && !el.closest('[hidden]');

/** Composants définis mais pas encore rendus dans `scope` (un `ds-*` inséré par `innerHTML` se rend plus tard). */
function hasPending(scope: ParentNode): boolean {
  return componentHosts(scope).some((host) => isPending(host) || [...host.querySelectorAll('*')].some(isPending));
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Attend que les composants de `scope` soient rendus (classe `hydrated`), au plus `timeout` ms. */
export async function whenHydrated(scope: ParentNode = document, timeout = 1500): Promise<void> {
  const end = performance.now() + timeout;
  while (hasPending(scope) && performance.now() < end) await nextFrame();
}

/* ------------------------------------------------------------------ */
/* Déplacement du focus                                                 */
/* ------------------------------------------------------------------ */

/** Dernier élément focalisé de chaque colonne, retrouvé quand on y revient. */
const columnMemory = new WeakMap<Element, HTMLElement>();

/** Donne le focus et montre l'élément ; dans un `ds-scroller`, la rangée défile d'elle-même, la page montre la rangée. */
function reveal(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  (el.closest('ds-scroller') ?? el).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
}

/**
 * Navigation par colonnes (`data-nav="columns"`, colonnes `data-nav-column`) : haut et bas restent dans la colonne,
 * gauche et droite changent de colonne. Au bord, on sort du conteneur vers l'élément voisin le plus proche.
 * `undefined` si l'élément n'est pas dans une colonne.
 */
function columnsMove(cur: HTMLElement, dir: Direction, targets: HTMLElement[]): HTMLElement | null | undefined {
  const box = cur.closest(COLUMNS_SELECTOR);
  const col = cur.closest(COLUMN_SELECTOR);
  if (!box || !col || !box.contains(col)) return undefined;
  const columns = $$(COLUMN_SELECTOR, box).filter((c) => c.closest(COLUMNS_SELECTOR) === box);
  const inColumn = (c: Element) => targets.filter((el) => el.closest(COLUMN_SELECTOR) === c);
  const from = cur.getBoundingClientRect();
  let pick: HTMLElement | null = null;
  if (dir === 'up' || dir === 'down') {
    pick = pickNeighbor(
      from,
      inColumn(col).filter((el) => el !== cur),
      dir,
    );
  } else {
    const j = nextColumn(columns.length, columns.indexOf(col as HTMLElement), dir, (k) => inColumn(columns[k] as Element).length > 0);
    const target = columns[j];
    if (target) pick = pickInColumn(from, inColumn(target), columnMemory.get(target) ?? null);
  }
  if (pick && pick.closest(COLUMN_SELECTOR) !== col) columnMemory.set(col, cur);
  return (
    pick ??
    pickNeighbor(
      from,
      targets.filter((el) => !box.contains(el)),
      dir,
    )
  );
}

function moveNow(dir: Direction, scope: ParentNode): void {
  const targets = navTargets(scope);
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !targets.includes(cur)) {
    // Comme avant P4-03 : le premier élément du contenu, sinon de la portée ; dans un `ds-modal`, celui du cadre.
    const first = componentOf(asElement(scope)) ? targets[0] : navTargets(viewEl())[0] || targets[0];
    first?.focus();
    return;
  }
  const best =
    columnsMove(cur, dir, targets) ??
    pickNeighbor(
      cur.getBoundingClientRect(),
      targets.filter((el) => el !== cur),
      dir,
    );
  if (best) reveal(best);
}

/**
 * Déplace le focus vers le voisin dans la direction donnée, parmi les destinations de `scope`. Si le focus n'est sur
 * aucune d'elles, il va au premier élément du contenu (ou de `scope`). Des composants pas encore rendus dans `scope` :
 * le choix attend leur rendu.
 */
export function moveFocus(dir: Direction, scope: ParentNode = document): void {
  if (hasPending(scope)) void whenHydrated(scope).then(() => moveNow(dir, scope));
  else moveNow(dir, scope);
}

function focusFirstNow(): void {
  const all = navTargets(viewEl());
  const el = all.find((x) => !x.closest('.focus-info, .tabs')) || all[0] || $('.rail-item[aria-current]');
  el?.focus();
}

/** Premier élément du contenu ; le panneau d'infos et les onglets ne passent qu'en dernier recours. */
export function focusFirst(): void {
  if (hasPending(viewEl())) void whenHydrated(viewEl()).then(focusFirstNow);
  else focusFirstNow();
}

/* ------------------------------------------------------------------ */
/* Retour d'un lecteur                                                  */
/* ------------------------------------------------------------------ */

/** Où était le focus à l'ouverture d'un lecteur. */
export interface FocusMemo {
  /** L'élément lui-même, s'il est dans un composant (retrouvé tel quel si la vue n'a pas été réaffichée). */
  el: HTMLElement | null;
  /** Le sélecteur qui le retrouve après un nouvel affichage (`focusSelectorOf`). */
  sel: string | null;
}

export function rememberFocus(): FocusMemo {
  const a = document.activeElement as HTMLElement | null;
  const inView = !!a && viewEl().contains(a);
  return { el: inView && componentOf(a) ? a : null, sel: focusSelectorOf(a) };
}

function memoTarget(memo: FocusMemo | null): HTMLElement | null {
  if (memo?.el?.isConnected && viewEl().contains(memo.el)) return memo.el;
  return memo?.sel ? viewEl().querySelector<HTMLElement>(memo.sel) : null;
}

/**
 * Rend le focus à l'élément retenu à l'ouverture du lecteur, sinon au premier élément du contenu. Un composant
 * réaffiché, pas encore rendu, est attendu.
 */
export function restoreFocus(memo: FocusMemo | null): void {
  const back = memoTarget(memo);
  if (!back) {
    focusFirst();
    return;
  }
  back.focus();
  if (document.activeElement === back || !hasPending(viewEl())) return;
  void whenHydrated(viewEl()).then(() => {
    const again = memoTarget(memo);
    if (again) again.focus();
    else focusFirstNow();
  });
}

/* ------------------------------------------------------------------ */
/* Boîtes de dialogue                                                   */
/* ------------------------------------------------------------------ */

const openedAt = (el: Element | null) => Number((el as HTMLElement | null)?.dataset.opened || 0);

interface ModalElement extends HTMLElement {
  shown: boolean;
}

/** `ds-modal` affiché le plus récemment, ou `null`. */
function topModal(): ModalElement | null {
  const shown = $$<ModalElement>('ds-modal').filter((m) => m.shown);
  return shown.sort((a, b) => openedAt(a) - openedAt(b)).pop() ?? null;
}

/**
 * Boîte de dialogue au premier plan : la dernière ouverte entre la boîte historique `legacy` (`dialog[open]`) et les
 * `ds-modal` affichés. Pour un `ds-modal`, c'est son cadre (`role="dialog"`), portée des flèches et de la manette.
 */
export function activeDialog(legacy: HTMLElement | null): HTMLElement | null {
  const modal = topModal();
  if (!modal || (legacy && openedAt(legacy) > openedAt(modal))) return legacy;
  return modal.querySelector<HTMLElement>('[role="dialog"]') ?? modal;
}

/** Ferme la boîte de dialogue `box` comme Échap : `ds-modal` masqué, boîte historique annulée (`cancel`). */
export function closeDialog(box: HTMLElement): void {
  const modal = box.closest<ModalElement>('ds-modal');
  if (modal) modal.shown = false;
  else box.dispatchEvent(new Event('cancel', { cancelable: true }));
}

/* ------------------------------------------------------------------ */
/* Touches relayées aux composants                                      */
/* ------------------------------------------------------------------ */

const relayed = new WeakSet<Event>();

/** Vrai pour une touche relayée par `relayPadKey` : le clavier de Mire ne la traite pas une seconde fois. */
export const isRelayed = (e: Event): boolean => relayed.has(e);

/**
 * Vrai si une vraie touche a été traitée par le composant qui a le focus (il en a empêché l'effet par défaut) :
 * flèches des onglets de `ds-panel-group`, de `ds-combo` ouvert, Entrée et Espace de `ds-trigger`…
 */
export const handledByComponent = (e: Event): boolean => e.defaultPrevented && !!componentOf(e.target as Element | null);

/**
 * Propose une touche de la manette au composant qui a le focus, comme si elle venait du clavier. `true` s'il l'a
 * traitée (effet par défaut empêché, ou propagation arrêtée comme Échap dans `ds-modal`) : la manette s'arrête là.
 */
export function relayPadKey(key: string): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !relaysPadKey(el, key)) return false;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  relayed.add(event);
  let reached = false;
  const spy = (e: Event) => {
    if (e === event) reached = true;
  };
  document.addEventListener('keydown', spy);
  try {
    el.dispatchEvent(event);
  } finally {
    document.removeEventListener('keydown', spy);
  }
  return event.defaultPrevented || !reached;
}

/* ------------------------------------------------------------------ */
/* Colonnes et défilement au stick droit                                */
/* ------------------------------------------------------------------ */

/** Vrai si l'élément est dans une navigation par colonnes. */
export const inColumns = (el: Element | null): boolean => !!el?.closest(`${COLUMNS_SELECTOR} ${COLUMN_SELECTOR}`);

function scrollableAncestor(el: Element, dx: number, dy: number): HTMLElement | null {
  for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
    const style = getComputedStyle(x);
    const canY = dy !== 0 && /auto|scroll/.test(style.overflowY) && x.scrollHeight > x.clientHeight;
    const canX = dx !== 0 && /auto|scroll/.test(style.overflowX) && x.scrollWidth > x.clientWidth;
    if (canX || canY) return x;
  }
  return null;
}

/**
 * Stick droit : dans un composant ou une colonne, fait défiler la zone qui contient le focus (rangée, colonne, cadre
 * d'un `ds-modal`) ; dans les listes historiques, la vue, verticalement, comme avant.
 */
export function stickScroll(dx: number, dy: number, ctx: string): void {
  const a = document.activeElement;
  if (a && (ctx === 'columns' || (componentOf(a) && (ctx === 'list' || ctx === 'dialog')))) {
    const box = scrollableAncestor(a, dx, dy);
    if (box) {
      box.scrollBy(dx, dy);
      return;
    }
  }
  if (ctx === 'list' && dy) viewEl().scrollBy(0, dy);
}

/** Branche le service : date d'ouverture des `ds-modal`, pour savoir lequel est au premier plan. */
export function initFocus(): void {
  document.addEventListener('modalOpen', (e) => {
    const el = e.target as HTMLElement;
    if (el.localName === 'ds-modal') el.dataset.opened = String(Date.now() + Math.random());
  });
}
