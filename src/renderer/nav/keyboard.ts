/**
 * Clavier et télécommande : correspondance touche → action selon le contexte (listes, lecteur vidéo,
 * visionneuse d'images), puis traitement des touches. La manette passe par le même chemin (`fromPad`).
 * Les actions (retour, rechercher, modifier, lecteurs…) sont des méthodes des contrôleurs (P4-04) ; app.js ne fournit
 * plus que ce que le clavier doit savoir de l'affichage (boîte de dialogue, lecteur ouvert, barre d'un site).
 */
import { $ } from '../core/dom.ts';
import type { Controllers } from '../controllers/index.ts';
import { S } from '../state/index.ts';
import { focusFirst, moveFocus, type Direction } from './spatial.ts';

export type ListAction = Direction | 'activate' | 'back' | 'page-down' | 'page-up' | 'play-pause' | 'search' | 'edit' | 'delete';
export type VideoAction =
  | 'play'
  | 'rewind'
  | 'forward'
  | 'rewind-long'
  | 'forward-long'
  | 'volume-up'
  | 'volume-down'
  | 'mute'
  | 'fullscreen'
  | 'subtitles'
  | 'next'
  | 'prev'
  | 'close';
export type ImageAction = 'prev' | 'next' | 'slideshow' | 'fullscreen' | 'close';

/** Flèches : déplacement du focus. */
export const ARROW_KEYS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Listes et menus. */
export const LIST_KEYS: Readonly<Record<string, ListAction>> = {
  ...ARROW_KEYS,
  Enter: 'activate',
  Escape: 'back',
  Backspace: 'back',
  PageDown: 'page-down',
  PageUp: 'page-up',
  MediaPlayPause: 'play-pause',
  '/': 'search',
  e: 'edit',
  ContextMenu: 'edit',
  Delete: 'delete',
};

/** Lecteur vidéo (`Y` : touche envoyée par certaines télécommandes). */
export const VIDEO_KEYS: Readonly<Record<string, VideoAction>> = {
  ' ': 'play',
  k: 'play',
  Enter: 'play',
  MediaPlayPause: 'play',
  ArrowLeft: 'rewind',
  ArrowRight: 'forward',
  j: 'rewind-long',
  l: 'forward-long',
  ArrowUp: 'volume-up',
  ArrowDown: 'volume-down',
  m: 'mute',
  f: 'fullscreen',
  s: 'subtitles',
  Y: 'subtitles',
  n: 'next',
  PageDown: 'next',
  p: 'prev',
  PageUp: 'prev',
  Escape: 'close',
  Backspace: 'close',
};

/** Visionneuse d'images. */
export const IMAGE_KEYS: Readonly<Record<string, ImageAction>> = {
  ArrowLeft: 'prev',
  PageUp: 'prev',
  ArrowRight: 'next',
  PageDown: 'next',
  ' ': 'slideshow',
  Enter: 'slideshow',
  MediaPlayPause: 'slideshow',
  f: 'fullscreen',
  Escape: 'close',
  Backspace: 'close',
};

/** Action associée à la touche dans la table donnée, ou `null` (les noms hérités d'`Object` ne comptent pas). */
export function keyAction<A>(map: Readonly<Record<string, A>>, key: string): A | null {
  return Object.hasOwn(map, key) ? (map[key] as A) : null;
}

interface FieldLike {
  tagName?: string;
  type?: string;
}

/** Champ où l'on tape du texte : les touches y gardent leur effet habituel (sauf Échap et, en ligne, haut/bas). */
export function isTyping(el: FieldLike | null | undefined): boolean {
  const tag = el?.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'range', 'button'].includes(el?.type ?? ''));
}

/** Entrée active l'élément quand c'est un bouton ou une case (au clavier), ou toujours (à la manette). */
export function activatesOnEnter(el: FieldLike | null | undefined, fromPad: boolean): boolean {
  return fromPad || !!(el && (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type === 'checkbox')));
}

/** Ce que l'interface fournit au clavier. */
export interface KeyboardHooks {
  /** Boîte de dialogue au premier plan, ou `null`. */
  dialog(): HTMLElement | null;
  /** Touche pour le lecteur vidéo ou la visionneuse s'il est ouvert (`true` : touche traitée) ; `null` si aucun ne l'est. */
  overlayKey(key: string, fromPad: boolean): boolean | null;
  /** Flèche bas depuis la barre d'un site : donne le clavier au site. `false` si l'élément n'est pas dans cette barre. */
  webBarDown(el: Element | null): boolean;
}

/** Contrôleurs appelés par le clavier. */
export type KeyboardControllers = Pick<Controllers, 'app' | 'page' | 'player'>;

let hooks: KeyboardHooks;
let ctrl: KeyboardControllers;

/** Traite une touche (du clavier, ou traduite depuis la manette) ; `true` si elle a été utilisée. */
export function handleKey(key: string, fromPad = false): boolean {
  const dlg = hooks.dialog();
  if (dlg) {
    const inField = (document.activeElement as Element | null)?.matches?.('input, textarea, select');
    const dir = keyAction(ARROW_KEYS, key);
    if (dir && (!inField || dir === 'up' || dir === 'down')) {
      moveFocus(dir, dlg);
      return true;
    }
    if (key === 'Escape' && fromPad) {
      dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
      return true;
    }
    if (key === 'Enter' && fromPad) {
      (document.activeElement as HTMLElement | null)?.click();
      return true;
    }
    return false;
  }
  const overlay = hooks.overlayKey(key, fromPad);
  if (overlay !== null) return overlay;

  const a = document.activeElement as HTMLElement | null;
  if (isTyping(a)) {
    if (key === 'Escape') {
      a?.blur();
      focusFirst();
      return true;
    }
    if (a?.tagName === 'INPUT' && (key === 'ArrowDown' || key === 'ArrowUp')) {
      moveFocus(key === 'ArrowDown' ? 'down' : 'up');
      return true;
    }
    if (!fromPad) return false;
  }

  if (key === 'ArrowDown' && hooks.webBarDown(a)) return true;
  const action = keyAction(LIST_KEYS, key);
  const view = () => $('#view') as HTMLElement;
  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      moveFocus(action);
      return true;
    case 'activate':
      // Validation identique au clavier, à la télécommande et à la manette.
      if (activatesOnEnter(a, fromPad)) {
        a?.click();
        return true;
      }
      return false;
    case 'back':
      ctrl.app.back();
      return true;
    case 'page-down':
      view().scrollBy({ top: view().clientHeight * 0.8 });
      return true;
    case 'page-up':
      view().scrollBy({ top: -view().clientHeight * 0.8 });
      return true;
    case 'play-pause':
      ctrl.player.togglePlay();
      return true;
    case 'search':
      ctrl.app.go({ section: 'search', focus: 'keep' });
      return true;
    case 'edit':
      return ctrl.app.editSelection();
    case 'delete':
      return ctrl.page.deleteSelection();
    default:
      return false;
  }
}

/** Branche le clavier ; le passage de la souris au clavier change l'affichage du focus (classe `mouse`). */
export function initKeyboard(h: KeyboardHooks, controllers: KeyboardControllers): void {
  hooks = h;
  ctrl = controllers;
  document.addEventListener('keydown', (e) => {
    document.body.classList.remove('mouse');
    S.pendingFocus = false;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (handleKey(e.key, false)) e.preventDefault();
  });
  window.addEventListener(
    'mousemove',
    (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) document.body.classList.add('mouse');
    },
    { passive: true },
  );
  window.addEventListener('mousedown', () => document.body.classList.add('mouse'));
}
