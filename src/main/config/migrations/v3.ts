/**
 * Version 3 : les sites connus sont complétés par leurs réglages (groupe, couleur…) et rangés dans l'ordre de
 * `DEFAULT_WEB` ; les sites ajoutés par l'utilisateur restent à la fin.
 * Validé au point G1 : on ne garde que les sites que l'utilisateur a réellement ; les autres sites connus ne sont
 * plus ajoutés (rien n'est installé d'office).
 */
import { DEFAULT_WEB } from '../catalogs/web.ts';
import type { Migration } from './types.ts';

export const v3: Migration = {
  version: 3,
  up(raw) {
    if (!Array.isArray(raw.web)) return;
    const mine = new Map(raw.web.filter((w) => w && w.id).map((w) => [w.id, w]));
    const known = DEFAULT_WEB.filter((d) => mine.has(d.id)).map((d) => ({ ...structuredClone(d), ...mine.get(d.id) }));
    const custom = raw.web.filter((w) => w && !DEFAULT_WEB.some((d) => d.id === w.id));
    raw.web = [...known, ...custom];
  },
};
