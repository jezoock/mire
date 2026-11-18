/**
 * Pages (architecture cible, « Pages, regroupements et listes ») : une page garde les éléments qui portent certains
 * tags, sous des conditions simples sur leurs infos, et les range en regroupements sur plusieurs niveaux (une info par
 * niveau). Le calcul se fait dans le processus principal (`src/main/catalog/pages/`) ; l'interface demande un niveau à
 * la fois, par tranches (`catalog.page`).
 */
import type { Element, ElementImages, InfoChanges, TagChanges } from './element.ts';
// Règle des identifiants de page : celle des cibles, publiée dans le SDK des plugins.
import { PAGE_ID_RE } from '../../plugin-sdk/src/targets.ts';

/** Valeur simple d'une info, telle qu'elle sert à regrouper et à comparer (un élément d'une liste est pris seul). */
export type InfoScalar = string | number | boolean;

/**
 * Condition sur une info (`where`) : égale à une valeur, contient un texte (sans tenir compte de la casse ; pour une
 * liste, l'un de ses éléments), ou entre deux valeurs comprises (nombres, ou textes comparés dans l'ordre alphabétique).
 */
export type PageCondition =
  { info: string; equals: InfoScalar } | { info: string; contains: string } | { info: string; between: [number, number] | [string, string] };

/** Tri des éléments : une info, ou `name` (nom de l'élément) et `added` (date d'ajout). */
export interface PageSort {
  by: string;
  order?: 'asc' | 'desc';
}

/** Indication pour le thème : affiches, vignettes, liste, rangées. L'explorateur l'ignore. */
export type PageDisplay = 'posters' | 'thumbnails' | 'list' | 'rows';

/** Définition d'une page (`userData/catalog/pages.json`, pages prêtes à l'emploi). */
export interface PageDefinition {
  /** Identifiant stable : minuscules, chiffres et tirets (`series`, `films-annees-90`). */
  id: string;
  /** Nom affiché : un texte, ou une clé des catalogues de textes (`{ key: 'pages.series' }`). */
  name: string | { key: string };
  icon?: string;
  /** Tags que les éléments portent tous (aucun : tout le catalogue). */
  require: string[];
  /** Tags qu'aucun élément ne porte. */
  exclude?: string[];
  /** Conditions sur les infos, toutes remplies. */
  where?: PageCondition[];
  /** Regroupements : une info par niveau ; un élément sans cette info va dans « Autres ». */
  groupBy?: string[];
  /** Tri des éléments, critère après critère, puis par nom. */
  sort?: PageSort[];
  display?: PageDisplay;
  menu?: { pinned?: boolean; order?: number };
}

/**
 * Chemin dans les regroupements d'une page : la valeur choisie à chaque niveau, `null` pour « Autres ».
 * Exemple pour Séries : `['Friends', 1]` → les épisodes de la saison 1 de Friends.
 */
export type PagePath = (InfoScalar | null)[];

/** Regroupement d'un niveau. */
export interface PageGroup {
  /** Valeur de l'info, ou `null` pour « Autres » (éléments sans cette info, toujours en dernier). */
  value: InfoScalar | null;
  /** Nom affiché : la valeur en texte, ou « Autres ». */
  name: string;
  /** Nombre d'éléments du regroupement. */
  count: number;
  /** Affiche du premier élément qui en a une, pour illustrer le regroupement. */
  poster?: string;
}

/**
 * Élément rendu par `catalog.page` : un élément du catalogue, ou, dans une liste, un élément disparu reconstitué
 * d'après ce que la liste en garde (`unavailable: true`, sans tags ni infos ; il ne s'ouvre pas).
 */
export type PageElement = Element & { unavailable?: true };

/** Réponse de `catalog.page` : les regroupements du niveau demandé, ou ses éléments, par tranches. */
export type PageLevel = {
  page: string;
  path: PagePath;
  /** Nombre total de regroupements ou d'éléments du niveau. */
  total: number;
  /** Curseur de la tranche suivante, ou `null` si c'est la dernière. */
  next: string | null;
} & ({ kind: 'groups'; info: string; groups: PageGroup[] } | { kind: 'elements'; elements: PageElement[] });

/**
 * Regroupement d'une page ouvert dans un éditeur (P4-22) : un album, une série. `info` est l'info qui le forme
 * (`album`, `series`) et `value` sa valeur (son nom) ; `elements` : tous ses éléments, quel que soit le nombre de
 * niveaux en dessous (les épisodes de toutes les saisons d'une série).
 */
export interface CatalogGroup {
  page: string;
  path: PagePath;
  info: string;
  value: InfoScalar | null;
  elements: Element[];
}

/** Modification d'un regroupement : elle vaut pour chacun de ses éléments. */
export interface GroupEdit {
  /** Nouveau nom : nouvelle valeur de l'info qui forme le regroupement (remplacée dans une liste, comme un genre). */
  rename?: InfoScalar;
  /** Autres infos (l'info qui forme le regroupement passe par `rename`). */
  infos?: InfoChanges;
  tags?: TagChanges;
  /** Images qui reviennent à l'automatique. */
  clearImages?: (keyof ElementImages)[];
  /** Tags, infos et images de chaque élément reviennent à l'automatique. */
  reset?: boolean;
}

/** Infos d'une fiche trouvée en ligne pour un regroupement, proposées dans l'éditeur avant d'être enregistrées. */
export interface GroupFacts {
  title: string;
  year?: string;
  genre?: string;
  overview?: string;
  artist?: string;
}

/** Réponse de `catalogGroupFetch` : la fiche (ses images sont déjà posées sur les éléments) et le regroupement. */
export type GroupFetchResult = { ok: true; facts: GroupFacts; group: CatalogGroup | null } | { ok: false; error?: string };

/** Réponse de `pages.save` : la page enregistrée, ou les endroits de la définition qui ne conviennent pas. */
export type PageSaveResult = { ok: true; page: PageDefinition } | { ok: false; errors: string[] };

/** Contenu d'une ou plusieurs pages changé (analyse, infos, modification à la main, définition). */
export interface PagesChange {
  pages: string[];
}

export { PAGE_ID_RE };
const INFO_RE = /^[a-z][a-zA-Z0-9]{0,63}$/;
const TAG_RE = /^[^\s].{0,63}$/;
export const PAGE_DISPLAYS: readonly PageDisplay[] = ['posters', 'thumbnails', 'list', 'rows'];

/** Schéma JSON d'une définition de page (pour les plugins et les fichiers ; `validatePage` l'applique). */
export const PAGE_DEFINITION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'mire:page-definition',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'require'],
  properties: {
    id: { type: 'string', pattern: PAGE_ID_RE.source },
    name: {
      oneOf: [
        { type: 'string', minLength: 1, maxLength: 200 },
        { type: 'object', additionalProperties: false, required: ['key'], properties: { key: { type: 'string', minLength: 1 } } },
      ],
    },
    icon: { type: 'string', maxLength: 64 },
    require: { type: 'array', items: { type: 'string', pattern: TAG_RE.source } },
    exclude: { type: 'array', items: { type: 'string', pattern: TAG_RE.source } },
    where: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['info'],
        minProperties: 2,
        maxProperties: 2,
        properties: {
          info: { type: 'string', pattern: INFO_RE.source },
          equals: { type: ['string', 'number', 'boolean'] },
          contains: { type: 'string', minLength: 1 },
          between: {
            oneOf: [
              { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
            ],
          },
        },
      },
    },
    groupBy: { type: 'array', items: { type: 'string', pattern: INFO_RE.source }, maxItems: 8 },
    sort: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['by'],
        properties: { by: { type: 'string', pattern: INFO_RE.source }, order: { enum: ['asc', 'desc'] } },
      },
    },
    display: { enum: PAGE_DISPLAYS },
    menu: {
      type: 'object',
      additionalProperties: false,
      properties: { pinned: { type: 'boolean' }, order: { type: 'number' } },
    },
  },
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): v is InfoScalar => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function stringList(v: unknown, re: RegExp, at: string, errors: string[]): string[] {
  if (!Array.isArray(v)) {
    errors.push(at);
    return [];
  }
  v.forEach((x, i) => {
    if (typeof x !== 'string' || !re.test(x)) errors.push(`${at}.${i}`);
  });
  return [...new Set(v.filter((x): x is string => typeof x === 'string'))];
}

function condition(v: unknown, at: string, errors: string[]): PageCondition | null {
  if (!isObject(v) || typeof v.info !== 'string' || !INFO_RE.test(v.info) || Object.keys(v).length !== 2) {
    errors.push(at);
    return null;
  }
  const { info } = v;
  if ('equals' in v && isScalar(v.equals)) return { info, equals: v.equals };
  if ('contains' in v && typeof v.contains === 'string' && v.contains) return { info, contains: v.contains };
  const b = v.between;
  if (Array.isArray(b) && b.length === 2) {
    if (b.every((x) => typeof x === 'number' && Number.isFinite(x))) return { info, between: [b[0], b[1]] };
    if (b.every((x) => typeof x === 'string')) return { info, between: [b[0], b[1]] };
  }
  errors.push(at);
  return null;
}

function sortSpec(v: unknown, at: string, errors: string[]): PageSort | null {
  const known = (k: string) => k === 'by' || k === 'order';
  if (!isObject(v) || typeof v.by !== 'string' || !INFO_RE.test(v.by) || !Object.keys(v).every(known)) {
    errors.push(at);
    return null;
  }
  if (v.order !== undefined && v.order !== 'asc' && v.order !== 'desc') {
    errors.push(`${at}.order`);
    return null;
  }
  return v.order ? { by: v.by, order: v.order } : { by: v.by };
}

const FIELDS = new Set(Object.keys(PAGE_DEFINITION_SCHEMA.properties));

/**
 * Vérifie une définition de page (schéma ci-dessus) et la rend nettoyée (tags en double retirés). En cas d'erreur,
 * `errors` donne les chemins des champs qui ne conviennent pas (`groupBy.0`, `where.1`…).
 */
export function validatePage(value: unknown): PageSaveResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: [''] };
  for (const k of Object.keys(value)) if (!FIELDS.has(k)) errors.push(k);
  const v = value;
  if (typeof v.id !== 'string' || !PAGE_ID_RE.test(v.id)) errors.push('id');
  const name = v.name;
  const nameOk =
    (typeof name === 'string' && name.trim().length > 0 && name.length <= 200) ||
    (isObject(name) && Object.keys(name).length === 1 && typeof name.key === 'string' && name.key.length > 0);
  if (!nameOk) errors.push('name');
  if (v.icon !== undefined && (typeof v.icon !== 'string' || v.icon.length > 64)) errors.push('icon');
  const page: PageDefinition = { id: v.id as string, name: name as PageDefinition['name'], require: stringList(v.require, TAG_RE, 'require', errors) };
  if (typeof v.icon === 'string') page.icon = v.icon;
  if (v.exclude !== undefined) page.exclude = stringList(v.exclude, TAG_RE, 'exclude', errors);
  if (v.where !== undefined) {
    if (!Array.isArray(v.where)) errors.push('where');
    else page.where = v.where.map((c, i) => condition(c, `where.${i}`, errors)).filter((c): c is PageCondition => !!c);
  }
  if (v.groupBy !== undefined) {
    page.groupBy = stringList(v.groupBy, INFO_RE, 'groupBy', errors);
    if (page.groupBy.length > PAGE_DEFINITION_SCHEMA.properties.groupBy.maxItems) errors.push('groupBy');
  }
  if (v.sort !== undefined) {
    if (!Array.isArray(v.sort)) errors.push('sort');
    else page.sort = v.sort.map((s, i) => sortSpec(s, `sort.${i}`, errors)).filter((s): s is PageSort => !!s);
  }
  if (v.display !== undefined) {
    if (PAGE_DISPLAYS.includes(v.display as PageDisplay)) page.display = v.display as PageDisplay;
    else errors.push('display');
  }
  if (v.menu !== undefined) {
    const m = v.menu;
    const ok =
      isObject(m) &&
      Object.keys(m).every((k) => k === 'pinned' || k === 'order') &&
      (m.pinned === undefined || typeof m.pinned === 'boolean') &&
      (m.order === undefined || (typeof m.order === 'number' && Number.isFinite(m.order)));
    if (ok) page.menu = { ...(m as PageDefinition['menu']) };
    else errors.push('menu');
  }
  return errors.length ? { ok: false, errors } : { ok: true, page: JSON.parse(JSON.stringify(page)) as PageDefinition };
}
