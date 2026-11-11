/**
 * Version 7 : langue de l'interface (`ui.language`, P1-28). Une installation existante garde le français,
 * seule langue de Mire jusque-là, au lieu de suivre la langue du système ; une installation neuve, qui ne
 * passe pas par les migrations, reste en `auto`. Une langue déjà choisie est conservée.
 */
import { isObjectLike } from '../normalize/common.ts';
import type { Migration } from './types.ts';

export const v7: Migration = {
  version: 7,
  up(raw) {
    if (!isObjectLike(raw.ui)) raw.ui = {};
    if (raw.ui.language === undefined) raw.ui.language = 'fr';
  },
};
