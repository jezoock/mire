/**
 * Lecteur de musique, sans DOM (P4-15) : file d'attente (morceau précédent ou suivant), textes du mini-lecteur.
 * Testé tel quel ; `audio.ts` s'en sert pour piloter `mire-mini-player`.
 */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Au-delà de ce temps (secondes), « morceau précédent » revient au début du morceau en cours. */
export const RESTART_AFTER = 3;

/** Ce que fait « morceau précédent » ou « suivant » : revenir au début, arrêter (fin de la file) ou lire un morceau. */
export type TrackStep = { kind: 'restart' } | { kind: 'stop' } | { kind: 'play'; index: number };

/**
 * Morceau suivant (`delta` 1) ou précédent (-1) dans une file de `count` morceaux, depuis `index`, après `time` secondes
 * de lecture ; `null` si la file est vide. Avant le premier morceau, on revient au début ; après le dernier, on s'arrête.
 */
export function stepInQueue(index: number, count: number, delta: number, time: number): TrackStep | null {
  if (!count) return null;
  if (delta < 0 && time > RESTART_AFTER) return { kind: 'restart' };
  const j = index + delta;
  if (j < 0) return { kind: 'restart' };
  if (j >= count) return { kind: 'stop' };
  return { kind: 'play', index: j };
}

/** Sous-titre du mini-lecteur : le dossier, et la place dans la file quand elle a plusieurs morceaux. */
export function trackSubheading(folder: string, index: number, count: number, t: Translate): string {
  return count > 1 ? t('player.music.position', { folder, index: index + 1, count }) : folder;
}

