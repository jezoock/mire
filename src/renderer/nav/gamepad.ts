/**
 * Manette : lecture à chaque image, commandes selon le contexte, et rappel des boutons à l'écran.
 * Les correspondances et libellés sont dans gamepad-data.ts ; les actions propres à l'interface (changer de
 * section, modifier, piloter un site) sont des méthodes des contrôleurs (P4-04).
 */
import { $ } from '../core/dom.ts';
import { S } from '../state/index.ts';
import { toast } from '../ui/toast.ts';
import { i18n, t } from '../i18n/index.ts';
import type { Controllers } from '../controllers/index.ts';
import { handleKey } from './keyboard.ts';
import { activeDialog, closeDialog, inColumns, moveFocus, relayPadKey, stickScroll } from './focus.ts';
import type { Direction } from './spatial.ts';
import type { GamepadProfile } from '@mire/shared/ipc';
import {
  GENERIC_PROFILE,
  IMAGE_PAD,
  LIST_PAD,
  isGlyphKey,
  VIDEO_PAD,
  WEB_PAD,
  padHints,
  padKey,
  padMatchers,
  padPresses,
  padProfile,
  readPad,
  rescueCombo,
  type PadContext,
  type PadMatcher,
  type PadMemory,
} from './gamepad-data.ts';

/** Ce que l'interface fournit à la manette. */
export interface GamepadHooks {
  /** Contexte affiché : boîte de dialogue, lecteur vidéo, visionneuse, site ou listes. */
  context(): PadContext;
  /** Combinaison du mode secours (Affichage + Menu) : ouvrir l'explorateur (P4-10). */
  rescue?(): void;
  /** Profils de manettes des plugins actifs (P5-04) ; sans eux, le profil générique. */
  profiles?(): Promise<GamepadProfile[]>;
  /** Abonnement : profils changés (plugin activé ou désactivé). */
  onProfilesChange?(listener: () => void): unknown;
}

/** Contrôleurs appelés par la manette : LB / RB (écran précédent ou suivant), X (modifier), site affiché, Y (choisir). */
export type GamepadControllers = Pick<Controllers, 'app' | 'web' | 'explorer'>;

let hooks: GamepadHooks;
let ctrl: GamepadControllers;
const mem: PadMemory = { prev: {}, repeatAt: {} };
let matchers: PadMatcher[] = [];
let profile: GamepadProfile = GENERIC_PROFILE;
const DIRS: Readonly<Record<string, Direction>> = { up: 'up', down: 'down', left: 'left', right: 'right' };

/** Contexte de la manette : celui de l'interface, sauf un `ds-modal` au premier plan (dialogue) ou des colonnes. */
function context(): PadContext {
  const ctx = hooks.context();
  if (ctx !== 'dialog' && activeDialog()) return 'dialog';
  if (ctx === 'list' && inColumns(document.activeElement)) return 'columns';
  return ctx;
}

function padPress(k: string): void {
  const ctx = context();
  if (ctx === 'web') {
    if (k === 'select' || k === 'home') {
      ctrl.web.toggleFocus({ toSite: !S.webFocused });
      return;
    }
    const webKey = padKey(WEB_PAD, k);
    if (S.webFocused && webKey) {
      ctrl.web.sendKey({ key: webKey });
      return;
    }
    const key = padKey(LIST_PAD, k);
    if (key) handleKey(key, true);
    return;
  }
  if (ctx === 'dialog') {
    const box = activeDialog() as HTMLElement;
    const key = padKey(LIST_PAD, k);
    // Un composant qui a le focus traite d'abord la touche (liste ouverte, onglets, Entrée d'un ds-trigger).
    if (key && relayPadKey(key)) return;
    const dir = Object.hasOwn(DIRS, k) ? DIRS[k] : undefined;
    if (dir) moveFocus(dir, box);
    else if (k === 'a') (document.activeElement as HTMLElement | null)?.click?.();
    else if (k === 'b') closeDialog(box);
    return;
  }
  if (ctx === 'video' || ctx === 'image') {
    const key = padKey(ctx === 'video' ? VIDEO_PAD : IMAGE_PAD, k);
    if (key) handleKey(key, true);
    return;
  }
  // Explorateur (P4-09) : Y choisit l'élément qui a le focus (sélection multiple), au lieu de la recherche.
  if (ctx === 'columns' && k === 'y') {
    ctrl.explorer.pickFocused();
    return;
  }
  if (k === 'x') {
    ctrl.app.editSelection();
    return;
  }
  if (k === 'lb' || k === 'rb') {
    ctrl.app.cycleSection({ step: k === 'lb' ? -1 : 1 });
    return;
  }
  if (k === 'select') {
    $('.rail-item[aria-current]')?.focus();
    return;
  }
  const key = padKey(LIST_PAD, k);
  if (key && relayPadKey(key)) return;
  if (key) handleKey(key, true);
}

let padCtxShown = '';

/** Barre de rappel des boutons : mise à jour quand le contexte ou la manette change (ou si `force`). */
export function updatePadbar(force = false): void {
  const ctx = S.pad ? context() : '';
  const key = `${ctx}|${S.pad?.family || ''}`;
  if (!force && key === padCtxShown) return;
  padCtxShown = key;
  const hints = S.pad ? padHints(ctx, profile) : null;
  document.body.classList.toggle('has-pad', hints !== null);
  // Aide de la manette de la coquille (mire-padbar, P4-07), textes traduits.
  const padbar = $('mire-padbar') as (HTMLElement & { hints: { glyphs: string[]; label: string }[] }) | null;
  if (padbar) padbar.hints = (hints ?? []).map((h) => ({ glyphs: h.glyphs.map((g) => (isGlyphKey(g) ? t(g) : g)), label: t(h.key) }));
}

/** Message de la manette détectée : avec le nom de sa famille si un profil la reconnaît (et que son nom est traduit). */
function detectedMessage(p: GamepadProfile): string {
  const name = p.name ? t(p.name) : '';
  return name && name !== p.name ? t('shell.pad.detected', { name }) : t('shell.pad.detectedGeneric');
}

function setPad(gp: Gamepad): void {
  profile = padProfile(gp.id, matchers);
  const isNew = !S.pad || S.pad.id !== gp.id;
  S.pad = { id: gp.id, family: profile.id };
  if (isNew) toast(detectedMessage(profile), { duration: 4500 });
  updatePadbar(true);
}

/** Recharge les profils des plugins ; la manette branchée est reconnue de nouveau (famille activée ou désactivée). */
async function loadProfiles(): Promise<void> {
  let list: GamepadProfile[] = [];
  try {
    list = (await hooks.profiles?.()) ?? [];
  } catch {
    // Profils illisibles : le profil générique suffit pour piloter Mire.
  }
  matchers = padMatchers(Array.isArray(list) ? list : []);
  if (!S.pad) return;
  profile = padProfile(S.pad.id, matchers);
  S.pad = { id: S.pad.id, family: profile.id };
  updatePadbar(true);
}

const connectedPads = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p) : []);

function pollPads(now: number): void {
  const pads = connectedPads();
  const usable = document.visibilityState === 'visible' && (document.hasFocus() || (S.section === 'web' && S.webFocused));
  if (pads.length && !S.pad) setPad(pads[0] as Gamepad);
  if (pads.length && usable) {
    const gp = pads[0] as Gamepad;
    const state = readPad(gp);
    if (rescueCombo(state, mem)) hooks.rescue?.();
    for (const { button, first } of padPresses(state, mem, now)) {
      if (first) {
        document.body.classList.remove('mouse');
        S.pendingFocus = false;
      }
      padPress(button);
    }
    // Stick droit : défilement de la liste, de la colonne ou de la rangée qui a le focus.
    const rx = gp.axes[2] || 0;
    const ry = gp.axes[3] || 0;
    const dx = Math.abs(rx) > 0.3 ? rx * 22 : 0;
    const dy = Math.abs(ry) > 0.3 ? ry * 22 : 0;
    if (dx || dy) stickScroll(dx, dy, context());
  }
  updatePadbar();
  requestAnimationFrame(pollPads);
}

/** Branche les événements de connexion de la manette. */
export function initGamepad(h: GamepadHooks, controllers: GamepadControllers): void {
  hooks = h;
  ctrl = controllers;
  // L'aide de la manette suit la langue de l'interface.
  i18n.onChange(() => updatePadbar(true));
  void loadProfiles();
  h.onProfilesChange?.(() => void loadProfiles());
  window.addEventListener('gamepadconnected', (e) => setPad(e.gamepad));
  window.addEventListener('gamepaddisconnected', () => {
    const left = connectedPads();
    if (left.length) setPad(left[0] as Gamepad);
    else {
      S.pad = null;
      updatePadbar(true);
      toast(t('shell.pad.disconnected'));
    }
  });
}

/** Lance la lecture de la manette, à chaque image. */
export function startGamepad(): void {
  requestAnimationFrame(pollPads);
}
