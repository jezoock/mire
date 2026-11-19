import { Controller } from './base.ts';

/**
 * `mire-video-player` : les commandes du lecteur vidéo (P4-14), appelées par ses `ds-trigger`, par les touches et par
 * la manette. Le lecteur lui-même (`src/renderer/players/video.ts`) est injecté dans le contexte (`ui.video`).
 */
export class VideoController extends Controller {
  /** Ferme le lecteur (la position est gardée). */
  close(): void {
    this.ctx.ui.video.close();
  }

  /** Lecture ou pause. */
  togglePlay(): void {
    this.ctx.ui.video.togglePlay();
  }

  /** Vidéo précédente ou suivante de la liste, s'il y en a une. */
  previous(): void {
    this.ctx.ui.video.step(-1);
  }

  next(): void {
    this.ctx.ui.video.step(1);
  }

  /** Sous-titres suivants, puis aucun. */
  cycleSubtitles(): void {
    this.ctx.ui.video.cycleSubtitles();
  }

  /** Plein écran de la fenêtre. */
  toggleFullscreen(): void {
    this.ctx.api.toggleFullscreen();
  }

  /** Ferme le lecteur et reprend la vidéo dans le lecteur externe, à la même position. */
  openExternal(): void {
    this.ctx.ui.video.openExternally();
  }
}
