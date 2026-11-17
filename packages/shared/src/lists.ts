/**
 * Listes (architecture cible, « Pages, regroupements et listes ») : des regroupements faits à la main, ordonnés. Une
 * liste garde des clés d'éléments dans l'ordre choisi, avec de quoi afficher un élément disparu du catalogue : il
 * reste dans la liste, marqué indisponible, jusqu'à ce qu'il revienne ou qu'on le retire. Le service est dans le
 * processus principal (`src/main/catalog/lists/`) ; une liste s'affiche comme une page par `catalog.page('list:<id>')`.
 */
import type { ElementKey, ElementSourceRef, OpenSpec } from './element.ts';
import { PAGE_ID_RE } from './pages.ts';
import { LIST_PAGE_PREFIX } from '../../plugin-sdk/src/targets.ts';

/**
 * Élément d'une liste, tel qu'il était la dernière fois que le catalogue l'avait : de quoi l'afficher (marqué
 * indisponible) s'il disparaît.
 */
export interface ListItem {
  key: ElementKey;
  name: string;
  source: ElementSourceRef;
  open: OpenSpec;
  added: number;
  poster?: string;
}

/** Définition d'une liste (`userData/catalog/lists.json`). */
export interface ListDefinition {
  /** Identifiant stable : minuscules, chiffres et tirets (aléatoire pour une liste créée par l'utilisateur). */
  id: string;
  /** Nom affiché : un texte, ou une clé des catalogues de textes (`{ key: 'lists.favorites' }`). */
  name: string | { key: string };
  /** Éléments, dans l'ordre de la liste, sans doublon. */
  items: ListItem[];
}

/** Liste en bref (`lists.list`). */
export interface ListSummary {
  id: string;
  name: string | { key: string };
  /** Nombre d'éléments, indisponibles compris. */
  count: number;
}

/** Élément d'une liste, tel que le rend `lists.get`. */
export interface ListEntry {
  key: ElementKey;
  name: string;
  poster?: string;
  /** `false` : l'élément n'est plus dans le catalogue (nom et affiche tels qu'ils étaient). */
  available: boolean;
}

/** Liste avec ses éléments (`lists.get`). */
export interface ListView {
  id: string;
  name: string | { key: string };
  items: ListEntry[];
}

/** Le contenu ou la définition de ces listes a changé (liste modifiée, élément disparu, revenu ou changé). */
export interface ListsChange {
  lists: string[];
}

/** Préfixe d'une liste dans `catalog.page` : `list:<id>`. Les identifiants de page n'ont jamais de `:`. */
export { LIST_PAGE_PREFIX };
export const listPageId = (id: string): string => `${LIST_PAGE_PREFIX}${id}`;
/** Identifiant de la liste désignée par un `pageId`, ou `null` si ce n'est pas une liste. */
export const listIdOfPage = (pageId: unknown): string | null =>
  typeof pageId === 'string' && pageId.startsWith(LIST_PAGE_PREFIX) ? pageId.slice(LIST_PAGE_PREFIX.length) : null;

const LIST_ID_RE = PAGE_ID_RE;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Nom d'une liste : un texte non vide (200 caractères au plus) ou une clé des catalogues. */
export function isListName(v: unknown): v is ListDefinition['name'] {
  if (typeof v === 'string') return v.trim().length > 0 && v.length <= 200;
  return isObject(v) && Object.keys(v).length === 1 && isText(v.key);
}

function isOpenSpec(v: unknown): v is OpenSpec {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'file':
    case 'program':
      return isText(v.path);
    case 'site':
    case 'stream':
      return isText(v.url);
    case 'game':
      return isText(v.console) && isText(v.path);
    default:
      return false;
  }
}

/** Vérifie un élément gardé par une liste ; `null` s'il est mal formé. */
function validateListItem(v: unknown): ListItem | null {
  if (!isObject(v) || !isText(v.key) || typeof v.name !== 'string' || !isOpenSpec(v.open)) return null;
  const s = v.source;
  if (!isObject(s) || typeof s.plugin !== 'string' || typeof s.instance !== 'string') return null;
  if (typeof v.added !== 'number' || !Number.isFinite(v.added)) return null;
  if (v.poster !== undefined && typeof v.poster !== 'string') return null;
  const item: ListItem = {
    key: v.key,
    name: v.name,
    source: { plugin: s.plugin, instance: s.instance },
    open: JSON.parse(JSON.stringify(v.open)) as OpenSpec,
    added: v.added,
  };
  if (typeof v.poster === 'string') item.poster = v.poster;
  return item;
}

export type ListValidation = { ok: true; list: ListDefinition; dropped: number } | { ok: false; errors: string[] };

/**
 * Vérifie une définition de liste et la rend nettoyée : un élément mal formé ou en double est écarté sans perdre le
 * reste (`dropped` en donne le nombre). En cas d'erreur, `errors` donne les champs qui ne conviennent pas.
 */
export function validateList(value: unknown): ListValidation {
  if (!isObject(value)) return { ok: false, errors: [''] };
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (k !== 'id' && k !== 'name' && k !== 'items') errors.push(k);
  if (typeof value.id !== 'string' || !LIST_ID_RE.test(value.id)) errors.push('id');
  if (!isListName(value.name)) errors.push('name');
  if (!Array.isArray(value.items)) errors.push('items');
  if (errors.length) return { ok: false, errors };
  const seen = new Set<string>();
  const items: ListItem[] = [];
  for (const raw of value.items as unknown[]) {
    const item = validateListItem(raw);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  const name = typeof value.name === 'string' ? value.name : { key: (value.name as { key: string }).key };
  return { ok: true, list: { id: value.id as string, name, items }, dropped: (value.items as unknown[]).length - items.length };
}
