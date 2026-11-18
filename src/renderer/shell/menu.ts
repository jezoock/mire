/**
 * Entrées du menu principal (P4-07) : les écrans du cœur et les pages épinglées (`pages.list`, `menu.pinned`, dans
 * l'ordre de `menu.order`), puis le Centre, les Réglages et les outils. Sans DOM.
 *
 * Tant qu'une page s'affiche dans une vue historique (`LEGACY_VIEWS`), son entrée est celle de cette vue : même nom,
 * même couleur, et une seule entrée pour les pages qu'une même vue affiche (Films et Séries → Vidéos). Une page sans
 * vue (créée par l'utilisateur) et l'explorateur n'apparaissent qu'avec la leur (P4-11, P4-08).
 */
import type { PageDefinition } from '@mire/shared';
import type { RailEntry, RailSession } from '@mire/ui/utils';
import { legacyViewOf } from './router.ts';

type Translate = (key: string) => string;

/** Couleur de chaque vue historique dans le menu (celles des barres de la mire). */
const VIEW_COLORS: Readonly<Record<string, string>> = {
  search: 'var(--text)',
  home: 'var(--bar-white)',
  videos: 'var(--bar-yellow)',
  music: 'var(--bar-cyan)',
  images: 'var(--bar-green)',
  streaming: 'var(--bar-magenta)',
  tv: 'var(--bar-red)',
  games: 'var(--bar-blue)',
};
const MUTED = 'var(--muted)';

/** Vues dont les sites ouverts s'affichent sous l'entrée : services, portails de télévision, sites de jeux. */
export const SESSION_VIEWS = ['streaming', 'tv', 'games'] as const;

/** Pages épinglées par défaut (celles du plugin des pages prêtes à l'emploi), si la liste des pages manque. */
export const DEFAULT_PINNED = ['movies', 'series', 'music', 'images', 'streaming', 'tv', 'games'];

/** Pages épinglées, dans l'ordre du menu (`menu.order`, puis l'ordre de la liste). */
export function pinnedPages(pages: readonly PageDefinition[]): PageDefinition[] {
  return pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.menu?.pinned)
    .sort((a, b) => (a.p.menu?.order ?? Infinity) - (b.p.menu?.order ?? Infinity) || a.i - b.i)
    .map(({ p }) => p);
}

const screen = (t: Translate, name: string, view: string, icon: string, color: string, bottom = false): RailEntry => ({
  key: `screen:${name}`,
  kind: 'screen',
  target: `screen:${name}`,
  view,
  label: t(`shell.views.${view}`),
  icon,
  color,
  ...(bottom ? { bottom } : {}),
});

/**
 * Entrées du menu, de haut en bas (de gauche à droite en carrousel). `pages` : la réponse de `pages.list`, ou `null`
 * si elle manque (pages prêtes à l'emploi épinglées par défaut).
 */
export function railEntries(pages: readonly PageDefinition[] | null, t: Translate): RailEntry[] {
  const ids = pages ? pinnedPages(pages).map((p) => p.id) : DEFAULT_PINNED;
  const seen = new Set<string>();
  const pageEntries: RailEntry[] = [];
  for (const id of ids) {
    const view = legacyViewOf(id);
    if (!view || seen.has(view)) continue;
    seen.add(view);
    pageEntries.push({
      key: id,
      kind: 'page',
      target: id,
      view,
      label: t(`shell.views.${view}`),
      color: VIEW_COLORS[view] ?? MUTED,
      ...((SESSION_VIEWS as readonly string[]).includes(view) ? { sessions: true } : {}),
    });
  }
  return [
    screen(t, 'search', 'search', 'search', VIEW_COLORS.search as string),
    { ...screen(t, 'home', 'home', '', VIEW_COLORS.home as string) },
    ...pageEntries,
    screen(t, 'center', 'downloads', 'download', MUTED, true),
    { key: 'openFile', kind: 'openFile', label: t('shell.menu.openFile'), icon: 'folder', color: MUTED, bottom: true },
    screen(t, 'settings', 'settings', 'gear', MUTED, true),
    { key: 'quit', kind: 'quit', label: t('shell.menu.quit'), icon: 'power', color: MUTED, bottom: true },
  ];
}

/** Entrée affichée pour une section historique (un site ouvert compte pour la page d'où il vient). */
export function currentEntry(entries: readonly RailEntry[], section: string): string {
  return entries.find((e) => e.view === section)?.key ?? '';
}

/** Site ouvert tel que le processus principal le décrit (`web.sessions`). */
export interface WebSession {
  id: string;
  name: string;
  color?: string;
}

/**
 * Sites ouverts, rangés sous l'entrée d'où ils viennent (`home(id)` : streaming, tv ou games) ; `safeColor` filtre
 * les couleurs venues de la configuration.
 */
export function railSessions(
  entries: readonly RailEntry[],
  sessions: readonly WebSession[],
  home: (id: string) => string,
  safeColor: (c: unknown) => string,
): Record<string, RailSession[]> {
  const out: Record<string, RailSession[]> = {};
  for (const e of entries) if (e.sessions) out[e.key] = [];
  for (const s of sessions) {
    const entry = entries.find((e) => e.sessions && e.view === home(s.id));
    out[entry?.key ?? '']?.push({ id: s.id, name: s.name, color: safeColor(s.color) });
  }
  return out;
}

/** États des téléchargements qui comptent dans le badge du menu. */
export function activeDownloads(downloads: readonly { state?: string }[], active: ReadonlySet<string>): number {
  return downloads.filter((d) => active.has(String(d.state))).length;
}
