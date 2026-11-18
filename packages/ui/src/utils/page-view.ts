/**
 * Vue de page (P4-11) : règles sans DOM partagées par `mire-page-view` et la page qui la remplit
 * (`src/renderer/pages/`). La mise en page vient du thème (`theme.json`) et de l'indication `display` de la page.
 */
import type { InfoScalar, PageDisplay, PagePath } from '@mire/shared';
import type { CardElement, CardVariant } from './elements.ts';

/** Étape du chemin parcouru : son nom et le chemin qui y ramène (`[]` : la page elle-même). */
export interface PageCrumb {
  label: string;
  path: PagePath;
}

/** Regroupement affiché : ce que rend `catalog.page`, son nom mis en forme, et ses premiers éléments en rangée. */
export interface PageViewGroup {
  value: InfoScalar | null;
  name: string;
  count: number;
  poster?: string;
  /** Premiers éléments du regroupement (mise en page en rangées), s'ils sont chargés. */
  elements?: CardElement[];
}

export type PageViewLayout = 'rows' | 'grid';
export type PageViewSize = 's' | 'm' | 'l';
export type PageViewBackground = 'none' | 'backdrop' | 'image';

/** Textes de la vue de page, tirés des catalogues (JSON) ; `count` et `more` : formes plurielles (`{count}`). */
export interface PageViewLabels {
  path?: string;
  count?: string;
  more?: string;
  loading?: string;
  empty?: string;
  legacy?: string;
}

/** Carte des éléments : celle que le thème impose, sinon celle qu'indique la page (`display`). */
export function pageCardVariant(display: PageDisplay | string | undefined, card: string | undefined): CardVariant {
  if (card === 'poster' || card === 'thumbnail' || card === 'line') return card;
  if (display === 'thumbnails') return 'thumbnail';
  if (display === 'list') return 'line';
  return 'poster';
}

/** Mise en page du thème, sauf si la page demande des rangées (`display: 'rows'`). */
export function pageLayout(display: PageDisplay | string | undefined, layout: string | undefined): PageViewLayout {
  if (display === 'rows') return 'rows';
  return layout === 'rows' ? 'rows' : 'grid';
}

/**
 * Les regroupements s'affichent en rangées (leurs premiers éléments) seulement si la mise en page le demande et si le
 * niveau suivant est celui des éléments ; sinon, en grille de cartes de regroupements.
 */
export const groupsAsRows = (layout: PageViewLayout, depth: number, levels: number): boolean => layout === 'rows' && depth + 1 >= levels;

/** Clé stable d'un regroupement dans son niveau (sa valeur ; `null` pour « Autres »). */
export const groupKey = (value: InfoScalar | null): string => JSON.stringify(value);

/** Mise en forme d'une valeur de regroupement selon son info (`Saison 1`), ou `null` pour la laisser telle quelle. */
export type GroupFormatter = (info: string, value: InfoScalar | null) => string | null;

/** Nom d'un regroupement : « Autres » pour `null`, sinon la valeur, mise en forme selon son info s'il y a lieu. */
export function groupLabel(info: string, value: InfoScalar | null, others: string, format?: GroupFormatter): string {
  if (value === null) return others;
  return format?.(info, value) ?? String(value);
}

/**
 * Chemin parcouru : la page, puis la valeur choisie à chaque niveau (Séries › Friends › Saison 1). La dernière étape
 * est celle qui est affichée.
 */
export function pageCrumbs(pageName: string, groupBy: readonly string[], path: PagePath, others: string, format?: GroupFormatter): PageCrumb[] {
  const crumbs: PageCrumb[] = [{ label: pageName, path: [] }];
  path.forEach((value, i) => {
    crumbs.push({ label: groupLabel(groupBy[i] ?? '', value, others, format), path: path.slice(0, i + 1) });
  });
  return crumbs;
}

/** Chemin un niveau plus haut (retour), ou `null` à la racine de la page. */
export const parentPath = (path: PagePath): PagePath | null => (path.length ? path.slice(0, -1) : null);
