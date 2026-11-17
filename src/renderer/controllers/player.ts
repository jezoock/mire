import { Controller } from './base.ts';

/** `mire-player` : lecteurs intégrés et lecteur externe. */
export class PlayerController extends Controller {
  /** Ouvre un fichier dans le lecteur externe, à une position (secondes) facultative. */
  openExternal({ path, name, start = 0 }: { path: string; name: string; start?: number }): void {
    this.ctx.ui.openExternal({ path, name }, start);
  }

  /** Lecture ou pause de la musique. */
  togglePlay(): void {
    this.ctx.ui.toggleAudio();
  }

  /** Remet à jour la vue après la fermeture d'un lecteur (l'accueil montre « Reprendre »). */
  refreshView(): void {
    this.ctx.ui.render();
  }
}
