/**
 * Éditeurs (P4-22) : hôte `mire-editor` dans la page (cible des `ds-trigger` de son contrôleur) et clic droit sur une
 * carte du catalogue (vue de page, accueil, Recherche). La touche E et le bouton X de la manette passent par
 * `mire-app` (`editSelection`).
 */
import { groupRefOfAction, type GroupRef } from './group-model.ts';

export { openEditor } from './editor.ts';
export { openGroupEditor } from './group-editor.ts';
export * from './model.ts';
export * from './group-model.ts';

/** Clé de l'élément du catalogue dont la carte contient `node` (ou l'élément qui a le focus), sinon `null`. */
export function cardKeyOf(node: Element | null = document.activeElement): string | null {
  // Une carte, ou une ligne d'élément de l'explorateur (P4-08) qui n'a pas disparu du catalogue.
  const trigger = node?.closest('mire-card [data-key], .mire-explorer-view__row[data-key]:not([data-unavailable])') as HTMLElement | null;
  return trigger?.dataset.key || null;
}

/**
 * Regroupement dont la carte contient `node` (ou l'élément qui a le focus) : une `mire-group-card` ou un titre de
 * rangée, désignés par leur action `openGroup` ; `route` : page et chemin affichés par la vue de page.
 */
export function groupRefOf(node: Element | null, route: GroupRef | null): GroupRef | null {
  const trigger = node?.closest('ds-trigger') ?? null;
  return trigger ? groupRefOfAction(trigger.getAttribute('action'), !!trigger.closest('mire-page-view'), route) : null;
}

/** Place l'hôte `mire-editor` et ouvre l'éditeur d'une carte (élément ou regroupement) au clic droit. */
export function initEditors(doc: Document, edit: (key: string) => void, editGroup?: (target: Element | null) => GroupRef | null): HTMLElement {
  const host = doc.querySelector<HTMLElement>('mire-editor') ?? doc.body.appendChild(doc.createElement('mire-editor'));
  doc.addEventListener('contextmenu', (e) => {
    const key = cardKeyOf(e.target as Element | null);
    if (key) {
      e.preventDefault();
      edit(key);
    } else if (editGroup?.(e.target as Element | null)) e.preventDefault();
  });
  return host;
}
