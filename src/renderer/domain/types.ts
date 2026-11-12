/**
 * Données manipulées par la logique de l'interface. Les types restent larges, comme ceux de `state/` :
 * les éléments viennent du processus principal et ne sont pas encore décrits (`@mire/shared/ipc`).
 */

/** Élément affiché : vidéo, morceau, image, jeu PC, jeu de console, marque-page de jeu… */
export interface Item {
  kind?: string;
  name?: string;
  path?: string;
  dir?: string;
  folder?: string;
  [key: string]: unknown;
}

/** Fiche d'infos : récupérée en ligne (`scrape`) ou saisie à la main (`meta`). */
export type Info = Record<string, unknown>;

/** Infos connues, indexées par clé (`v:chemin`, `a:dossier`, `t:chemin`…). */
export interface Infos {
  scrape: Record<string, Info | undefined>;
  meta: Record<string, Info | undefined>;
}

/** Console telle que la décrit la configuration (seuls les champs utiles ici). */
export interface Console {
  id: string;
  name: string;
  [key: string]: unknown;
}
