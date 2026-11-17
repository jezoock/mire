/**
 * Logique sans DOM des composants d'éléments (P4-05) : textes d'une carte (sous-titre, badge, jauge de reprise),
 * image selon la variante, action d'un `ds-trigger` par clé, regroupements d'une grille et « Afficher plus », part
 * affichée d'une grille virtualisée, fondu de `mire-backdrop`. Testée sous `node:test` (`test/ui/elements.test.ts`).
 */
import type { Element as CatalogElement, InfoValue, PageGroup } from '@mire/shared';
import { mediaUrl } from './media.ts';

/** Ce qu'un composant lit d'un élément du catalogue (P2-01) ; `unavailable` : élément disparu d'une liste. */
export type CardElement = Pick<CatalogElement, 'key' | 'name' | 'images' | 'infos' | 'tags'> & { unavailable?: true };

/** Variantes de `mire-card` : affiche (2/3), vignette (16/9), ligne (petite image carrée et textes à côté). */
export const CARD_VARIANTS = ['poster', 'thumbnail', 'line'] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

/** Proportions de l'image de chaque variante (attribut `ratio` de `ds-thumb`). */
export const CARD_RATIOS: Record<CardVariant, string> = { poster: '2/3', thumbnail: '16/9', line: '1' };

/**
 * Textes d'une carte, tirés des catalogues par la page (attribut `labels`, JSON) : gabarits avec `{season}`,
 * `{episode}`, `{percent}`. Une forme absente n'est pas affichée : aucun texte n'est écrit dans un composant.
 */
export interface CardLabels {
  /** Épisode d'une série : « S{season} · É{episode} ». */
  episode?: string;
  /** Jauge de reprise, pour les lecteurs d'écran : « Vu à {percent} % ». */
  progress?: string;
  /** Badge d'un élément disparu : « Indisponible ». */
  unavailable?: string;
}

/** Valeur passée en propriété (objet) ou en attribut (JSON) ; `null` si absente ou illisible. */
export function readJson<T>(value: T | string | null | undefined): T | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Liste passée en propriété ou en JSON ; `[]` si ce n'est pas une liste. */
export const readList = <T>(value: T[] | string | null | undefined): T[] => {
  const list = readJson<T[]>(value);
  return Array.isArray(list) ? list : [];
};

/** Objet (avancements par clé…) passé en propriété ou en JSON ; `{}` si ce n'est pas un objet. */
export function readRecord<T>(value: Record<string, T> | string | null | undefined): Record<string, T> {
  const rec = readJson<Record<string, T>>(value);
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
}

/** Variante reconnue, sinon l'affiche. */
export const cardVariant = (value: string | null | undefined): CardVariant =>
  (CARD_VARIANTS as readonly string[]).includes(value ?? '') ? (value as CardVariant) : 'poster';

/** Remplace les `{nom}` d'un gabarit ; `''` sans gabarit. */
export function fillLabel(template: string | undefined, values: Record<string, string | number>): string {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : all));
}

/** Image d'un élément pour une variante (adresse `media://` pour un fichier local), ou `''`. */
export function cardImage(el: Pick<CardElement, 'images'>, variant: CardVariant): string {
  const { poster, background } = el.images ?? {};
  const path = variant === 'thumbnail' ? background || poster : poster || background;
  return path ? mediaUrl(path) : '';
}

/** Une info en texte : un texte tel quel, un nombre sans séparateur (une année reste « 1994 »), une liste jointe. */
export function infoText(value: InfoValue | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v).join(', ');
  return '';
}

/**
 * Sous-titre d'une carte : l'info `info` si on la demande ; sinon l'épisode d'une série (saison et épisode connus),
 * l'année, ou l'artiste.
 */
export function cardSubtitle(el: Pick<CardElement, 'infos'>, labels: CardLabels, info?: string): string {
  const infos = el.infos ?? {};
  if (info) return infoText(infos[info]);
  const { season, episode } = infos;
  if (typeof season === 'number' && typeof episode === 'number' && labels.episode) return fillLabel(labels.episode, { season, episode });
  return infoText(infos.year) || infoText(infos.artist);
}

/** Avancement de la reprise, entre 0 et 1 exclus ; `null` sans reprise (jamais commencé ou fini). */
export function progressOf(value: number | string | null | undefined): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

/** Pourcentage arrondi d'un avancement, entre 1 et 99. */
export const progressPercent = (p: number): number => Math.min(99, Math.max(1, Math.round(p * 100)));

/** Badge d'une carte : celui que donne la page, sinon « Indisponible » pour un élément disparu. */
export const cardBadge = (el: Pick<CardElement, 'unavailable'>, labels: CardLabels, badge?: string): string =>
  badge || (el.unavailable ? (labels.unavailable ?? '') : '');

/** Textes d'une carte : ceux qu'elle affiche, et le nom qu'en lit un lecteur d'écran. */
export interface CardTexts {
  title: string;
  subtitle: string;
  badge: string;
  /** Avancement de la reprise, ou `null`. */
  progress: number | null;
  /** Nom du `ds-trigger` : titre, sous-titre, badge et reprise, séparés par des virgules. */
  label: string;
}

export function cardTexts(
  el: CardElement,
  labels: CardLabels,
  opts: { badge?: string; progress?: number | string | null; subtitleInfo?: string } = {},
): CardTexts {
  const title = el.name ?? '';
  const subtitle = cardSubtitle(el, labels, opts.subtitleInfo);
  const badge = cardBadge(el, labels, opts.badge);
  const progress = progressOf(opts.progress);
  const reading = progress === null ? '' : fillLabel(labels.progress, { percent: progressPercent(progress) });
  return { title, subtitle, badge, progress, label: [title, subtitle, badge, reading].filter(Boolean).join(', ') };
}

/** Argument d'une action de `ds-trigger` : la méthode `method` avec la clé de l'élément (`open:[{"key":"…"}]`). */
export const keyAction = (method: string, key: string): string => `${method}:${JSON.stringify([{ key }])}`;

/** Argument d'une action sur un regroupement : sa valeur dans le niveau (`null` : « Autres »), jamais son rang. */
export const groupAction = (method: string, value: PageGroup['value']): string => `${method}:${JSON.stringify([{ value }])}`;

/* ------------------------------------------------------------------ */
/* Grille : groupes et « Afficher plus »                                */
/* ------------------------------------------------------------------ */

/** Groupe d'une grille : clé stable, titre (aucun : grille sans titres), éléments. */
export interface GridGroup {
  key: string;
  name?: string;
  elements: CardElement[];
}

/** Groupe tel que la grille l'affiche : nombre d'éléments montrés, et combien restent derrière « Afficher plus ». */
export interface GridGroupView extends GridGroup {
  shown: number;
  remaining: number;
}

/** Les groupes d'une grille : `groups` s'il y en a, sinon un seul groupe sans titre avec `elements`. */
export function gridGroups(groups: GridGroup[], elements: CardElement[]): GridGroup[] {
  const valid = groups.filter((g) => g && typeof g.key === 'string' && Array.isArray(g.elements));
  return valid.length ? valid : elements.length ? [{ key: '', elements }] : [];
}

/**
 * Nombre d'éléments montrés : `limit` par page (0 ou moins : tous), autant de pages que de « Afficher plus » + 1.
 */
export const shownCount = (total: number, limit: number, pages: number): number => (limit > 0 ? Math.min(total, limit * Math.max(1, pages)) : total);

/** Vue des groupes : pour chacun, les éléments montrés selon les « Afficher plus » déjà demandés (par clé de groupe). */
export function gridView(groups: GridGroup[], limit: number, pages: ReadonlyMap<string, number>): GridGroupView[] {
  return groups.map((g) => {
    const shown = shownCount(g.elements.length, limit, pages.get(g.key) ?? 1);
    return { ...g, shown, remaining: g.elements.length - shown };
  });
}

/* ------------------------------------------------------------------ */
/* Grille virtualisée                                                   */
/* ------------------------------------------------------------------ */

/** Part d'une liste à rendre : éléments `start` (compris) à `end` (exclu), lignes entières. */
export interface ItemRange {
  start: number;
  end: number;
}

/**
 * Éléments à rendre d'une grille de `count` éléments en `columns` colonnes, lignes de `rowHeight` px, quand la partie
 * visible va de `top` à `bottom` px (comptés depuis le haut de la grille), plus `overscan` lignes de chaque côté :
 * les flèches trouvent toujours la ligne suivante. Sans mesure (`rowHeight` nul), les `fallback` premiers.
 */
export function visibleRange(count: number, columns: number, rowHeight: number, top: number, bottom: number, overscan = 2, fallback = 60): ItemRange {
  if (count <= 0) return { start: 0, end: 0 };
  const cols = Math.max(1, Math.floor(columns) || 1);
  if (!(rowHeight > 0)) return { start: 0, end: Math.min(count, Math.ceil(fallback / cols) * cols) };
  const rows = Math.ceil(count / cols);
  const first = Math.min(rows - 1, Math.max(0, Math.floor(top / rowHeight) - overscan));
  const last = Math.max(first + 1, Math.min(rows, Math.ceil(bottom / rowHeight) + overscan));
  return { start: first * cols, end: Math.min(count, last * cols) };
}

/** Deux parts identiques : la grille ne se rend pas de nouveau. */
export const sameRange = (a: ItemRange, b: ItemRange): boolean => a.start === b.start && a.end === b.end;

/* ------------------------------------------------------------------ */
/* Fond en fondu                                                        */
/* ------------------------------------------------------------------ */

/**
 * État de `mire-backdrop` : deux calques ; `front` est celui qu'on voit (−1 : aucun). Une nouvelle image va dans le
 * calque de derrière, qui ne passe devant qu'une fois chargée : le fondu ne montre jamais une image à moitié chargée.
 * `ready` : l'image du calque est chargée ; `wanted` : la dernière image demandée.
 */
export interface BackdropState {
  layers: [string, string];
  ready: [boolean, boolean];
  front: 0 | 1 | -1;
  wanted: string;
}

export const BACKDROP_EMPTY: BackdropState = { layers: ['', ''], ready: [false, false], front: -1, wanted: '' };

/** Nouvelle image demandée (`''` : aucune, le fond s'efface). Une image déjà chargée derrière passe devant aussitôt. */
export function backdropRequest(state: BackdropState, src: string): BackdropState {
  if (!src) return { ...state, front: -1, wanted: '' };
  if (state.front !== -1 && state.layers[state.front] === src) return { ...state, wanted: src };
  const back = state.front === 0 ? 1 : 0;
  const layers: [string, string] = [...state.layers];
  const ready: [boolean, boolean] = [...state.ready];
  ready[back] = layers[back] === src && ready[back];
  layers[back] = src;
  return { layers, ready, front: ready[back] ? back : state.front, wanted: src };
}

/** Le calque `layer` a chargé `src` : il passe devant si c'est la dernière image demandée. */
export function backdropLoaded(state: BackdropState, layer: 0 | 1, src: string): BackdropState {
  if (state.layers[layer] !== src) return state;
  const ready: [boolean, boolean] = [...state.ready];
  ready[layer] = true;
  return { ...state, ready, front: src === state.wanted ? layer : state.front };
}
