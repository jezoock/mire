/**
 * Routeur de la coquille (P4-07) : ce qui est affiché est un état, une cible (`@mire/shared`, `targets.ts`) et un
 * chemin dans les regroupements d'une page (`PagePath`). Une cible s'écrit `movies` (une page), `list:<id>` (une
 * liste) ou `screen:<nom>` (un écran du cœur, `CORE_SCREENS`).
 *
 * Une page s'affiche dans la vue de page (`PAGE_VIEW`, `mire-page-view`, P4-11), l'accueil dans la sienne (`HOME_VIEW`,
 * `mire-home`, P4-12), toutes deux dessinées par le thème ; la Recherche (`SEARCH_VIEW`, `mire-search`, P4-13) et le
 * Centre (`CENTRE_VIEW`, `mire-centre`, P4-18) et l'explorateur (`EXPLORER_VIEW`, `mire-explorer`, P4-08) dans les leurs,
 * avec l'habillage du cœur. Tant qu'un écran du cœur n'a pas de vue à lui (Réglages P4-20), il s'affiche dans la vue historique qui en tient lieu
 * (`LEGACY_VIEWS`) : la section de `app.js`. Les sections historiques des pages prêtes à l'emploi restent ouvrables
 * (« Ancienne vue », `LEGACY_PAGE_SECTIONS`) tant que la vue de page n'en reprend pas tout (P4-16, P4-17). Sans DOM.
 */
import { formatTarget, parseTarget } from '@mire/shared';
import type { PagePath } from '@mire/shared';

export interface Route {
  /** Cible affichée, écrite en texte (`screen:home`, `movies`, `list:favoris`). */
  target: string;
  /** Chemin dans les regroupements d'une page (vide hors d'une page). */
  path: PagePath;
}

export const HOME_TARGET = formatTarget({ kind: 'screen', screen: 'home' });

/** Vue qui affiche les pages (P4-11) : la section `page` de l'interface, qui contient `mire-page-view`. */
export const PAGE_VIEW = 'page';

/**
 * Vue qui affiche l'accueil (P4-12) : la section `home` de l'interface, qui contient `<mire-home>`. Elle garde le nom
 * de l'ancienne section, que l'interface historique emploie encore (retour, rouage, page de démarrage).
 */
export const HOME_VIEW = 'home';

export const CENTRE_TARGET = formatTarget({ kind: 'screen', screen: 'center' });

/**
 * Vue qui affiche le Centre (P4-18) : la section `downloads` de l'interface, qui contient `<mire-centre>`. Elle garde le
 * nom de l'ancienne section Téléchargements, que l'interface historique emploie encore (rouage, badge, LB et RB).
 */
export const CENTRE_VIEW = 'downloads';

export const SEARCH_TARGET = formatTarget({ kind: 'screen', screen: 'search' });

/** Vue qui affiche la Recherche (P4-13) : la section `search` de l'interface, qui contient `<mire-search>`. */
export const SEARCH_VIEW = 'search';

export const EXPLORER_TARGET = formatTarget({ kind: 'screen', screen: 'explorer' });

/** Vue qui affiche l'explorateur (P4-08) : la section `explorer` de l'interface, qui contient `<mire-explorer>`. */
export const EXPLORER_VIEW = 'explorer';

/**
 * Écrans du cœur qui ont déjà leur vue en composants (P4-12 : l'accueil ; P4-13 : la Recherche ; P4-18 : le Centre ;
 * P4-08 : l'explorateur).
 */
export const SCREEN_VIEWS: ReadonlyArray<readonly [target: string, section: string]> = [
  [HOME_TARGET, HOME_VIEW],
  [SEARCH_TARGET, SEARCH_VIEW],
  [CENTRE_TARGET, CENTRE_VIEW],
  [EXPLORER_TARGET, EXPLORER_VIEW],
];

/** Vue historique qui tient lieu de chaque écran du cœur, jusqu'à son remplacement. */
export const LEGACY_VIEWS: ReadonlyArray<readonly [target: string, section: string]> = [['screen:settings', 'settings']];

/**
 * Section historique de chaque page prête à l'emploi (« Ancienne vue ») : elle garde ce que la vue de page ne fait pas
 * encore (choix de la box, consoles, ajout de sites…). L'ordre compte : la première page d'une section est celle que
 * l'on retient quand l'interface historique l'ouvre (Films pour les vidéos).
 */
export const LEGACY_PAGE_SECTIONS: ReadonlyArray<readonly [page: string, section: string]> = [
  ['movies', 'videos'],
  ['series', 'videos'],
  ['music', 'music'],
  ['images', 'images'],
  ['streaming', 'streaming'],
  ['tv', 'tv'],
  ['games', 'games'],
];

/** Section historique qui affiche un écran du cœur ; `null` pour une page, une liste ou un écran qui a sa vue. */
export function legacyViewOf(target: string): string | null {
  return LEGACY_VIEWS.find(([t]) => t === target)?.[1] ?? null;
}

/** Section historique d'une page prête à l'emploi (« Ancienne vue ») ; `null` pour une autre page. */
export function legacySectionOf(page: string): string | null {
  return LEGACY_PAGE_SECTIONS.find(([p]) => p === page)?.[1] ?? null;
}

/** Vue qui affiche une cible : la vue de page pour une page, la vue historique d'un écran ; `null` sinon. */
export function viewOf(target: string): string | null {
  const t = parseTarget(target);
  if (!t) return null;
  if (t.kind === 'page') return PAGE_VIEW;
  if (t.kind !== 'screen') return null;
  return SCREEN_VIEWS.find(([s]) => s === target)?.[1] ?? legacyViewOf(target);
}

/**
 * Cible affichée par une section : un écran du cœur (l'accueil compris), ou la première page dont c'est l'ancienne vue ;
 * `null` pour une vue sans cible (site ouvert, démonstration).
 */
export function targetOfLegacyView(section: string): string | null {
  return (
    SCREEN_VIEWS.find(([, s]) => s === section)?.[0] ??
    LEGACY_VIEWS.find(([, s]) => s === section)?.[0] ??
    LEGACY_PAGE_SECTIONS.find(([, s]) => s === section)?.[0] ??
    null
  );
}

/** Route d'une cible ; `null` si le texte n'est pas une cible. Le chemin ne vaut que pour une page ou une liste. */
export function routeOf(target: unknown, path: PagePath = []): Route | null {
  const t = parseTarget(target);
  if (!t) return null;
  return { target: formatTarget(t), path: t.kind === 'screen' ? [] : [...path] };
}

export const sameRoute = (a: Route, b: Route): boolean => a.target === b.target && a.path.length === b.path.length && a.path.every((v, i) => v === b.path[i]);

export interface RouterHost {
  /** Affiche une section historique (le `go` de `app.js`). */
  show(section: string, opts: { focus: string }): void;
}

export interface Router {
  /** Route affichée. */
  current(): Route;
  /**
   * Ouvre une cible (et un chemin dans ses regroupements). Faux si ce n'est pas une cible, ou si aucune vue ne
   * l'affiche encore : rien ne change alors.
   */
  open(target: unknown, opts?: { path?: PagePath; focus?: string }): boolean;
  /**
   * L'interface historique a changé de section par elle-même (`go`) : la route suit, sauf pour une vue sans cible
   * (un site ouvert reste rattaché à la page d'où il vient) ou si la route affichée est déjà dans cette section (ou
   * dans l'ancienne vue de sa page).
   */
  follow(section: string): void;
  /** Prévient à chaque changement de route. */
  onChange(listener: (route: Route) => void): () => void;
}

export function createRouter(host: RouterHost): Router {
  let route: Route = { target: HOME_TARGET, path: [] };
  const listeners = new Set<(r: Route) => void>();
  const set = (next: Route) => {
    if (sameRoute(next, route)) return;
    route = next;
    for (const l of listeners) l(route);
  };
  return {
    current: () => route,
    open(target, { path = [], focus = 'content' } = {}) {
      const next = routeOf(target, path);
      const section = next && viewOf(next.target);
      if (!next || !section) return false;
      set(next);
      host.show(section, { focus });
      return true;
    },
    follow(section) {
      if (viewOf(route.target) === section || legacySectionOf(route.target) === section) return;
      const target = targetOfLegacyView(section);
      if (target) set({ target, path: [] });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
