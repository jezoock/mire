/**
 * Pages de la coquille (P4-11) : l'hôte `<mire-page>` et sa vue (`mire-page-view`), remplis d'après la route du
 * routeur (page et chemin dans les regroupements) et le thème choisi (moteur de thèmes). L'interface historique place
 * l'hôte dans la vue des écrans quand une page est affichée (section `page`) ; il garde son contenu entre deux
 * affichages.
 */
import type { InfoScalar, PageDefinition, PagePath, PagesChange } from '@mire/shared';
import { groupsAsRows, pageLayout, parentPath } from '@mire/ui/utils';
import type { Router } from '../shell/index.ts';
import { legacySectionOf } from '../shell/index.ts';
import { createThemeEngine, documentThemeHost } from '../themes/index.ts';
import type { ThemeEngine, ThemeEntry } from '../themes/index.ts';
import { parseTarget } from '@mire/shared';
import { createPageModel, pageName } from './model.ts';
import type { LevelSource, PageModel, PageViewData } from './model.ts';

export { createPageModel, groupFormatter, pageName, ROW_SIZE } from './model.ts';
export type { PageViewData } from './model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface PagesOptions {
  router: Router;
  /** Pages connues (`pages.list`), ou `null`. */
  pages(): readonly PageDefinition[] | null;
  level: LevelSource;
  onPagesChange(listener: (change: PagesChange) => void): unknown;
  t: Translate;
  /** Textes structurés des catalogues (formes plurielles, textes des cartes). */
  raw(key: string): unknown;
  onLanguageChange(listener: () => void): unknown;
  /** Thèmes connus (le premier, ou `mire`, par défaut). */
  themes: readonly ThemeEntry[];
  /**
   * Le niveau demandé est chargé et rendu : titre de l'en-tête, et focus à rendre au contenu s'il s'est perdu (les
   * cartes du niveau précédent ont été retirées).
   */
  onLoaded(): void;
}

export interface Pages {
  /** Hôte des pages, à placer dans la vue des écrans. */
  readonly host: HTMLElement;
  /** Moteur de thèmes, qui habille l'hôte (palette, polices, fond) et donne la mise en page à la vue. */
  readonly engine: ThemeEngine;
  /** Ouvre un regroupement du niveau affiché, désigné par sa valeur. */
  openGroup(value: InfoScalar | null): boolean;
  /** Revient à une étape du chemin parcouru. */
  openPath(path: PagePath): boolean;
  /** Remonte d'un niveau ; faux à la racine de la page. */
  back(): boolean;
  loadMore(): Promise<void>;
  /** Nom de la page affichée (titre de l'en-tête). */
  title(): string;
  /** Section historique de la page affichée (« Ancienne vue »), ou `null`. */
  legacySection(): string | null;
  current(): PageViewData | null;
}

type ViewEl = HTMLElement & Record<string, unknown>;

export function createPages(opts: PagesOptions, doc: Document = document): Pages {
  const { router, t } = opts;
  const host = doc.createElement('mire-page');
  const view = doc.createElement('mire-page-view') as ViewEl;
  host.append(view);
  // La palette, les polices et le fond du thème habillent l'hôte, jamais les écrans du cœur.
  const engine = createThemeEngine(opts.themes, documentThemeHost(host, doc));

  const json = (key: string) => {
    const v = opts.raw(key);
    return v && typeof v === 'object' ? JSON.stringify(v) : '';
  };
  /** Page de la route ; une page inconnue de la liste est demandée telle quelle (le catalogue dira si elle existe). */
  const page = (): PageDefinition | null => {
    const target = parseTarget(router.current().target);
    if (target?.kind !== 'page') return null;
    return opts.pages()?.find((p) => p.id === target.id) ?? { id: target.id, name: target.id, require: [] };
  };

  const model: PageModel = createPageModel({
    level: opts.level,
    t,
    rows: (depth, levels, display) => groupsAsRows(pageLayout(display, engine.current().page.layout), depth, levels),
    onUpdate: render,
  });

  function labels() {
    const p = model.route()?.page;
    const legacy = p && legacySectionOf(p.id);
    return {
      path: t('pageView.path'),
      count: json('elements.group.count'),
      more: json('pageView.more'),
      loading: t('pageView.loading'),
      empty: t(model.current()?.missing ? 'pageView.missing' : 'pageView.empty'),
      ...(legacy ? { legacy: t('pageView.legacy') } : {}),
    };
  }

  function render(data: PageViewData) {
    Object.assign(view, {
      crumbs: data.crumbs,
      kind: data.kind,
      groups: data.groups,
      elements: data.elements,
      total: data.total,
      hasMore: data.hasMore,
      loading: data.loading,
      depth: data.depth,
      levels: data.levels,
      display: data.display,
      labels: labels(),
      cardLabels: json('elements.card'),
      moreLabels: json('elements.grid.more'),
    });
  }

  function applyTheme() {
    const { page: layout } = engine.current();
    Object.assign(view, { layout: layout.layout, card: layout.card, size: layout.size, background: layout.background });
  }

  // Un niveau chargé n'est annoncé qu'une fois rendu par la vue.
  let announce = false;
  view.addEventListener('mirePageRender', (e) => {
    if (!announce || (e as CustomEvent<{ loading: boolean }>).detail.loading) return;
    announce = false;
    opts.onLoaded();
  });

  async function load() {
    const p = page();
    if (!p) return;
    announce = false;
    await model.show(p, router.current().path);
    announce = true;
  }

  router.onChange(() => void load());
  view.addEventListener('mirePageMore', () => void model.more());
  // Sons du thème : le passage d'une carte à l'autre.
  view.addEventListener('focusin', (e) => {
    if ((e.target as Element).closest('mire-card, mire-group-card, .mire-page-view__row-title')) engine.play('move');
  });
  const refresh = async () => {
    await model.refresh();
    announce = true;
  };
  opts.onPagesChange(({ pages }) => {
    const r = model.route();
    if (r && pages.includes(r.page.id)) void refresh();
  });
  // Changement de thème : la mise en page (rangées ou grille) peut demander d'autres données.
  engine.onChange(() => {
    applyTheme();
    void refresh();
  });
  engine.set(undefined);
  opts.onLanguageChange(() => void refresh());

  const open = (path: PagePath) => router.open(router.current().target, { path, focus: 'content' });

  return {
    host,
    engine,
    openGroup(value) {
      const r = model.route();
      if (!r) return false;
      engine.play('select');
      return open([...r.path, value]);
    },
    openPath: (path) => open(path),
    back() {
      const r = model.route();
      const up = r && parentPath(r.path);
      if (!up) return false;
      engine.play('back');
      return open(up);
    },
    loadMore: () => model.more(),
    title() {
      const p = model.route()?.page ?? page();
      return p ? pageName(p, t) : '';
    },
    legacySection() {
      const r = model.route();
      return r ? legacySectionOf(r.page.id) : null;
    },
    current: () => model.current(),
  };
}
