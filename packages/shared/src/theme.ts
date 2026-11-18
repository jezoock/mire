/**
 * Thèmes sans code (D-17, architecture cible, « Thèmes ») : un `theme.json` choisit la palette, les polices, les
 * images et les sons, et la mise en page de l'accueil et des pages parmi les composants de Mire (rangées ou grille,
 * carte, taille, place du menu, fond). Aucun code ne s'exécute. Ce module donne le schéma du fichier et sa lecture
 * (`validateTheme`), partagés par le cœur, l'interface et, plus tard, les plugins de thèmes (P5-10).
 *
 * Les fichiers d'un thème (polices, images, sons) sont désignés par un chemin relatif à son dossier ; un chemin qui en
 * sortirait (`..`, chemin absolu, adresse, lecteur Windows) est refusé.
 */
import { isPaletteId } from './palette.ts';

/** Version du format de `theme.json` que ce module lit. */
export const THEME_FORMAT = 1;

/** Thème par défaut, et repli d'un réglage inconnu. */
export const DEFAULT_THEME = 'mire';

export type ThemeLayout = 'rows' | 'grid';
/** Carte des éléments : celle qu'indique la page (`auto`, d'après son `display`), ou une forme imposée. */
export type ThemeCard = 'auto' | 'poster' | 'thumbnail' | 'line';
export type ThemeSize = 's' | 'm' | 'l';
/** Fond des pages : aucun, l'image de l'élément sélectionné (fondu), ou l'image du thème (`images.background`). */
export type ThemeBackground = 'none' | 'backdrop' | 'image';
export type ThemeMenuPosition = 'left' | 'right' | 'top' | 'bottom';

/** Police d'un rôle : un fichier du thème, et des familles de repli (ou seulement des familles du système). */
export interface ThemeFont {
  file?: string;
  family?: string;
}

/** Mise en page des pages (et de leurs regroupements). */
export interface ThemePageLayout {
  layout?: ThemeLayout;
  card?: ThemeCard;
  size?: ThemeSize;
  background?: ThemeBackground;
}

/** Contenu d'un `theme.json`. */
export interface ThemeDefinition {
  format: number;
  /** Identifiant stable : minuscules, chiffres et tirets (nom du dossier). */
  id: string;
  /** Nom affiché : un texte, ou une clé des catalogues de textes (`{ key: 'themes.mire.name' }`). */
  name: string | { key: string };
  description?: string | { key: string };
  /** Palette imposée aux pages ; sans elle, celle des réglages. */
  palette?: string;
  fonts?: { body?: ThemeFont; heading?: ThemeFont };
  images?: { background?: string; logo?: string };
  sounds?: { move?: string; select?: string; back?: string };
  /** Place du menu proposée par le thème ; sans elle, celle des réglages. */
  menu?: { position?: ThemeMenuPosition };
  home?: { layout?: ThemeLayout };
  page?: ThemePageLayout;
}

/** Réponse de `validateTheme` : le thème lu, ou les endroits du fichier qui ne conviennent pas. */
export type ThemeReadResult = { ok: true; theme: ThemeDefinition } | { ok: false; errors: string[] };

export const THEME_LAYOUTS: readonly ThemeLayout[] = ['rows', 'grid'];
export const THEME_CARDS: readonly ThemeCard[] = ['auto', 'poster', 'thumbnail', 'line'];
export const THEME_SIZES: readonly ThemeSize[] = ['s', 'm', 'l'];
export const THEME_BACKGROUNDS: readonly ThemeBackground[] = ['none', 'backdrop', 'image'];
export const THEME_MENU_POSITIONS: readonly ThemeMenuPosition[] = ['left', 'right', 'top', 'bottom'];

/** Extensions admises pour chaque genre de fichier d'un thème. */
export const THEME_FILE_TYPES = {
  font: ['woff2', 'woff', 'ttf', 'otf'],
  image: ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'],
  sound: ['ogg', 'oga', 'opus', 'wav', 'mp3', 'm4a'],
} as const;
export type ThemeFileType = keyof typeof THEME_FILE_TYPES;

export const isThemeId = (id: unknown): id is string => typeof id === 'string' && id.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

// Une partie de chemin : lettres, chiffres, points, tirets et soulignés ; jamais « . » ni « .. ».
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Chemin relatif d'un fichier du thème, qui reste dans son dossier : parties séparées par `/`, sans `.` ni `..`, ni
 * barre de début, ni `\`, ni `:` (adresse, lecteur Windows), avec une extension admise pour son genre.
 */
export function isThemePath(value: unknown, type: ThemeFileType): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  const parts = value.split('/');
  if (!parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..')) return false;
  const ext = /\.([A-Za-z0-9]+)$/.exec(value)?.[1]?.toLowerCase() ?? '';
  return (THEME_FILE_TYPES[type] as readonly string[]).includes(ext);
}

/** Adresse d'un fichier du thème, à partir de l'adresse de son dossier ; `''` si le chemin sort du dossier. */
export function themeAssetUrl(base: string, file: string | undefined, type: ThemeFileType): string {
  if (!isThemePath(file, type)) return '';
  return `${base.replace(/\/+$/, '')}/${file}`;
}

// Familles de polices : noms, guillemets, virgules et espaces seulement (rien qui puisse fermer une règle CSS).
const FAMILY_RE = /^[A-Za-z0-9 ,'"_-]{1,200}$/;

const nameSchema = {
  oneOf: [
    { type: 'string', minLength: 1, maxLength: 200 },
    { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', minLength: 1 } } },
  ],
} as const;
const fileSchema = (type: ThemeFileType) => ({
  type: 'string',
  maxLength: 200,
  pattern: `^(?!.*(^|/)\\.\\.?(/|$))[A-Za-z0-9._/-]+\\.(${THEME_FILE_TYPES[type].join('|')})$`,
});
const fontSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { file: fileSchema('font'), family: { type: 'string', pattern: FAMILY_RE.source } },
} as const;

/** Schéma JSON de `theme.json` (pour les auteurs de thèmes et les plugins ; `validateTheme` l'applique). */
export const THEME_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'mire:theme',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'id', 'name'],
  properties: {
    format: { const: THEME_FORMAT },
    id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 64 },
    name: nameSchema,
    description: nameSchema,
    palette: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    fonts: { type: 'object', additionalProperties: false, properties: { body: fontSchema, heading: fontSchema } },
    images: { type: 'object', additionalProperties: false, properties: { background: fileSchema('image'), logo: fileSchema('image') } },
    sounds: {
      type: 'object',
      additionalProperties: false,
      properties: { move: fileSchema('sound'), select: fileSchema('sound'), back: fileSchema('sound') },
    },
    menu: { type: 'object', additionalProperties: false, properties: { position: { enum: THEME_MENU_POSITIONS } } },
    home: { type: 'object', additionalProperties: false, properties: { layout: { enum: THEME_LAYOUTS } } },
    page: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layout: { enum: THEME_LAYOUTS },
        card: { enum: THEME_CARDS },
        size: { enum: THEME_SIZES },
        background: { enum: THEME_BACKGROUNDS },
      },
    },
  },
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const isName = (v: unknown): v is ThemeDefinition['name'] =>
  (typeof v === 'string' && v.trim().length > 0 && v.length <= 200) ||
  (isObject(v) && Object.keys(v).length === 1 && typeof v.key === 'string' && v.key.length > 0);

/** Lit un bloc d'options (`menu`, `home`, `page`, `images`, `sounds`) : chaque clé connue, validée par `check`. */
function block<T extends object>(value: unknown, at: string, errors: string[], fields: Record<string, (v: unknown) => boolean>): T | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push(at);
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const check = fields[k];
    if (!check || !check(v)) errors.push(`${at}.${k}`);
    else out[k] = v;
  }
  return out as T;
}

const oneOf =
  <T>(list: readonly T[]) =>
  (v: unknown): boolean =>
    list.includes(v as T);
const file = (type: ThemeFileType) => (v: unknown) => isThemePath(v, type);

function font(value: unknown, at: string, errors: string[]): ThemeFont | undefined {
  const f = block<ThemeFont>(value, at, errors, { file: file('font'), family: (v) => typeof v === 'string' && FAMILY_RE.test(v) });
  if (f && !f.file && !f.family && isObject(value) && Object.keys(value).length === 0) errors.push(at);
  return f;
}

/**
 * Lit le contenu d'un `theme.json` (schéma ci-dessus) : rend le thème, ou les chemins des champs qui ne conviennent
 * pas (`page.layout`, `fonts.body.file`…). `id` : identifiant attendu (nom du dossier), s'il est connu.
 */
export function validateTheme(value: unknown, id?: string): ThemeReadResult {
  if (!isObject(value)) return { ok: false, errors: [''] };
  const errors: string[] = [];
  const known = new Set(Object.keys(THEME_SCHEMA.properties));
  for (const k of Object.keys(value)) if (!known.has(k)) errors.push(k);
  if (value.format !== THEME_FORMAT) errors.push('format');
  if (!isThemeId(value.id) || (id !== undefined && value.id !== id)) errors.push('id');
  if (!isName(value.name)) errors.push('name');
  if (value.description !== undefined && !isName(value.description)) errors.push('description');
  if (value.palette !== undefined && !isPaletteId(value.palette)) errors.push('palette');
  const theme: ThemeDefinition = { format: THEME_FORMAT, id: value.id as string, name: value.name as ThemeDefinition['name'] };
  if (value.description !== undefined) theme.description = value.description as ThemeDefinition['name'];
  if (typeof value.palette === 'string') theme.palette = value.palette;
  if (value.fonts !== undefined) {
    if (!isObject(value.fonts)) errors.push('fonts');
    else {
      const fonts: NonNullable<ThemeDefinition['fonts']> = {};
      for (const [k, v] of Object.entries(value.fonts)) {
        if (k !== 'body' && k !== 'heading') errors.push(`fonts.${k}`);
        else {
          const f = font(v, `fonts.${k}`, errors);
          if (f) fonts[k] = f;
        }
      }
      theme.fonts = fonts;
    }
  }
  const images = block<NonNullable<ThemeDefinition['images']>>(value.images, 'images', errors, { background: file('image'), logo: file('image') });
  if (images) theme.images = images;
  const sounds = block<NonNullable<ThemeDefinition['sounds']>>(value.sounds, 'sounds', errors, {
    move: file('sound'),
    select: file('sound'),
    back: file('sound'),
  });
  if (sounds) theme.sounds = sounds;
  const menu = block<NonNullable<ThemeDefinition['menu']>>(value.menu, 'menu', errors, { position: oneOf(THEME_MENU_POSITIONS) });
  if (menu) theme.menu = menu;
  const home = block<NonNullable<ThemeDefinition['home']>>(value.home, 'home', errors, { layout: oneOf(THEME_LAYOUTS) });
  if (home) theme.home = home;
  const page = block<ThemePageLayout>(value.page, 'page', errors, {
    layout: oneOf(THEME_LAYOUTS),
    card: oneOf(THEME_CARDS),
    size: oneOf(THEME_SIZES),
    background: oneOf(THEME_BACKGROUNDS),
  });
  if (page) theme.page = page;
  if (page?.background === 'image' && !images?.background && !errors.includes('images.background')) errors.push('page.background');
  return errors.length ? { ok: false, errors } : { ok: true, theme: JSON.parse(JSON.stringify(theme)) as ThemeDefinition };
}

/** Lit le texte d'un `theme.json` : JSON invalide compris (erreur à la racine). */
export function parseTheme(text: string, id?: string): ThemeReadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: [''] };
  }
  return validateTheme(data, id);
}

/** Thème d'un réglage : un identifiant connu, sinon le thème par défaut. */
export const resolveTheme = (setting: unknown, known: readonly string[]): string => (isThemeId(setting) && known.includes(setting) ? setting : DEFAULT_THEME);
