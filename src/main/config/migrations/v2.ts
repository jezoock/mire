/**
 * Version 2 : les sites passent dans la vue intégrée et reçoivent l'adresse de recherche, la lecture en fond et
 * les noms de fournisseurs des sites connus (`DEFAULT_WEB`).
 * Validé au point G1 : les valeurs viennent de `DEFAULT_WEB`, et non plus de `DEFAULT_CONFIG.web`, vide depuis que
 * rien n'est installé d'office.
 */
import { DEFAULT_WEB } from '../catalogs/web.ts';
import { isObjectLike, type Loose } from '../normalize/common.ts';
import type { Migration } from './types.ts';

export const v2: Migration = {
  version: 2,
  up(raw) {
    if (!Array.isArray(raw.web)) return;
    raw.web = raw.web.map((w) => {
      if (!isObjectLike(w)) return w;
      const def = DEFAULT_WEB.find((d) => d.id === w.id);
      const next: Loose = { ...w, mode: 'integrated' };
      if (!next.search && def?.search) next.search = def.search;
      if (next.background == null && def?.background) next.background = true;
      if (!next.providers && def?.providers) next.providers = [...def.providers];
      return next;
    });
  },
};
