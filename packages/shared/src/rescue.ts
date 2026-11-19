/**
 * Mode secours (P4-10, D-16) : l'explorateur s'ouvre toujours, quel que soit le thème. Ce module décrit ce que le
 * processus principal et l'interface partagent : les raisons d'ouvrir l'explorateur, le raccourci clavier, la
 * combinaison de la manette et l'option de démarrage. Fonctions pures.
 *
 * Ces déclencheurs ne changent que l'écran affiché : jamais les réglages de sécurité de la fenêtre, la CSP ni les
 * dossiers autorisés.
 */

/**
 * Pourquoi l'explorateur s'ouvre en mode secours :
 * - `option` : option `--explorateur` au démarrage ;
 * - `key` : touche Maj maintenue au lancement ;
 * - `shortcut` : raccourci clavier (Ctrl+Maj+E, ⌘+Maj+E sous macOS) ;
 * - `pad` : combinaison de la manette (Affichage + Menu) ;
 * - `crash` : l'interface a planté deux fois de suite ;
 * - `missing` : le thème choisi est introuvable ou invalide ;
 * - `failed` : un fichier du thème n'a pas pu être chargé ;
 * - `timeout` : le thème a dépassé son délai de chargement.
 */
export type RescueReason = 'option' | 'key' | 'shortcut' | 'pad' | 'crash' | 'missing' | 'failed' | 'timeout';

export const RESCUE_REASONS: readonly RescueReason[] = ['option', 'key', 'shortcut', 'pad', 'crash', 'missing', 'failed', 'timeout'];

export const isRescueReason = (value: unknown): value is RescueReason => typeof value === 'string' && (RESCUE_REASONS as readonly string[]).includes(value);

/** Raisons qui viennent d'un problème (message d'erreur), et non d'une demande de la personne. */
export const isRescueFailure = (reason: RescueReason): boolean => reason === 'crash' || reason === 'missing' || reason === 'failed' || reason === 'timeout';

/** Demande d'ouvrir l'explorateur en mode secours ; `theme` : le thème en cause, s'il y en a un. */
export interface RescueRequest {
  reason: RescueReason;
  theme?: string;
}

/** Options de démarrage qui ouvrent l'explorateur (la française, et son équivalent anglais). */
export const RESCUE_ARGS: readonly string[] = ['--explorateur', '--explorer'];

/** Le démarrage demande-t-il l'explorateur ? Seules les options exactes comptent (pas de valeur ni de préfixe). */
export const wantsExplorer = (argv: readonly string[]): boolean => argv.some((a) => RESCUE_ARGS.includes(a));

/** Touche lue par le processus principal (`before-input-event`), réduite à ce qui sert ici. */
export interface RescueKeyInput {
  type?: string;
  key: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** Raccourci du mode secours : Ctrl+Maj+E (⌘+Maj+E sous macOS), touche enfoncée, sans Alt. */
export function isRescueShortcut(input: RescueKeyInput): boolean {
  if (input.type !== undefined && input.type !== 'keyDown') return false;
  return !!(input.control || input.meta) && !!input.shift && !input.alt && String(input.key || '').toLowerCase() === 'e';
}

/** Touche maintenue au lancement qui ouvre l'explorateur : Maj. */
export const isRescueHeldKey = (input: RescueKeyInput): boolean => (input.type === undefined || input.type === 'keyDown') && input.key === 'Shift';

/** Boutons de la manette, tels que les lit la navigation (`nav/gamepad-data.ts`). */
export type RescuePadState = Readonly<Record<string, boolean>>;

/** Combinaison du mode secours : Affichage (Select) et Menu (Start) enfoncés ensemble. */
export const RESCUE_PAD_BUTTONS: readonly string[] = ['select', 'start'];

export const isRescueCombo = (state: RescuePadState): boolean => RESCUE_PAD_BUTTONS.every((b) => !!state[b]);
