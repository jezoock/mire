/**
 * Accueil (P4-12), sans DOM : les rangées choisies dans les réglages (`ui.home.rows`, v9) deviennent ce que
 * `mire-home-view` affiche. Barres de la mire (cibles de la coquille : pages, écrans), sites épinglés, « Reprendre »,
 * premiers éléments ou regroupements d'une page ou d'une liste. Les données viennent de la page (`HomeSources`).
 */
import { parseTarget } from '@mire/shared';
import type { Element as CatalogElement, HomeRow, ListSummary, PageDefinition, PageLevel, PagePath } from '@mire/shared';
import { pageCardVariant } from '@mire/ui/utils';
import type { CardElement, CardVariant, HomeBar, HomeSection, HomeSite } from '@mire/ui/utils';
import { pageName } from '../pages/model.ts';
import { VIEW_COLORS } from '../shell/menu.ts';
import { legacySectionOf, viewOf } from '../shell/router.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Éléments montrés dans une rangée de l'accueil (comme les rangées de la vue de page). */
export const HOME_ROW_SIZE = 20;

/** Écran du cœur → vue dont il prend le nom (`shell.views.<vue>`). */
const SCREEN_LABELS: Readonly<Record<string, string>> = { 'screen:search': 'search', 'screen:center': 'downloads', 'screen:settings': 'settings' };

/** Couleur d'une barre : celle de l'entrée du menu (ancienne section de la page), le blanc pour la recherche. */
export function barColor(target: string): string {
  if (target === 'screen:search') return 'var(--bar-white)';
  const legacy = legacySectionOf(target);
  return (legacy && VIEW_COLORS[legacy]) || 'var(--muted)';
}

/** Entrée de « Reprendre » (`usage.json`) : de quoi afficher la carte et rouvrir le fichier. */
export interface RecentItem {
  path: string;
  name?: string | null;
  kind?: string | null;
  cover?: string | null;
  fanart?: string | null;
  key?: string | null;
}

/** Clé d'une entrée de « Reprendre » : celle de l'élément, sinon son chemin (lien magnet…). */
export const recentKey = (it: RecentItem): string => it.key || it.path;

/** Site de la configuration (`web`). */
export interface SiteSource {
  id: string;
  name?: string;
  color?: string;
}

export interface HomeSources {
  t: Translate;
  /** Texte au pluriel des catalogues (`{"one": …, "other": …}`), ou `''` si la clé n'existe pas. */
  plural(key: string, count: number): string;
  /** Pages connues (`pages.list`), ou `null`. */
  pages(): readonly PageDefinition[] | null;
  lists(): Promise<readonly ListSummary[]>;
  /** Premier niveau d'une page ou d'une liste (`list:<id>`), ou `null` s'il ne peut être lu. */
  level(id: string, path: PagePath): Promise<PageLevel | null>;
  /** Élément du catalogue, ou `null`. */
  element(key: string): Promise<CatalogElement | null>;
  recent(): readonly RecentItem[];
  sites(): readonly SiteSource[];
  /** Sites ouverts (identifiants). */
  openSites(): ReadonlySet<string>;
  /** Couleur sûre d'un site, et couleur du texte posé dessus. */
  color(c: unknown): string;
  ink(color: string): string;
  /** Carte choisie par le thème (`page.card` : `auto`, `poster`…). */
  card(): string;
}

/** Page d'une cible, ou `null` ; sans liste des pages, une page prête à l'emploi garde son nom des catalogues. */
function pageOf(id: string, pages: readonly PageDefinition[] | null): PageDefinition | null {
  if (!pages) return { id, name: { key: `pages.${id}` }, require: [] };
  return pages.find((p) => p.id === id) ?? null;
}

/** Mot sous une barre : le nombre d'éléments ou de regroupements de la page, « vide », ou rien. */
function levelMeta(level: PageLevel | null, src: HomeSources): string {
  if (!level) return '';
  if (!level.total) return src.t('home.bars.empty');
  if (level.kind === 'elements') return src.plural('home.bars.count.elements', level.total);
  return src.plural(`home.bars.count.${level.info}`, level.total) || src.plural('home.bars.count.groups', level.total);
}

/** Barres de la mire : chaque cible qu'une vue sait afficher (page connue, écran) ; les autres sont omises. */
export async function homeBars(targets: readonly string[], src: HomeSources): Promise<HomeBar[]> {
  const pages = src.pages();
  const bars = await Promise.all(
    targets.map(async (target): Promise<HomeBar | null> => {
      const t = parseTarget(target);
      if (!t || !viewOf(target)) return null;
      if (t.kind === 'screen') {
        const view = SCREEN_LABELS[target];
        if (!view) return null;
        const meta = target === 'screen:search' ? src.t('home.bars.searchMeta') : '';
        return { target, label: src.t(`shell.views.${view}`), meta, color: barColor(target) };
      }
      const page = t.kind === 'page' ? pageOf(t.id, pages) : null;
      if (!page) return null;
      const level = await src.level(page.id, []).catch(() => null);
      return { target, label: pageName(page, src.t), meta: levelMeta(level, src), color: barColor(target) };
    }),
  );
  return bars.filter((b): b is HomeBar => b !== null);
}

/** Sites épinglés : ceux de la configuration, dans l'ordre choisi ; un site retiré n'est plus affiché. */
export function homeSites(keys: readonly string[], src: HomeSources): HomeSite[] {
  const open = src.openSites();
  const out: HomeSite[] = [];
  for (const key of keys) {
    const site = key.startsWith('web:') ? src.sites().find((w) => w.id === key.slice(4)) : undefined;
    if (!site) continue;
    const color = src.color(site.color);
    out.push({ key, name: site.name || site.id, color, ink: src.ink(color), open: open.has(site.id) });
  }
  return out;
}

/** Carte d'une entrée de « Reprendre » : l'élément du catalogue s'il est connu (images et infos), sinon l'entrée. */
export function recentCard(it: RecentItem, el: CatalogElement | null): CardElement {
  const key = recentKey(it);
  if (el) return { key, name: el.name, images: el.images, infos: el.infos, tags: el.tags };
  const images: CardElement['images'] = {};
  if (it.cover) images.poster = it.cover;
  if (it.fanart) images.background = it.fanart;
  return { key, name: it.name || it.path, images, infos: {}, tags: [] };
}

/** « Reprendre » : les dernières lectures, dans l'ordre, avec les images du catalogue. */
export async function recentCards(src: HomeSources): Promise<CardElement[]> {
  const items = src.recent().slice(0, HOME_ROW_SIZE);
  const els = await Promise.all(items.map((it) => (it.key ? src.element(it.key).catch(() => null) : Promise.resolve(null))));
  return items.map((it, i) => recentCard(it, els[i] ?? null));
}

const asCard = (e: CardElement): CardElement => ({
  key: e.key,
  name: e.name,
  images: e.images,
  infos: e.infos,
  tags: e.tags,
  ...(e.unavailable ? { unavailable: true } : {}),
});

/** Rangée d'une page ou d'une liste : ses premiers éléments, ou ses premiers regroupements. */
async function contentSection(row: Extract<HomeRow, { kind: 'page' | 'list' }>, src: HomeSources, lists: readonly ListSummary[]): Promise<HomeSection | null> {
  const id = row.kind === 'list' ? `list:${row.id}` : row.id;
  let heading: string;
  let display: string | undefined;
  if (row.kind === 'page') {
    const page = pageOf(row.id, src.pages());
    if (!page) return null;
    heading = pageName(page, src.t);
    display = page.display;
  } else {
    const list = lists.find((l) => l.id === row.id);
    if (!list) return null;
    heading = typeof list.name === 'string' ? list.name : src.t(list.name.key);
  }
  const level = await src.level(id, []).catch(() => null);
  if (!level) return null;
  const variant: CardVariant = pageCardVariant(display, src.card());
  // Une liste n'a pas encore de vue (elle s'ouvrira dans l'explorateur, P4-08) : son titre n'est pas un lien.
  const target = viewOf(id) ? id : undefined;
  const sid = `${row.kind}:${row.id}`;
  if (level.kind === 'groups') {
    if (!target) return null;
    return { kind: 'groups', id: sid, heading, target, variant, groups: level.groups.slice(0, HOME_ROW_SIZE) };
  }
  const elements = level.elements.slice(0, HOME_ROW_SIZE).map(asCard);
  return { kind: 'elements', id: sid, heading, ...(target ? { target } : {}), action: 'openElement', variant, elements };
}

/** Ce que l'accueil affiche, dans l'ordre des rangées ; une rangée qui ne peut être lue est omise. */
export async function homeSections(rows: readonly HomeRow[], src: HomeSources): Promise<HomeSection[]> {
  const needLists = rows.some((r) => r.kind === 'list');
  const lists = needLists ? await src.lists().catch(() => []) : [];
  const sections = await Promise.all(
    rows.map(async (row): Promise<HomeSection | null> => {
      if (row.kind === 'bars') return { kind: 'bars', id: 'bars', bars: await homeBars(row.targets, src) };
      if (row.kind === 'sites') return { kind: 'sites', id: 'sites', heading: src.t('home.rows.sites'), sites: homeSites(row.keys, src) };
      if (row.kind === 'recent') {
        const variant = pageCardVariant('posters', src.card());
        return { kind: 'elements', id: 'recent', heading: src.t('home.rows.recent'), action: 'resume', variant, elements: await recentCards(src) };
      }
      return contentSection(row, src, lists);
    }),
  );
  return sections.filter((s): s is HomeSection => s !== null);
}
