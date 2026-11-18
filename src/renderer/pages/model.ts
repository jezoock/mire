/**
 * Vue de page, côté page (P4-11) : ce que `mire-page-view` affiche d'une page du catalogue. Charge un niveau à la
 * fois par tranches (`catalog.page`), met en forme les regroupements (« Autres », « Saison 1 ») et le chemin parcouru
 * (Séries › Friends › Saison 1), et, en mise en page en rangées, les premiers éléments de chaque regroupement. Sans
 * DOM : le catalogue et les textes sont injectés.
 */
import type { InfoScalar, PageDefinition, PageDisplay, PageElement, PageLevel, PagePath } from '@mire/shared';
import { groupLabel, pageCrumbs } from '@mire/ui/utils';
import type { GroupFormatter, PageCrumb, PageViewGroup } from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Éléments montrés dans la rangée d'un regroupement (le reste s'ouvre avec le regroupement). */
export const ROW_SIZE = 20;

/** Ce que la vue affiche. */
export interface PageViewData {
  page: string;
  crumbs: PageCrumb[];
  kind: 'groups' | 'elements';
  groups: PageViewGroup[];
  elements: PageElement[];
  /** Info des regroupements du niveau (`series`, `season`…), ou `''`. */
  info: string;
  total: number;
  hasMore: boolean;
  loading: boolean;
  /** La page ou le chemin n'existe pas (page supprimée, regroupement disparu). */
  missing: boolean;
  depth: number;
  levels: number;
  display: PageDisplay | '';
}

/** Lecture d'un niveau (`catalog.page`) ; `null` si la page ou le chemin n'existe pas. */
export type LevelSource = (pageId: string, path: PagePath, cursor: string | null) => Promise<PageLevel | null>;

/** Nom affiché d'une page : son texte, ou celui de sa clé dans les catalogues. */
export const pageName = (page: Pick<PageDefinition, 'name'>, t: Translate): string => (typeof page.name === 'string' ? page.name : t(page.name.key));

/** Mise en forme des valeurs de regroupement qui ne se lisent pas seules (une saison : « Saison 1 »). */
export const groupFormatter =
  (t: Translate): GroupFormatter =>
  (info, value) =>
    info === 'season' && value !== null ? t('pageView.season', { value: String(value) }) : null;

export interface PageModelOptions {
  level: LevelSource;
  t: Translate;
  /** Les regroupements de ce niveau s'affichent-ils en rangées (mise en page du thème) ? */
  rows(depth: number, levels: number, display: PageDisplay | ''): boolean;
  onUpdate(data: PageViewData): void;
}

export interface PageModel {
  /** Affiche un niveau d'une page (première tranche). */
  show(page: PageDefinition, path: PagePath): Promise<void>;
  /** Tranche suivante du niveau affiché. */
  more(): Promise<void>;
  /** Recharge le niveau affiché (contenu changé, thème changé), autant de tranches que déjà montrées. */
  refresh(): Promise<void>;
  current(): PageViewData | null;
  /** Page et chemin affichés. */
  route(): { page: PageDefinition; path: PagePath } | null;
}

const empty = (page: PageDefinition, path: PagePath, t: Translate): PageViewData => ({
  page: page.id,
  crumbs: pageCrumbs(pageName(page, t), page.groupBy ?? [], path, t('pages.others'), groupFormatter(t)),
  kind: path.length < (page.groupBy?.length ?? 0) ? 'groups' : 'elements',
  groups: [],
  elements: [],
  info: page.groupBy?.[path.length] ?? '',
  total: 0,
  hasMore: false,
  loading: true,
  missing: false,
  depth: path.length,
  levels: page.groupBy?.length ?? 0,
  display: page.display ?? '',
});

export function createPageModel(opts: PageModelOptions): PageModel {
  const { t } = opts;
  let shown: { page: PageDefinition; path: PagePath } | null = null;
  let data: PageViewData | null = null;
  let cursor: string | null = null;
  // Chaque demande porte un numéro : la réponse d'une page quittée entre-temps est ignorée.
  let generation = 0;

  const update = (next: PageViewData) => {
    data = next;
    opts.onUpdate(next);
  };

  function groupsOf(level: PageLevel & { kind: 'groups' }): PageViewGroup[] {
    const format = groupFormatter(t);
    return level.groups.map((g) => ({
      value: g.value,
      name: groupLabel(level.info, g.value, t('pages.others'), format),
      count: g.count,
      ...(g.poster ? { poster: g.poster } : {}),
    }));
  }

  /** Premiers éléments de chaque regroupement, pour les rangées. */
  async function withRows(page: PageDefinition, path: PagePath, groups: PageViewGroup[]): Promise<PageViewGroup[]> {
    return Promise.all(
      groups.map(async (g) => {
        const lvl = await opts.level(page.id, [...path, g.value as InfoScalar | null], null);
        return { ...g, elements: lvl?.kind === 'elements' ? lvl.elements.slice(0, ROW_SIZE) : [] };
      }),
    );
  }

  /** Ajoute à `base` la tranche qui suit `from` (ou la première) ; `null` si une autre demande l'a emporté. */
  async function load(gen: number, from: string | null, base: PageViewData): Promise<PageViewData | null> {
    if (!shown) return null;
    const { page, path } = shown;
    const level = await opts.level(page.id, path, from);
    if (gen !== generation) return null;
    if (!level) {
      cursor = null;
      return { ...base, loading: false, hasMore: false, missing: true };
    }
    let { groups, elements } = base;
    if (level.kind === 'groups') {
      let added = groupsOf(level);
      if (opts.rows(path.length, page.groupBy?.length ?? 0, page.display ?? '')) added = await withRows(page, path, added);
      if (gen !== generation) return null;
      groups = [...groups, ...added];
    } else elements = [...elements, ...level.elements];
    cursor = level.next;
    const info = level.kind === 'groups' ? level.info : '';
    return { ...base, kind: level.kind, info, groups, elements, total: level.total, hasMore: !!level.next, loading: false, missing: false };
  }

  const shownCount = (d: PageViewData) => (d.kind === 'groups' ? d.groups.length : d.elements.length);

  return {
    async show(page, path) {
      const gen = ++generation;
      shown = { page, path: [...path] };
      cursor = null;
      const base = empty(page, path, t);
      update(base);
      const next = await load(gen, null, base);
      if (next) update(next);
    },
    async more() {
      if (!data || !cursor || data.loading) return;
      const gen = generation;
      update({ ...data, loading: true });
      const next = await load(gen, cursor, data);
      if (next) update(next);
    },
    async refresh() {
      if (!shown || !data) return;
      const count = shownCount(data);
      const { page, path } = shown;
      const gen = ++generation;
      cursor = null;
      // Le niveau est relu en entier avant d'être montré : la vue ne passe pas par une page vide.
      let next = await load(gen, null, { ...empty(page, path, t), loading: false });
      while (next && cursor && shownCount(next) < count) next = await load(gen, cursor, next);
      if (next) update(next);
    },
    current: () => data,
    route: () => (shown ? { page: shown.page, path: [...shown.path] } : null),
  };
}
