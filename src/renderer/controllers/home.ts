import { Controller, findBy } from './base.ts';
import type { Data } from './types.ts';

/** `mire-home` : accueil (« Reprendre »). */
export class HomeController extends Controller {
  /** Reprend un élément de « Reprendre », désigné par son chemin. */
  playRecent({ path }: { path: string }): void {
    const it = findBy(this.ctx.S.recent, 'path', path);
    if (it) this.ctx.ui.playRecent(it);
  }

  /** Ajoute un élément lu en tête de « Reprendre » (appelé par les lecteurs). */
  addRecent(item: Data): void {
    this.ctx.ui.addRecent(item);
  }
}
