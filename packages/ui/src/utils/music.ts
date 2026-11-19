/** Lecteurs de musique et d'images (P4-15) : textes et icônes de `mire-mini-player` et de `mire-image-viewer`. */

/** Textes du mini-lecteur, déjà traduits par la page. */
export interface MiniPlayerLabels {
  prev: string;
  play: string;
  next: string;
  seek: string;
  volume: string;
  stop: string;
}

/** Icônes du mini-lecteur (balisage SVG du cœur), par nom. */
export type MiniPlayerIcons = Partial<Record<'prev' | 'play' | 'pause' | 'next' | 'volume' | 'close', string>>;

/** Textes de la visionneuse, déjà traduits par la page. */
export interface ImageViewerLabels {
  close: string;
  prev: string;
  next: string;
  slideshow: string;
  slideshowStop: string;
}

/** Icônes de la visionneuse (balisage SVG du cœur), par nom. */
export type ImageViewerIcons = Partial<Record<'close' | 'play' | 'pause' | 'chevL' | 'chevR', string>>;
