/**
 * Version 6 : chaque console reçoit un identifiant stable (`emulators[].id`), et les références qui
 * désignaient une console par sa position dans la liste la désignent par cet identifiant : console des
 * marque-pages de jeux ici, console des fiches de `telechargements.json` au chargement des téléchargements
 * (`consoleIdAt`, fichier séparé de la configuration). « pc » reste « pc » ; une position hors de la liste
 * (console déjà supprimée) devient `null`.
 */
import { assignConsoleIds } from '../normalize/consoles.ts';
import { isObjectLike, type Loose } from '../normalize/common.ts';
import type { Migration } from './types.ts';

/**
 * Ancienne référence de console → identifiant : une position (nombre) devient l'identifiant de la console à
 * cette place, ou `null` hors de la liste ; « pc », `null` et un identifiant sont rendus tels quels.
 */
export function consoleIdAt(emulators: readonly { id?: unknown }[], ref: unknown): unknown {
  if (typeof ref !== 'number') return ref ?? null;
  const id = emulators[ref]?.id;
  return typeof id === 'string' ? id : null;
}

export const v6: Migration = {
  version: 6,
  up(raw) {
    // Mêmes consoles que celles que garde la normalisation (avec un chemin), dans le même ordre : les
    // positions enregistrées se rapportent à la liste normalisée par la version précédente.
    const emulators: Loose[] = Array.isArray(raw.emulators) ? raw.emulators.filter((e) => isObjectLike(e) && !!e.path) : [];
    assignConsoleIds(emulators);
    if (Array.isArray(raw.gameBookmarks)) {
      // Comme l'ancienne normalisation : tout ce qui n'est ni « pc » ni vide était lu comme une position.
      for (const b of raw.gameBookmarks) {
        if (isObjectLike(b) && b.console != null && b.console !== 'pc') b.console = consoleIdAt(emulators, Number(b.console));
      }
    }
  },
};
