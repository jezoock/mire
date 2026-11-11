/** Catalogues intégrés à Mire : le français et l'anglais (décision D-11). */
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import type { Catalog } from './types.ts';

export const BUILTIN_CATALOGS: Readonly<Record<string, Catalog>> = { fr, en };

/** Langue de référence des catalogues : celle dans laquelle les textes sont écrits d'abord. */
export const REFERENCE_LANGUAGE = 'fr';
