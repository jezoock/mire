/**
 * Réglages de l'accueil (P4-12), sans DOM : quelles rangées, dans quel ordre, quelles barres de la mire et quels
 * sites épinglés. Ils modifient `ui.home.rows` (v9) : aucune nouvelle clé de configuration. `ui.home.clock` reste
 * l'horloge ; `ui.home.recent` suit la présence de « Reprendre » (l'interface historique le lisait).
 *
 * Trois listes ordonnables, désignées par leur nom (`kind`) dans l'écran Réglages :
 * - `rows` : les rangées, par identifiant (`bars`, `sites`, `recent`, `page:<id>`, `list:<id>`) ;
 * - `bars` : les cibles des barres de la mire (`screen:search`, `movies`…) ;
 * - `sites` : les sites épinglés, par clé (`web:<id>`).
 */
import type { HomeRow, HomeSettings, ListSummary, PageDefinition } from '@mire/shared';
import { pageName } from '../pages/model.ts';
import { barColor } from './model.ts';
import type { SiteSource } from './model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const HOME_LISTS = ['rows', 'bars', 'sites'] as const;
export type HomeList = (typeof HOME_LISTS)[number];
export const isHomeList = (v: unknown): v is HomeList => (HOME_LISTS as readonly unknown[]).includes(v);

/** Identifiant stable d'une rangée. */
export const rowId = (r: HomeRow): string => (r.kind === 'page' || r.kind === 'list' ? `${r.kind}:${r.id}` : r.kind);

/** Rangée neuve d'après son identifiant ; `null` s'il n'en désigne aucune. */
export function rowOf(id: string): HomeRow | null {
  if (id === 'bars') return { kind: 'bars', targets: [] };
  if (id === 'sites') return { kind: 'sites', keys: [] };
  if (id === 'recent') return { kind: 'recent' };
  const m = /^(page|list):(.+)$/.exec(id);
  return m ? { kind: m[1] as 'page' | 'list', id: m[2] as string } : null;
}

/** Valeurs choisies d'une liste, dans l'ordre. */
export function chosen(home: Pick<HomeSettings, 'rows'>, list: HomeList): string[] {
  if (list === 'rows') return home.rows.map(rowId);
  const row = home.rows.find((r) => r.kind === list);
  if (row?.kind === 'bars') return [...row.targets];
  return row?.kind === 'sites' ? [...row.keys] : [];
}

/**
 * Remplace les valeurs choisies d'une liste. Les rangées gardent leur contenu ; une rangée de barres ou de sites
 * absente est ajoutée (en tête pour les barres, comme sur l'accueil d'origine) dès qu'on y choisit quelque chose.
 */
export function withChosen(home: HomeSettings, list: HomeList, ids: readonly string[]): HomeSettings {
  let rows: HomeRow[];
  if (list === 'rows') {
    rows = ids.map((id) => home.rows.find((r) => rowId(r) === id) ?? rowOf(id)).filter((r): r is HomeRow => r !== null);
  } else {
    const next: HomeRow = list === 'bars' ? { kind: 'bars', targets: [...ids] } : { kind: 'sites', keys: [...ids] };
    const at = home.rows.findIndex((r) => r.kind === list);
    rows = [...home.rows];
    if (at >= 0) rows[at] = next;
    else if (ids.length) rows = list === 'bars' ? [next, ...rows] : [...rows, next];
  }
  return { ...home, rows, recent: rows.some((r) => r.kind === 'recent') };
}

/** Montre ou cache une valeur : ajoutée à la fin des valeurs choisies, ou retirée. */
export function toggleChosen(home: HomeSettings, list: HomeList, id: string, on: boolean): HomeSettings {
  const ids = chosen(home, list).filter((x) => x !== id);
  return withChosen(home, list, on ? [...ids, id] : ids);
}

/** Déplace une valeur choisie d'un rang (`dir` : -1 vers le haut, 1 vers le bas) ; rien ne change au bord. */
export function moveChosen(home: HomeSettings, list: HomeList, id: string, dir: number): HomeSettings {
  const ids = chosen(home, list);
  const k = ids.indexOf(id);
  const j = k + Math.sign(dir);
  if (k < 0 || j < 0 || j >= ids.length) return home;
  [ids[k], ids[j]] = [ids[j] as string, ids[k] as string];
  return withChosen(home, list, ids);
}

/** Ligne d'une liste des réglages : valeur, nom, couleur de la pastille, choisie ou non. */
export interface HomeOption {
  id: string;
  label: string;
  color: string;
  on: boolean;
}

export interface OptionSources {
  t: Translate;
  pages: readonly PageDefinition[] | null;
  lists: readonly ListSummary[];
  sites: readonly SiteSource[];
  color(c: unknown): string;
}

/** Écrans proposés comme barres de la mire (ceux qui ont une vue). */
const BAR_SCREENS: ReadonlyArray<readonly [target: string, view: string]> = [
  ['screen:search', 'search'],
  ['screen:center', 'downloads'],
  ['screen:settings', 'settings'],
];

const listName = (l: ListSummary, t: Translate) => (typeof l.name === 'string' ? l.name : t(l.name.key));
const pagesOf = (src: OptionSources) => src.pages ?? [];

/** Toutes les valeurs proposées par une liste, avec leur nom et leur couleur. */
function candidates(list: HomeList, src: OptionSources): Omit<HomeOption, 'on'>[] {
  const { t } = src;
  if (list === 'sites') return src.sites.map((w) => ({ id: `web:${w.id}`, label: w.name || w.id, color: src.color(w.color) }));
  const pages = pagesOf(src).map((p) => ({ id: p.id, label: pageName(p, t), color: barColor(p.id) }));
  if (list === 'bars') return [...BAR_SCREENS.map(([id, view]) => ({ id, label: t(`shell.views.${view}`), color: barColor(id) })), ...pages];
  return [
    { id: 'bars', label: t('home.rows.bars'), color: 'var(--bar-white)' },
    { id: 'sites', label: t('home.rows.sites'), color: 'var(--bar-magenta)' },
    { id: 'recent', label: t('home.rows.recent'), color: 'var(--bar-cyan)' },
    ...pages.map((p) => ({ ...p, id: `page:${p.id}`, label: t('home.rows.page', { name: p.label }) })),
    ...src.lists.map((l) => ({ id: `list:${l.id}`, label: t('home.rows.list', { name: listName(l, t) }), color: 'var(--muted)' })),
  ];
}

/**
 * Lignes d'une liste des réglages : les valeurs choisies dans leur ordre, puis les autres. Une valeur choisie que
 * plus rien ne propose (page supprimée) reste affichée sous son identifiant, pour pouvoir la retirer.
 */
export function homeOptions(home: Pick<HomeSettings, 'rows'>, list: HomeList, src: OptionSources): HomeOption[] {
  const all = candidates(list, src);
  const ids = chosen(home, list);
  const on = ids.map((id) => ({ ...(all.find((c) => c.id === id) ?? { id, label: id, color: 'var(--muted)' }), on: true }));
  return [...on, ...all.filter((c) => !ids.includes(c.id)).map((c) => ({ ...c, on: false }))];
}
