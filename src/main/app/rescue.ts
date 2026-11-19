/**
 * Mode secours, côté processus principal (P4-10, D-16) : l'option `--explorateur`, la touche Maj maintenue au
 * lancement, le raccourci clavier (lu avant la page par `before-input-event`, pour qu'un thème ne puisse pas le
 * bloquer) et les plantages de l'interface. Ce service ne décide que du premier écran affiché et des demandes
 * d'ouvrir l'explorateur : il ne touche ni aux réglages de la fenêtre, ni à la CSP, ni aux dossiers autorisés.
 */
import { isRescueHeldKey, isRescueShortcut, wantsExplorer } from '@mire/shared';
import type { RescueKeyInput, RescueReason, RescueRequest } from '@mire/shared';

/** Durée après l'ouverture de la fenêtre pendant laquelle Maj enfoncée compte comme « maintenue au lancement ». */
export const HELD_KEY_WINDOW = 4000;
/** Plantages de suite qui font ouvrir l'explorateur au rechargement. */
export const CRASH_LIMIT = 2;
/** Plantages de suite après lesquels l'interface n'est plus rechargée (elle plante même dans l'explorateur). */
export const CRASH_GIVE_UP = 4;

/** Compteur de plantages de suite : remis à zéro quand le thème s'est affiché sans souci. */
export function createCrashCounter() {
  let count = 0;
  return {
    /** Un plantage de plus ; rend le nombre de plantages de suite. */
    crash: () => ++count,
    reset() {
      count = 0;
    },
    count: () => count,
  };
}

/** Que faire après un plantage de l'interface : la recharger, la recharger sur l'explorateur, ou abandonner. */
export function afterCrash(count: number): 'reload' | 'explorer' | 'give-up' {
  if (count >= CRASH_GIVE_UP) return 'give-up';
  return count >= CRASH_LIMIT ? 'explorer' : 'reload';
}

export interface RescueOptions {
  argv: readonly string[];
  now?: () => number;
}

export function createRescue({ argv, now = Date.now }: RescueOptions) {
  const crashes = createCrashCounter();
  // Demande en attente que l'interface lira à son démarrage (`takeStart`).
  let pending: RescueReason | null = wantsExplorer(argv) ? 'option' : null;
  let openedAt = -Infinity;
  let heldUsed = false;

  return {
    /** La fenêtre vient d'être ouverte : la touche maintenue compte pendant `HELD_KEY_WINDOW`. */
    windowOpened() {
      openedAt = now();
      heldUsed = false;
    },
    /**
     * Touche reçue avant la page : la raison d'ouvrir l'explorateur, ou `null`. La touche maintenue au lancement ne
     * compte qu'une fois par ouverture de fenêtre ; elle reste aussi en attente pour le démarrage de l'interface.
     */
    onInput(input: RescueKeyInput): RescueReason | null {
      if (isRescueShortcut(input)) return 'shortcut';
      if (!heldUsed && isRescueHeldKey(input) && now() - openedAt <= HELD_KEY_WINDOW) {
        heldUsed = true;
        pending = pending ?? 'key';
        return 'key';
      }
      return null;
    },
    /** L'interface a planté ; rend ce qu'il faut faire, et met l'explorateur en attente s'il le faut. */
    onCrash(): ReturnType<typeof afterCrash> {
      const action = afterCrash(crashes.crash());
      if (action === 'explorer') pending = 'crash';
      return action;
    },
    /** Le thème s'est affiché sans souci : les plantages précédents ne comptent plus. */
    themeOk() {
      crashes.reset();
    },
    /** Premier écran demandé (lu une fois par l'interface à son démarrage), ou `null` pour l'écran habituel. */
    takeStart(): RescueRequest | null {
      const reason = pending;
      pending = null;
      return reason ? { reason } : null;
    },
    crashes: () => crashes.count(),
  };
}

export type Rescue = ReturnType<typeof createRescue>;
