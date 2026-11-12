/**
 * Version 8 : langue des fiches (`search.language`, P1-29). Jusque-là, `fr-FR` était la valeur par défaut : on
 * ne pouvait pas distinguer un choix de l'utilisateur de cette valeur. Elle devient vide, ce qui veut dire
 * « suivre la langue de l'interface » (src/main/i18n/metadata.ts) ; pour une installation existante, restée en
 * français par la migration v7, les fiches sont donc toujours demandées en `fr-FR`. Une autre langue, écrite à la
 * main dans la configuration, est conservée.
 */
import { isObjectLike } from '../normalize/common.ts';
import type { Migration } from './types.ts';

export const v8: Migration = {
  version: 8,
  up(raw) {
    if (isObjectLike(raw.search) && raw.search.language === 'fr-FR') raw.search.language = '';
  },
};
