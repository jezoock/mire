/**
 * Recherche de la coquille (P4-13), côté page : l'hôte `<mire-search>` et sa vue (`mire-search-view`). Ce qui est tapé
 * lance, après une courte pause, la recherche dans le catalogue (`catalog.search`, groupée par page), puis celle des
 * fournisseurs `search` (« Où regarder »). Pendant la frappe, seules les propriétés qui changent sont données à la
 * vue : le champ n'est pas réécrit, et une rangée dont les résultats n'ont pas changé n'est pas redessinée.
 */
import type { PageDefinition, SearchResult, WebSite } from '@mire/shared';
import { keepGroups } from '@mire/ui/utils';
import type { SearchGroupView } from '@mire/ui/utils';
import { pageOfResult, searchGroups, siteViews, watchView } from './model.ts';
import type { SiteColors, WatchResult, WatchState } from './model.ts';

export { MAX_RECENT, pageOfResult, searchGroups, siteName, siteViews, watchTargets, watchView, withRecent } from './model.ts';
export type { WatchResult, WatchState } from './model.ts';

/** Pause après la dernière frappe avant de chercher dans le catalogue, puis avant d'interroger « Où regarder ». */
export const TYPING_PAUSE = 180;
export const WATCH_PAUSE = 350;

export interface SearchOptions extends SiteColors {
  t(key: string, vars?: Record<string, string | number>): string;
  raw(key: string): unknown;
  catalog(query: string): Promise<SearchResult>;
  /** Fournisseur `search` du cœur ; `null` s'il manque la clé du catalogue. */
  watch(query: string): Promise<{ ok: boolean; results?: unknown[]; reason?: string; error?: string }> | null;
  pages(): readonly PageDefinition[];
  sites(): readonly WebSite[];
  /** Recherches récentes, et en retenir une (validée, ou dont un résultat est ouvert). */
  recent(): readonly string[];
  remember(query: string): void;
  onLanguageChange(listener: () => void): unknown;
  /** La vue est rendue après une mise à jour (focus à rendre au contenu s'il s'est perdu). */
  onRendered(): void;
}

export interface Search {
  /** Hôte de la Recherche, à placer dans la vue des écrans. */
  readonly host: HTMLElement;
  /** Recherche en cours. */
  query(): string;
  /** Met une recherche dans le champ et la lance (recherche récente). */
  setQuery(query: string): Promise<void>;
  /** Relit tout : textes, recherches récentes, résultats (affichage de l'écran, langue, configuration). */
  refresh(): Promise<void>;
  /** Oublie « Où regarder » (la clé ou le pays ont changé) ; la prochaine mise à jour le relance. */
  resetWatch(): void;
  /** Donne le focus au champ. */
  focusField(): void;
  /** Page d'un résultat affiché ; titre de « Où regarder » par sa clé. */
  pageOf(key: string): string | null;
  watchResult(key: string): WatchResult | null;
}

type ViewEl = HTMLElement & Record<string, unknown>;

export function createSearch(opts: SearchOptions, doc: Document = document): Search {
  const host = doc.createElement('mire-search');
  const view = doc.createElement('mire-search-view') as ViewEl;
  host.append(view);
  let query = '';
  let groups: SearchGroupView[] | null = null;
  let watch: WatchState = { q: '', status: 'idle', results: [] };
  let typing: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let watchSeq = 0;

  const json = (key: string) => {
    const v = opts.raw(key);
    return v && typeof v === 'object' ? JSON.stringify(v) : '';
  };

  function labels() {
    const { t } = opts;
    return {
      field: t('search.field'),
      placeholder: t('search.placeholder'),
      intro: t('search.intro'),
      recent: t('search.recent.label'),
      clearRecent: t('search.recent.clear'),
      seeAll: t('search.seeAll'),
      watch: t('search.watch.heading'),
      sites: t('search.sites.heading'),
      addKey: t('search.watch.addKey'),
      attribution: t('search.watch.attribution'),
      none: t('search.none'),
    };
  }

  const showWatch = () => {
    view.watch = query ? watchView(watch, query, opts.sites(), opts, opts.t) : null;
  };

  async function fetchWatch(q: string) {
    if (watch.q === q && watch.status !== 'idle') return;
    const id = ++watchSeq;
    watch = { q, status: 'loading', results: [] };
    showWatch();
    await new Promise((r) => setTimeout(r, WATCH_PAUSE));
    if (id !== watchSeq) return;
    const asked = opts.watch(q);
    if (!asked) {
      watch = { q, status: 'nokey', results: [] };
      showWatch();
      return;
    }
    const r = await asked.catch((err: Error) => ({ ok: false, error: err.message, results: undefined, reason: undefined }));
    if (id !== watchSeq) return;
    if (r.ok) watch = { q, status: 'done', results: (r.results ?? []) as WatchResult[] };
    else if (r.reason === 'nokey') watch = { q, status: 'nokey', results: [] };
    else watch = { q, status: 'error', results: [], error: r.error || '' };
    showWatch();
  }

  /** Cherche `q` dans le catalogue, puis « Où regarder ». */
  async function run(q: string) {
    const id = ++seq;
    query = q.trim();
    if (!query) {
      groups = null;
      watchSeq++;
      Object.assign(view, { groups: null, watch: null, sites: [], recent: [...opts.recent()] });
      return;
    }
    const result = await opts.catalog(query).catch(() => null);
    if (id !== seq) return;
    const next = result ? searchGroups(result, opts.pages()) : [];
    groups = keepGroups(groups ?? [], next);
    Object.assign(view, { groups, sites: siteViews(opts.sites(), query, opts, opts.t) });
    showWatch();
    void fetchWatch(query);
  }

  // Frappe : la recherche part après une pause ; Entrée la lance tout de suite, la retient et va aux résultats.
  view.addEventListener('mireSearchInput', (e) => {
    clearTimeout(typing);
    const q = (e as CustomEvent<{ query: string }>).detail.query;
    typing = setTimeout(() => void run(q), TYPING_PAUSE);
  });
  view.addEventListener('mireSearchSubmit', (e) => {
    clearTimeout(typing);
    const q = (e as CustomEvent<{ query: string }>).detail.query;
    void run(q).then(() => {
      if (!query) return;
      opts.remember(query);
      focusResults();
    });
  });

  // Après le rendu des rangées : la première carte (ou le premier bouton) des résultats.
  function focusResults() {
    const tryFocus = (left: number) => {
      const first = view.querySelector<HTMLElement>('.mire-search-view__results ds-trigger.hydrated');
      if (first) first.focus();
      else if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
    };
    tryFocus(30);
  }

  view.addEventListener('mireSearchRender', () => opts.onRendered());

  async function refresh() {
    Object.assign(view, {
      labels: labels(),
      cardLabels: json('elements.card'),
      scrollerLabels: json('elements.row'),
      recent: [...opts.recent()],
    });
    await run(query);
  }

  opts.onLanguageChange(() => {
    watch = { q: '', status: 'idle', results: [] };
    void refresh();
  });

  return {
    host,
    query: () => query,
    async setQuery(q) {
      clearTimeout(typing);
      view.query = q;
      await run(q);
    },
    refresh,
    resetWatch() {
      watchSeq++;
      watch = { q: '', status: 'idle', results: [] };
    },
    focusField() {
      // Au premier affichage, la vue n'est pas encore rendue : le champ reçoit le focus dès qu'il existe.
      const tryFocus = (left: number) => {
        const field = view.querySelector<HTMLInputElement>('.mire-search-view__input');
        if (field) field.focus();
        else if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
      };
      tryFocus(30);
    },
    pageOf: (key) => pageOfResult(groups, key),
    watchResult: (key) => (watch.status === 'done' && watch.results.find((r) => r.key === key)) || null,
  };
}
