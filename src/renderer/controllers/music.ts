import { Controller } from './base.ts';

/**
 * `mire-mini-player` : les commandes du mini-lecteur de musique (P4-15), appelées par ses `ds-trigger`. Le lecteur
 * lui-même (`src/renderer/players/audio.ts`) est injecté dans le contexte (`ui.music`).
 */
export class MusicController extends Controller {
  /** Morceau précédent ; après 3 s de lecture, retour au début du morceau. */
  previous(): void {
    this.ctx.ui.music.step(-1);
  }

  /** Lecture ou pause. */
  togglePlay(): void {
    this.ctx.ui.music.togglePlay();
  }

  /** Morceau suivant ; après le dernier, la lecture s'arrête. */
  next(): void {
    this.ctx.ui.music.step(1);
  }

  /** Arrête la musique et ferme le mini-lecteur. */
  stop(): void {
    this.ctx.ui.music.stop();
  }
}
