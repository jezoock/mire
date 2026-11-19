/**
 * Version 10 : continuité pour les installations existantes (P5-01). Les fonctions devenues des plugins sont reprises
 * d'après la table de `continuity.ts` : réglages déplacés sous `plugins.<id>`, règles appliquées notées dans
 * `continuity` pour le service de continuité (plugins inclus activés, plugins à installer mis en attente).
 * Tant que la table est vide, seule la version change.
 */
import { applyContinuity } from './continuity.ts';
import type { Migration } from './types.ts';

export const v10: Migration = {
  version: 10,
  up(raw) {
    applyContinuity(raw);
  },
};
