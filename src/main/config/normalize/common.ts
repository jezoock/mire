/** Outils communs aux fonctions de normalisation. */

/** Valeur lue d'un fichier ou de l'interface : forme inconnue tant qu'elle n'est pas normalisée. */
export type Loose = Record<string, any>;

/** Objet (ou liste) : même test que le code d'origine, qui acceptait aussi les listes. */
export const isObjectLike = (v: unknown): v is Loose => !!v && typeof v === 'object';

/** Liste, ou liste vide. */
export const listOf = (v: unknown): any[] => (Array.isArray(v) ? v : []);
