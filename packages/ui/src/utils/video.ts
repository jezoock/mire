/** Lecteur vidéo (P4-14) : textes et icônes de `mire-video-player`, et réglettes sans DOM. */

/** Textes du lecteur, déjà traduits par la page. */
export interface VideoPlayerLabels {
  close: string;
  external: string;
  seek: string;
  prev: string;
  next: string;
  play: string;
  volume: string;
  fullscreen: string;
}

/** Icônes du lecteur (balisage SVG du cœur), par nom. */
export type VideoPlayerIcons = Partial<Record<'close' | 'external' | 'prev' | 'next' | 'play' | 'pause' | 'subs' | 'volume' | 'fullscreen', string>>;

/** Pas de la réglette de position : elle va de 0 à 1000. */
export const SEEK_STEPS = 1000;

/** Valeur de la réglette de position pour une proportion lue (0 à 1). */
export const seekValue = (ratio: number): number => Math.round(Math.min(1, Math.max(0, Number(ratio) || 0)) * SEEK_STEPS);
