/** Visionneuse d'images plein écran, avec diaporama. */
import { $ } from '../core/dom.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { I, S } from '../state/index.ts';
import { api } from '../api/index.ts';
import { IMAGE_KEYS, keyAction } from '../nav/keyboard.ts';
import { rememberFocus, restoreFocus } from '../nav/focus.ts';
import type { Playable } from './types.ts';
import type { Controllers } from '../controllers/index.ts';

/**
 * Contrôleurs appelés par la visionneuse : programme du système (formats non affichés ici), « Reprendre », vue web,
 * vue à remettre à jour en sortant.
 */
export type ImagesControllers = Pick<Controllers, 'player' | 'home' | 'web'>;

let ctrl: ImagesControllers;
const imageLayer = $('#image-layer') as HTMLElement;
const ivImg = $('#iv-img') as HTMLImageElement;

export const isImagesOpen = (): boolean => !imageLayer.hidden;

function wakeImages(): void {
  imageLayer.classList.remove('idle');
  clearTimeout(I.hideTimer);
  I.hideTimer = window.setTimeout(() => imageLayer.classList.add('idle'), 3000);
}

function showImage(): void {
  const it = I.list[I.i] as Playable | undefined;
  if (!it) return;
  ivImg.src = mediaUrl(it.path);
  ($('#iv-title') as HTMLElement).textContent = it.name;
  ($('#iv-count') as HTMLElement).textContent = `${I.i + 1} sur ${I.list.length}, ${it.folder}`;
  const nxt = I.list[I.i + 1] as Playable | undefined;
  if (nxt?.native) new Image().src = mediaUrl(nxt.path);
}

export function openImages(list: Playable[], i: number): void {
  const it = list[i];
  if (!it) return;
  if (!it.native) {
    ctrl.player.openExternal({ path: it.path, name: it.name });
    return;
  }
  I.returnFocus = rememberFocus();
  I.list = list.filter((x) => x.native);
  I.i = Math.max(0, I.list.indexOf(it));
  imageLayer.hidden = false;
  ctrl.web.sync();
  showImage();
  ctrl.home.addRecent(it);
  imageLayer.focus();
  wakeImages();
}

function stepImage(d: number): void {
  if (!I.list.length) return;
  I.i = (I.i + d + I.list.length) % I.list.length;
  showImage();
}

function toggleSlideshow(force?: boolean): void {
  const on = force ?? !I.timer;
  clearInterval(I.timer);
  I.timer = on ? window.setInterval(() => stepImage(1), 5000) : 0;
  ($('#iv-slide-lbl') as HTMLElement).textContent = on ? 'Arrêter le diaporama' : 'Diaporama';
  ($('#iv-slide [data-icon]') as HTMLElement).innerHTML = on ? ICON.pause : ICON.play;
}

export function closeImages(): void {
  toggleSlideshow(false);
  clearTimeout(I.hideTimer);
  imageLayer.hidden = true;
  imageLayer.classList.remove('idle');
  ivImg.removeAttribute('src');
  ctrl.web.sync();
  if (S.section === 'home') ctrl.player.refreshView();
  restoreFocus(I.returnFocus);
}

/** Touche dans la visionneuse (du clavier, ou traduite depuis la manette) ; `true` si elle a été utilisée. */
export function imageKey(key: string, fromPad: boolean): boolean {
  wakeImages();
  const a = document.activeElement;
  // Entrée et Espace gardent leur effet sur le bouton des commandes qui a le focus.
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== imageLayer && imageLayer.contains(a)) return false;
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

/** Branche les commandes de la visionneuse. */
export function initImages(controllers: ImagesControllers): void {
  ctrl = controllers;
  ivImg.addEventListener('error', () => {
    if (!imageLayer.hidden && ivImg.getAttribute('src')) toast('Cette image ne peut pas être affichée.');
  });
  imageLayer.addEventListener('mousemove', wakeImages);
  imageLayer.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closeImages();
    else if (act === 'prev') stepImage(-1);
    else if (act === 'next') stepImage(1);
    else if (act === 'slideshow') toggleSlideshow();
    if (!imageLayer.hidden) imageLayer.focus();
  });
}
