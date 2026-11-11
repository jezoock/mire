/**
 * Touches dans une vue web (fonctions pures) : raccourcis clavier gérés par Mire avant la page, et touches que la
 * manette envoie à la page.
 */
import type { KeyInput } from './types.ts';

export type ShortcutAction = 'toggle-immersive' | 'leave-immersive' | 'mire' | 'reload' | 'close' | 'back' | 'forward';

/**
 * Action d'une touche enfoncée dans une vue, ou null si la page la reçoit. Échap ne quitte le mode immersif que
 * s'il ne vient pas du plein écran du lecteur vidéo (la page le gère alors elle-même).
 */
export function shortcutAction(input: KeyInput, state: { immersive: boolean; html: boolean }): ShortcutAction | null {
  const { key } = input;
  const ctrl = !!(input.control || input.meta);
  const lower = String(key || '').toLowerCase();
  if (key === 'F11') return 'toggle-immersive';
  if (key === 'Escape' && state.immersive && !state.html) return 'leave-immersive';
  if (key === 'F9') return 'mire';
  if (key === 'F5' || (ctrl && lower === 'r')) return 'reload';
  if (ctrl && lower === 'w') return 'close';
  if (input.alt && key === 'ArrowLeft') return 'back';
  if (input.alt && key === 'ArrowRight') return 'forward';
  return null;
}

interface PadKey {
  keyCode: string;
  char?: string;
  modifiers?: string[];
}

// Touches envoyées à la page depuis la manette.
export const PAD_KEYS: Readonly<Record<string, readonly PadKey[]>> = {
  Up: [{ keyCode: 'Up' }],
  Down: [{ keyCode: 'Down' }],
  Left: [{ keyCode: 'Left' }],
  Right: [{ keyCode: 'Right' }],
  Enter: [{ keyCode: 'Return', char: '\r' }],
  Space: [{ keyCode: 'Space', char: ' ' }],
  Escape: [{ keyCode: 'Escape' }],
  Tab: [{ keyCode: 'Tab' }],
  ShiftTab: [{ keyCode: 'Tab', modifiers: ['shift'] }],
};

/** Événements (pour `sendInputEvent`) d'une touche de manette : appui, caractère éventuel, relâchement. */
export function padInputEvents(name: string): Record<string, unknown>[] {
  const keys = Object.hasOwn(PAD_KEYS, name) ? PAD_KEYS[name] : [];
  return keys.flatMap((k) => {
    const modifiers = k.modifiers || [];
    return [
      { type: 'keyDown', keyCode: k.keyCode, modifiers },
      ...(k.char ? [{ type: 'char', keyCode: k.char, modifiers }] : []),
      { type: 'keyUp', keyCode: k.keyCode, modifiers },
    ];
  });
}
