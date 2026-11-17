/**
 * Palettes (D-17, P4-02) : un jeu de jetons de couleurs, dans un fichier CSS (`<id>/<id>.css`), avec ses
 * métadonnées dans un `palette.json` à côté. Ce module est partagé par le processus principal (couleur de fond de
 * la fenêtre) et par l'interface (chargeur de palette) : il choisit la palette d'un réglage et lit les métadonnées.
 * La liste des jetons est dans `docs/themes.md`.
 */

/** Palette par défaut, et repli d'une palette inconnue ou introuvable. */
export const DEFAULT_PALETTE = 'ecran';

/** Réglage « Automatique » : la palette suit le mode clair ou sombre du système. */
export const PALETTE_AUTO = 'auto';

/** Palettes retenues par le réglage « Automatique », selon le mode du système. */
export const AUTO_PALETTES: Readonly<Record<PaletteScheme, string>> = { light: 'jour', dark: 'ecran' };

export type PaletteScheme = 'light' | 'dark';

/** Métadonnées d'une palette (`palette.json`). */
export interface PaletteMeta {
  /** Clé du nom de la palette dans les catalogues de textes (`palettes.<id>`). */
  name: string;
  /** Couleur de fond de la fenêtre avant l'affichage de l'interface : celle du jeton `--bg`. */
  background: string;
  /** Palette claire ou sombre. */
  scheme: PaletteScheme;
}

/**
 * Jetons qu'une palette doit définir (propriétés `--<nom>`, couleurs en #rrggbb sauf `ring-mix`, un pourcentage),
 * en plus de `color-scheme`. Détail et usage : docs/themes.md.
 */
export const PALETTE_TOKENS = [
  'bg',
  'bg-rail',
  'surface',
  'surface-2',
  'line',
  'line-strong',
  'text',
  'muted',
  'ink',
  'bar-white',
  'bar-yellow',
  'bar-cyan',
  'bar-green',
  'bar-magenta',
  'bar-red',
  'bar-blue',
  'ring-mix',
] as const;

/** Jetons facultatifs : leur valeur par défaut est dans l'habillage du cœur (`packages/ui/src/theme/_palettes.scss`). */
export const PALETTE_OPTIONAL_TOKENS = ['ring-w', 'ring-from', 'mire-edge', 'mono-mix'] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Identifiant de palette admis : lettres minuscules, chiffres et tirets (nom de dossier et de fichier). */
export const isPaletteId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

/** La palette d'un réglage : « Automatique » suit le système, les autres valeurs sont des identifiants de palette. */
export function resolvePalette(setting: string | null | undefined, dark: boolean): string {
  if (setting === PALETTE_AUTO) return AUTO_PALETTES[dark ? 'dark' : 'light'];
  return isPaletteId(setting) ? setting : DEFAULT_PALETTE;
}

/** Métadonnées lues dans un `palette.json`, ou `null` si le contenu n'en est pas. */
export function parsePaletteMeta(data: unknown): PaletteMeta | null {
  if (!data || typeof data !== 'object') return null;
  const { name, background, scheme } = data as Record<string, unknown>;
  if (typeof name !== 'string' || !name) return null;
  if (typeof background !== 'string' || !HEX.test(background)) return null;
  if (scheme !== 'light' && scheme !== 'dark') return null;
  return { name, background, scheme };
}
