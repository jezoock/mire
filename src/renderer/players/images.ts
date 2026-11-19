/** Visionneuse d'images plein écran, avec diaporama (`mire-image-viewer`, P4-15). Règles sans DOM : `images-model.ts`. */
import { $ } from '../core/dom.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { i18n, t } from '../i18n/index.ts';
import { I, S } from '../state/index.ts';
import { api } from '../api/index.ts';
import { IMAGE_KEYS, keyAction } from '../nav/keyboard.ts';
import { rememberFocus, restoreFocus } from '../nav/focus.ts';
import { IDLE_DELAY, SLIDESHOW_DELAY, imageSubheading, preloadPath, viewerList, wrapStep } from './images-model.ts';
import type { Playable } from './types.ts';
import type { Controllers } from '../controllers/index.ts';
import type { ImagesUi } from '../controllers/types.ts';

/**
 * Contrôleurs appelés par la visionneuse : programme du système (formats non affichés ici), « Reprendre », vue web,
 * vue à remettre à jour en sortant.
 */
export type ImagesControllers = Pick<Controllers, 'player' | 'home' | 'web'>;

/** Propriétés de `mire-image-viewer` (voir le composant). */
type ViewerEl = HTMLElement & {
  heading: string;
  subheading: string;
  src: string;
  preload: string;
  slideshow: boolean;
  idle: boolean;
  labels: string;
  icons: string;
};

let ctrl: ImagesControllers;
const viewer = $('mire-image-viewer') as ViewerEl;

export const isImagesOpen = (): boolean => !viewer.hidden;

function labels(): string {
  const k = (key: string) => t(`player.images.${key}`);
  return JSON.stringify({ close: k('close'), prev: k('prev'), next: k('next'), slideshow: k('slideshow'), slideshowStop: k('slideshowStop') });
}

function wakeImages(): void {
  viewer.idle = false;
  clearTimeout(I.hideTimer);
  I.hideTimer = window.setTimeout(() => (viewer.idle = true), IDLE_DELAY);
}

/** Titre et place de l'image, rédigés dans la langue de l'interface. */
function showHeading(): void {
  const it = I.list[I.i] as Playable | undefined;
  if (!it) return;
  viewer.heading = it.name;
  viewer.subheading = imageSubheading(I.i, I.list.length, it.folder as string, t);
}

function showImage(): void {
  const it = I.list[I.i] as Playable | undefined;
  if (!it) return;
  viewer.src = mediaUrl(it.path);
  showHeading();
  const next = preloadPath(I.list as Playable[], I.i);
  viewer.preload = next ? mediaUrl(next) : '';
}

export function openImages(list: Playable[], i: number): void {
  const it = list[i];
  if (!it) return;
  if (!it.native) {
    ctrl.player.openExternal({ path: it.path, name: it.name });
    return;
  }
  I.returnFocus = rememberFocus();
  const shown = viewerList(list, it);
  I.list = shown.list;
  I.i = shown.index;
  viewer.hidden = false;
  ctrl.web.sync();
  showImage();
  ctrl.home.addRecent(it);
  viewer.focus();
  wakeImages();
}

function stepImage(d: number): void {
  if (!I.list.length) return;
  I.i = wrapStep(I.i, I.list.length, d);
  showImage();
}

function toggleSlideshow(force?: boolean): void {
  const on = force ?? !I.timer;
  clearInterval(I.timer);
  I.timer = on ? window.setInterval(() => stepImage(1), SLIDESHOW_DELAY) : 0;
  viewer.slideshow = on;
}

export function closeImages(): void {
  toggleSlideshow(false);
  clearTimeout(I.hideTimer);
  viewer.hidden = true;
  viewer.idle = false;
  // Rien de l'image fermée ne reste affiché à la prochaine ouverture.
  viewer.src = '';
  viewer.preload = '';
  viewer.heading = '';
  viewer.subheading = '';
  ctrl.web.sync();
  if (S.section === 'home') ctrl.player.refreshView();
  restoreFocus(I.returnFocus);
}

/** Après une commande à la souris, le focus revient à la visionneuse (les flèches changent d'image). */
function refocus(): void {
  if (!viewer.hidden) viewer.focus();
}

/** Commandes de la visionneuse, appelées par son contrôleur (`mire-image-viewer`). */
export const imagesUi: ImagesUi = {
  close: closeImages,
  step(d) {
    stepImage(d);
    refocus();
  },
  toggleSlideshow() {
    toggleSlideshow();
    refocus();
  },
};

/** Touche dans la visionneuse (du clavier, ou traduite depuis la manette) ; `true` si elle a été utilisée. */
export function imageKey(key: string, fromPad: boolean): boolean {
  wakeImages();
  const a = document.activeElement;
  // Entrée et Espace gardent leur effet sur le bouton des commandes qui a le focus.
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== viewer && viewer.contains(a) && a.matches('button')) return false;
  switch (keyAction(IMAGE_KEYS, key)) {
    case 'prev':
      stepImage(-1);
      return true;
    case 'next':
      stepImage(1);
      return true;
    case 'slideshow':
      toggleSlideshow();
      return true;
    case 'fullscreen':
      api.toggleFullscreen();
      return true;
    case 'close':
      closeImages();
      return true;
    default:
      return false;
  }
}

/** Branche la visionneuse : textes, icônes, image illisible, affichage réveillé par la souris. */
export function initImages(controllers: ImagesControllers): void {
  ctrl = controllers;
  viewer.icons = JSON.stringify(ICON);
  viewer.labels = labels();
  i18n.onChange(() => {
    viewer.labels = labels();
    showHeading();
  });
  viewer.addEventListener('mireImageError', () => {
    if (!viewer.hidden) toast(t('player.images.error'));
  });
  viewer.addEventListener('mousemove', wakeImages);
}
