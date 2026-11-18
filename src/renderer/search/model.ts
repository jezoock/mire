/**
 * Recherche (P4-13), sans DOM : groupes du catalogue par page (`catalog.search`, P2-09), « Où regarder » (fournisseurs
 * `search`), sites où chercher et recherches récentes, rédigés par les catalogues pour `mire-search-view`.
 */
import { fold } from '@mire/shared';
import type { Element as CatalogElement, PageDefinition, SearchResult, WebSite } from '@mire/shared';
import { pageCardVariant } from '@mire/ui/utils';
import type { CardElement, SearchGroupView, SearchSiteView, WatchCard, WatchView } from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Recherches récentes gardées. */
export const MAX_RECENT = 10;

/** Recherches récentes après `query` : en tête, sans doublon (casse et accents ignorés), dix au plus. */
export function withRecent(recent: readonly string[], query: string): string[] {
  const q = query.trim();
  if (!q) return [...recent];
  return [q, ...recent.filter((x) => fold(x) !== fold(q))].slice(0, MAX_RECENT);
}

const asCard = (e: CatalogElement): CardElement => ({ key: e.key, name: e.name, images: e.images, infos: e.infos, tags: e.tags });

/**
 * Groupes du catalogue, dans l'ordre de la réponse (celui du menu, puis les éléments hors pages). Les cartes ont la
 * forme que la page donne aux siennes (affiches, vignettes ou lignes).
 */
export function searchGroups(result: SearchResult, pages: readonly PageDefinition[]): SearchGroupView[] {
  return result.groups.map((g) => {
    const page = g.page ? pages.find((p) => p.id === g.page) : undefined;
    return {
      id: g.page ?? 'none',
      page: page ? page.id : null,
      heading: g.name,
      total: g.total,
      variant: pageCardVariant(page?.display, undefined),
      elements: g.elements.map(asCard),
    };
  });
}

/** Page du premier groupe qui contient l'élément (là où il s'ouvre) ; `null` hors des pages ou s'il est inconnu. */
export function pageOfResult(groups: readonly SearchGroupView[] | null, key: string): string | null {
  return groups?.find((g) => g.elements.some((e) => e.key === key))?.page ?? null;
}

/** Service qui propose un titre (`webId` : site configuré correspondant). */
export interface WatchOffer {
  name: string;
  webId: string | null;
}

/** Film ou série trouvé par le fournisseur `search` du cœur (TMDB et JustWatch, `src/main/search/streaming.ts`). */
export interface WatchResult {
  key: string;
  title: string;
  year: string;
  type: string;
  poster: string | null;
  providers: WatchOffer[];
}

/** Recherche « Où regarder » en cours ou terminée, pour la recherche `q`. */
export interface WatchState {
  q: string;
  status: 'idle' | 'loading' | 'done' | 'error' | 'nokey';
  results: WatchResult[];
  error?: string;
}

/** Couleurs filtrées d'un site, et couleur du texte posé dessus. */
export interface SiteColors {
  color(value: unknown): string;
  ink(color: string): string;
}

/** Services montrés sur une carte. */
const SHOWN_OFFERS = 3;

function watchCard(r: WatchResult, sites: readonly WebSite[], colors: SiteColors, t: Translate): WatchCard {
  const chips = r.providers.slice(0, SHOWN_OFFERS).map((pv) => {
    const w = pv.webId ? sites.find((x) => x.id === pv.webId) : undefined;
    if (!w) return { name: pv.name };
    const color = colors.color(w.color);
    return { name: w.name, color, ink: colors.ink(color) };
  });
  const extra = r.providers.length - SHOWN_OFFERS;
  const more = extra > 0 ? `+${extra}` : r.providers.length ? '' : t('search.watch.noOffer');
  const meta = [t(r.type === 'tv' ? 'search.watch.series' : 'search.watch.movie'), r.year].filter(Boolean).join(', ');
  return { key: r.key, title: r.title, meta, poster: r.poster ?? '', chips, more };
}

/** Partie « Où regarder » pour la recherche `query`. */
export function watchView(state: WatchState, query: string, sites: readonly WebSite[], colors: SiteColors, t: Translate): WatchView {
  const none = (status: WatchView['status'], message: string): WatchView => ({ status, message, cards: [] });
  if (state.status === 'nokey') return none('nokey', t('search.watch.noKey'));
  if (state.q !== query || state.status === 'loading' || state.status === 'idle') return none('loading', t('search.watch.loading'));
  if (state.status === 'error') return none('error', state.error || t('search.watch.failed'));
  if (!state.results.length) return none('empty', t('search.watch.empty'));
  return { status: 'done', message: '', cards: state.results.map((r) => watchCard(r, sites, colors, t)) };
}

/** Sites où chercher la recherche : ceux dont l'adresse de recherche est connue, et les autres (à mémoriser). */
export function siteViews(sites: readonly WebSite[], query: string, colors: SiteColors, t: Translate): SearchSiteView[] {
  return sites.map((w) => {
    const color = colors.color(w.color);
    return {
      id: w.id,
      name: w.name,
      color,
      ink: colors.ink(color),
      how: w.search ? t('search.sites.search', { query }) : t('search.sites.learn'),
    };
  });
}

/**
 * Où ouvrir un titre de « Où regarder » : les sites configurés qui le proposent (le premier s'ouvre, le second est
 * proposé ensuite), sinon le message à afficher (services non configurés, ou aucun).
 */
export function watchTargets(r: WatchResult, sites: readonly WebSite[], t: Translate): { sites: WebSite[]; message: string } {
  const mine = r.providers.map((pv) => (pv.webId ? sites.find((w) => w.id === pv.webId) : undefined)).filter((w): w is WebSite => !!w);
  if (mine.length) return { sites: mine.slice(0, 2), message: '' };
  if (r.providers.length) return { sites: [], message: t('search.watch.notConfigured', { services: r.providers.map((pv) => pv.name).join(', ') }) };
  return { sites: [], message: t('search.watch.nowhere') };
}
