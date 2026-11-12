/**
 * Manette : lecture à chaque image, commandes selon le contexte, et rappel des boutons à l'écran.
 * Les correspondances et libellés sont dans gamepad-data.ts ; ce que font les actions propres à l'interface
 * (changer de section, modifier, piloter un site) est fourni par app.js.
 */
import { $ } from '../core/dom.ts';
import { S } from '../state/index.ts';
import { toast } from '../ui/toast.ts';
import { handleKey } from './keyboard.ts';
import { moveFocus, type Direction } from './spatial.ts';
import {
  IMAGE_PAD,
  LIST_PAD,
  PAD_NAMES,
  VIDEO_PAD,
  WEB_PAD,
  padFamily,
  padHintsHtml,
  padKey,
  padPresses,
  readPad,
  type PadContext,
  type PadFamily,
  type PadMemory,
} from './gamepad-data.ts';

/** Ce que l'interface fournit à la manette. */
export interface GamepadHooks {
  /** Contexte affiché : boîte de dialogue, lecteur vidéo, visionneuse, site ou listes. */
  context(): PadContext;
  /** Boîte de dialogue au premier plan, ou `null`. */
  dialog(): HTMLElement | null;
  /** LB / RB : section précédente (-1) ou suivante (1). */
  cycleSection(d: number): void;
  /** X : modifier l'élément sélectionné, s'il est modifiable. */
  edit(el: Element | null): void;
  /** Envoie une touche au site affiché (`Up`, `Enter`, `ShiftTab`…). */
  webKey(key: string): void;
  /** Donne la manette au site (`toSite`), ou revient aux menus de Mire. */
  webToggle(toSite: boolean): void;
}

let hooks: GamepadHooks;
const mem: PadMemory = { prev: {}, repeatAt: {} };
const DIRS: Readonly<Record<string, Direction>> = { up: 'up', down: 'down', left: 'left', right: 'right' };

function padPress(k: string): void {
  const ctx = hooks.context();
  if (ctx === 'web') {
    if (k === 'select' || k === 'home') {
      hooks.webToggle(!S.webFocused);
      return;
    }
    const webKey = padKey(WEB_PAD, k);
    if (S.webFocused && webKey) {
      hooks.webKey(webKey);
      return;
    }
    const key = padKey(LIST_PAD, k);
    if (key) handleKey(key, true);
    return;
  }
  if (ctx === 'dialog') {
    const box = hooks.dialog() as HTMLElement;
    const dir = Object.hasOwn(DIRS, k) ? DIRS[k] : undefined;
    if (dir) moveFocus(dir, box);
    else if (k === 'a') (document.activeElement as HTMLElement | null)?.click?.();
    else if (k === 'b') box.dispatchEvent(new Event('cancel', { cancelable: true }));
    return;
  }
  if (ctx === 'video' || ctx === 'image') {
    const key = padKey(ctx === 'video' ? VIDEO_PAD : IMAGE_PAD, k);
    if (key) handleKey(key, true);
    return;
  }
  if (k === 'x') {
    hooks.edit(document.activeElement);
    return;
  }
  if (k === 'lb' || k === 'rb') {
    hooks.cycleSection(k === 'lb' ? -1 : 1);
    return;
  }
  if (k === 'select') {
    $('.rail-item[aria-current]')?.focus();
    return;
  }
  const key = padKey(LIST_PAD, k);
  if (key) handleKey(key, true);
}

let padCtxShown = '';

/** Barre de rappel des boutons : mise à jour quand le contexte ou la manette change (ou si `force`). */
export function updatePadbar(force = false): void {
  const padbar = $('#padbar') as HTMLElement;
  const ctx = S.pad ? hooks.context() : '';
  const key = `${ctx}|${S.pad?.family || ''}`;
  if (!force && key === padCtxShown) return;
  padCtxShown = key;
  const html = S.pad ? padHintsHtml(ctx, S.pad.family as PadFamily) : null;
  document.body.classList.toggle('has-pad', html !== null);
  if (html === null) {
    padbar.hidden = true;
    return;
  }
  padbar.innerHTML = html;
  padbar.hidden = false;
}

function setPad(gp: Gamepad): void {
  const family = padFamily(gp.id);
  const isNew = !S.pad || S.pad.id !== gp.id;
  S.pad = { id: gp.id, family };
  if (isNew) toast(`Manette ${PAD_NAMES[family]} détectée. Les commandes s’affichent en bas de l’écran.`, { duration: 4500 });
  updatePadbar(true);
}

const connectedPads = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p) : []);

function pollPads(now: number): void {
  const pads = connectedPads();
  const usable = document.visibilityState === 'visible' && (document.hasFocus() || (S.section === 'web' && S.webFocused));
  if (pads.length && !S.pad) setPad(pads[0] as Gamepad);
  if (pads.length && usable) {
    const gp = pads[0] as Gamepad;
    for (const { button, first } of padPresses(readPad(gp), mem, now)) {
      if (first) {
        document.body.classList.remove('mouse');
        S.pendingFocus = false;
      }
      padPress(button);
    }
    // Stick droit : défilement de la liste.
    const ry = gp.axes[3] || 0;
    if (Math.abs(ry) > 0.3 && hooks.context() === 'list') ($('#view') as HTMLElement).scrollBy(0, ry * 22);
  }
  updatePadbar();
  requestAnimationFrame(pollPads);
}

/** Branche les événements de connexion de la manette. */
export function initGamepad(h: GamepadHooks): void {
  hooks = h;
  window.addEventListener('gamepadconnected', (e) => setPad(e.gamepad));
  window.addEventListener('gamepaddisconnected', () => {
    const left = connectedPads();
    if (left.length) setPad(left[0] as Gamepad);
    else {
      S.pad = null;
      updatePadbar(true);
      toast('Manette déconnectée');
    }
  });
}

/** Lance la lecture de la manette, à chaque image. */
export function startGamepad(): void {
  requestAnimationFrame(pollPads);
}
