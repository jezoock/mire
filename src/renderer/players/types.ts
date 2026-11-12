import type { Item } from '../domain/types.ts';

/** Élément lu par les lecteurs intégrés (seuls les champs utiles ici). */
export interface Playable extends Item {
  path: string;
  name: string;
  /** Format lu par le lecteur intégré ; sinon, ouverture dans le lecteur externe. */
  native?: boolean;
  /** Pochette trouvée dans le dossier du morceau. */
  cover?: string;
  /** Marque-page de site affiché parmi les vidéos. */
  bookmark?: boolean;
  bookmarkId?: string;
  sTitle?: string;
  sYear?: string | number;
}
