/**
 * Administration des tags (P4-21) : apparence d'un tag (couleur et icône, choisies dans des listes fermées) et ce que
 * l'écran Réglages montre de chaque tag. Les valeurs venues de l'interface sont vérifiées dans le processus principal
 * (`validateTagLook`, `isTagName`).
 */
import type { TagSummary } from './element.ts';

/** Couleurs proposées pour un tag (noms : `settingsView.tags.colors.<nom>`). */
export const TAG_COLORS = {
  red: '#C0392B',
  orange: '#D9822B',
  yellow: '#C9A227',
  green: '#3E8E41',
  blue: '#2F6FB3',
  purple: '#7D4CA8',
  pink: '#C2457A',
  grey: '#7A7F85',
} as const;
export type TagColor = keyof typeof TAG_COLORS;

/** Icônes proposées pour un tag (noms : `settingsView.tags.icons.<id>`). */
export const TAG_ICONS = ['star', 'folder', 'globe', 'play', 'layers', 'shield', 'search', 'download'] as const;
export type TagIcon = (typeof TAG_ICONS)[number];

/** Apparence d'un tag ; une propriété absente : aucune. */
export interface TagLook {
  color?: TagColor;
  icon?: TagIcon;
}

/** Longueur maximale du nom d'un tag. */
export const TAG_NAME_MAX = 64;

/** Tag tel que l'administration le montre (`tags.overview`) : son apparence, et qui le pose. */
export interface TagOverview extends TagSummary {
  look: TagLook;
  /**
   * Qui pose le tag : `core` (Mire : type de fichier, sources, tags automatiques), `user` (vous, à la main), ou
   * l'identifiant de chaque plugin actif qui le déclare.
   */
  setBy: string[];
}

/** Changement d'apparence : une valeur, ou `null` pour l'enlever. */
export type TagLookChanges = { color?: TagColor | null; icon?: TagIcon | null };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Vérifie un changement d'apparence : seulement `color` et `icon`, chacun dans sa liste ou `null`. */
export function validateTagLook(v: unknown): TagLookChanges | null {
  if (!isObject(v) || !Object.keys(v).every((k) => k === 'color' || k === 'icon')) return null;
  const { color, icon } = v;
  if (color !== undefined && color !== null && !(typeof color === 'string' && Object.hasOwn(TAG_COLORS, color))) return null;
  if (icon !== undefined && icon !== null && !(TAG_ICONS as readonly unknown[]).includes(icon)) return null;
  return v as TagLookChanges;
}

/** Nom de tag acceptable : un texte, sans espace au début, de 1 à 64 caractères. */
export const isTagName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= TAG_NAME_MAX;
