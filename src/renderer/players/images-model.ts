/**
 * Visionneuse d'images, sans DOM (P4-15) : liste parcourue, image suivante en boucle, image à précharger, textes.
 * Testé tel quel ; `images.ts` s'en sert pour piloter `mire-image-viewer`.
 */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Le diaporama passe à l'image suivante toutes les 5 s. */
export const SLIDESHOW_DELAY = 5000;
/** Sans mouvement de la souris ni touche pendant 3 s, l'affichage se cache. */
export const IDLE_DELAY = 3000;

interface Viewable {
  path: string;
  native?: boolean;
}

/**
 * Images parcourues par la visionneuse depuis une liste : celles qu'elle sait afficher (les autres s'ouvrent dans le
 * programme du système), et la place de l'image choisie parmi elles (0 si elle n'y est pas).
 */
export function viewerList<T extends Viewable>(list: readonly T[], item: T): { list: T[]; index: number } {
  const shown = list.filter((x) => x.native);
  return { list: shown, index: Math.max(0, shown.indexOf(item)) };
}

/** Image suivante (`delta` 1) ou précédente (-1), en boucle. */
export function wrapStep(index: number, count: number, delta: number): number {
  return count ? (((index + delta) % count) + count) % count : 0;
}

/** Image à précharger après celle-ci : la suivante, sauf après la dernière ; `null` s'il n'y en a pas. */
export function preloadPath(list: readonly Viewable[], index: number): string | null {
  const next = list[index + 1];
  return next?.native ? next.path : null;
}

/** Sous-titre de la visionneuse : la place de l'image et son dossier. */
export function imageSubheading(index: number, count: number, folder: string, t: Translate): string {
  return t('player.images.position', { index: index + 1, count, folder });
}

/** Libellé du bouton du diaporama, selon qu'il tourne ou non. */
export const slideshowLabel = (running: boolean, t: Translate): string => t(running ? 'player.images.slideshowStop' : 'player.images.slideshow');
