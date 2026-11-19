import { Controller } from './base.ts';

/**
 * `mire-image-viewer` : les commandes de la visionneuse d'images (P4-15), appelées par ses `ds-trigger`. La visionneuse elle-même (`src/renderer/players/images.ts`) est injectée dans le contexte
 * (`ui.images`).
 */
export class ImagesController extends Controller {
  /** Ferme la visionneuse. */
  close(): void {
    this.ctx.ui.images.close();
  }

  /** Image précédente ou suivante, en boucle. */
  previous(): void {
    this.ctx.ui.images.step(-1);
  }

  next(): void {
    this.ctx.ui.images.step(1);
  }

  /** Lance ou arrête le diaporama. */
  toggleSlideshow(): void {
    this.ctx.ui.images.toggleSlideshow();
  }
}
