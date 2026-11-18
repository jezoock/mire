/**
 * Routeur de la coquille (P4-07) : ce qui est affiché est un état, une cible (`@mire/shared`, `targets.ts`) et un
 * chemin dans les regroupements d'une page (`PagePath`). Une cible s'écrit `movies` (une page), `list:<id>` (une
 * liste) ou `screen:<nom>` (un écran du cœur, `CORE_SCREENS`).
 *
 * Tant qu'un écran ou une page n'a pas de vue à lui (explorateur P4-08, vue de page P4-11…), il s'affiche dans la vue
 * historique qui en tient lieu (`LEGACY_VIEWS`) : la section de `app.js` (`videos` pour Films et Séries). Sans DOM.
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

/**
 * Vue historique qui tient lieu de chaque écran et de chaque page prête à l'emploi, jusqu'à son remplacement.
 * L'ordre compte : la première cible d'une vue est celle que l'on retient quand l'interface historique l'ouvre.
 * L'explorateur n'en a pas (P4-08) ; une page créée par l'utilisateur non plus, jusqu'à la vue de page (P4-11).
 */
export const LEGACY_VIEWS: ReadonlyArray<readonly [target: string, section: string]> = [
  ['screen:home', 'home'],
  ['screen:search', 'search'],
  ['screen:center', 'downloads'],
  ['screen:settings', 'settings'],
  ['movies', 'videos'],
  ['series', 'videos'],
  ['music', 'music'],
  ['images', 'images'],
  ['streaming', 'streaming'],
  ['tv', 'tv'],
  ['games', 'games'],
];

/** Section historique qui affiche une cible ; `null` si aucune vue ne l'affiche encore. */
export function legacyViewOf(target: string): string | null {
  return LEGACY_VIEWS.find(([t]) => t === target)?.[1] ?? null;
}

/** Première cible affichée par une section historique ; `null` pour une vue sans cible (site ouvert, démonstration). */
export function targetOfLegacyView(section: string): string | null {
  return LEGACY_VIEWS.find(([, s]) => s === section)?.[0] ?? null;
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
   * (un site ouvert reste rattaché à la page d'où il vient) ou si la route affichée est déjà dans cette section.
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
      const section = next && legacyViewOf(next.target);
      if (!next || !section) return false;
      set(next);
      host.show(section, { focus });
      return true;
    },
    follow(section) {
      if (legacyViewOf(route.target) === section) return;
      const target = targetOfLegacyView(section);
      if (target) set({ target, path: [] });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
