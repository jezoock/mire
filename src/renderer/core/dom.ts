/** Accès au document et échappement du texte inséré dans le HTML. */

/** Premier élément qui correspond au sélecteur, ou `null`. */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);

/** Tous les éléments qui correspondent au sélecteur, dans un vrai tableau. */
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Texte sûr dans du HTML (contenu ou valeur d'attribut) ; `null` et `undefined` donnent une chaîne vide. */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c] as string);
