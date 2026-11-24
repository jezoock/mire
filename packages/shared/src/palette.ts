/**
 * Palettes (D-17, P4-02) : un jeu de jetons de couleurs, dans un fichier CSS (`<id>/<id>.css`), avec ses
 * métadonnées dans un `palette.json` à côté. Ce module est partagé par le processus principal (couleur de fond de
 * la fenêtre) et par l'interface (chargeur de palette) : il choisit la palette d'un réglage et lit les métadonnées.
 * La liste des jetons est dans `docs/themes.md`.
 */

/** Palette par défaut, et repli d'une palette inconnue ou introuvable. */
export const DEFAULT_PALETTE = 'ecran';

/** Palettes du cœur (fichiers de l'interface) ; les autres viennent des plugins (contribution `palettes`, P5-02). */
export const CORE_PALETTES = ['ecran', 'contraste'] as const;

/** Palette du cœur ? */
export const isCorePalette = (id: string): boolean => (CORE_PALETTES as readonly string[]).includes(id);

/** Réglage « Automatique » : la palette suit le mode clair ou sombre du système. */
export const PALETTE_AUTO = 'auto';

/**
 * Palettes retenues par le réglage « Automatique », selon le mode du système. La palette claire est celle d'un plugin
 * (Plein jour) : absente, « Automatique » garde la palette par défaut.
 */
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

/** Jetons facultatifs ou obligatoires, avec la forme de leur valeur. */
type TokenType = 'color' | 'percent' | 'length';

const TOKEN_TYPES: Readonly<Record<string, TokenType>> = {
  ...Object.fromEntries(PALETTE_TOKENS.map((t) => [t, 'color' as TokenType])),
  'ring-mix': 'percent',
  'ring-w': 'length',
  'ring-from': 'color',
  'mire-edge': 'length',
  'mono-mix': 'percent',
};

/** Épaisseur maximale d'un jeton de longueur (`ring-w`, `mire-edge`), en pixels. */
export const MAX_TOKEN_PX = 8;

const PERCENT = /^(\d{1,3})%$/;
const LENGTH = /^(\d{1,2})px$/;

/**
 * Valeur d'un jeton vérifiée selon sa forme : couleur `#rrggbb`, pourcentage entier de 0 à 100 (`58%`), longueur
 * entière en pixels de 0 à `MAX_TOKEN_PX` (`3px`). Jeton inconnu ou valeur hors forme : `null`.
 */
export function checkPaletteToken(name: string, value: unknown): string | null {
  if (!Object.hasOwn(TOKEN_TYPES, name) || typeof value !== 'string') return null;
  const type = TOKEN_TYPES[name];
  if (type === 'color') return HEX.test(value) ? value.toLowerCase() : null;
  const m = (type === 'percent' ? PERCENT : LENGTH).exec(value);
  if (!m) return null;
  return Number(m[1]) <= (type === 'percent' ? 100 : MAX_TOKEN_PX) ? value : null;
}

/** Palette de données (contribution `palettes` d'un plugin, P5-02) : mode et jetons vérifiés. */
export interface PaletteData {
  scheme: PaletteScheme;
  /** Jetons par nom (sans `--`) : tous ceux de `PALETTE_TOKENS`, et les facultatifs valides. */
  tokens: Record<string, string>;
}

/**
 * Palette lue dans les données d'un plugin : `{ "scheme": "light" | "dark", "tokens": { "bg": "#f1efe8", … } }`.
 * Ce sont des données, jamais du CSS : chaque jeton est vérifié (`checkPaletteToken`) ; un jeton obligatoire absent
 * ou invalide refuse la palette (`null`), un jeton facultatif invalide ou un nom inconnu est ignoré.
 */
export function parsePaletteData(data: unknown): PaletteData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { scheme, tokens } = data as Record<string, unknown>;
  if (scheme !== 'light' && scheme !== 'dark') return null;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  const src = tokens as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const name of PALETTE_TOKENS) {
    const v = Object.hasOwn(src, name) ? checkPaletteToken(name, src[name]) : null;
    if (v === null) return null;
    out[name] = v;
  }
  for (const name of PALETTE_OPTIONAL_TOKENS) {
    const v = Object.hasOwn(src, name) ? checkPaletteToken(name, src[name]) : null;
    if (v !== null) out[name] = v;
  }
  return { scheme, tokens: out };
}
