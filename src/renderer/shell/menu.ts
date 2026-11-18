/**
 * Entrées du menu principal (P4-07) : les écrans du cœur et les pages épinglées (`pages.list`, `menu.pinned`, dans
 * l'ordre de `menu.order`), puis le Centre, les Réglages et les outils. Sans DOM.
 *
 * Chaque page épinglée a son entrée, avec le nom de la page (P4-11) : Films et Séries ont chacune la leur, une page
 * créée par l'utilisateur aussi. Une page prête à l'emploi garde la couleur et les sites ouverts de son ancienne vue
 * (`LEGACY_PAGE_SECTIONS`). L'explorateur (P4-08) est en bas, avec le Centre et les Réglages.
 */
import type { PageDefinition } from '@mire/shared';
import type { RailEntry, RailSession } from '@mire/ui/utils';
import { PAGE_VIEW, legacySectionOf } from './router.ts';
import { pageName } from '../pages/model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Couleur de chaque vue historique dans le menu (celles des barres de la mire). */
export const VIEW_COLORS: Readonly<Record<string, string>> = {
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
const CENTRE_KEY = 'screen:center';

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
  const pinned = pages ? pinnedPages(pages) : DEFAULT_PINNED.map((id): PageDefinition => ({ id, name: { key: `pages.${id}` }, require: [] }));
  const pageEntries = pinned.map((p): RailEntry => {
    const legacy = legacySectionOf(p.id);
    return {
      key: p.id,
      kind: 'page',
      target: p.id,
      view: legacy ?? PAGE_VIEW,
      label: pageName(p, t),
      color: (legacy && VIEW_COLORS[legacy]) || MUTED,
      ...(legacy && (SESSION_VIEWS as readonly string[]).includes(legacy) ? { sessions: true } : {}),
    };
  });
  return [
    screen(t, 'search', 'search', 'search', VIEW_COLORS.search as string),
    screen(t, 'home', 'home', '', VIEW_COLORS.home as string),
    ...pageEntries,
    screen(t, 'center', 'downloads', 'download', MUTED, true),
    screen(t, 'explorer', 'explorer', 'layers', MUTED, true),
    { key: 'openFile', kind: 'openFile', label: t('shell.menu.openFile'), icon: 'folder', color: MUTED, bottom: true },
    screen(t, 'settings', 'settings', 'gear', MUTED, true),
    { key: 'quit', kind: 'quit', label: t('shell.menu.quit'), icon: 'power', color: MUTED, bottom: true },
  ];
}

/**
 * Entrée affichée pour une section : la page de la route dans la vue de page ou dans son ancienne vue, sinon l'entrée
 * de la section (un site ouvert compte pour la page d'où il vient).
 */
export function currentEntry(entries: readonly RailEntry[], section: string, target = ''): string {
  const page = entries.find((e) => e.kind === 'page' && e.target === target);
  if (page && (section === PAGE_VIEW || page.view === section)) return page.key;
  if (section === PAGE_VIEW) return '';
  return entries.find((e) => e.view === section)?.key ?? '';
}

/**
 * Cibles que parcourent les boutons LB et RB de la manette : les écrans et pages du haut du menu, dans l'ordre, puis le
 * Centre (en bas du menu, mais c'est un écran qu'on visite comme une page). Réglages et Quitter restent hors du cycle.
 */
export function cycleTargets(entries: readonly RailEntry[]): string[] {
  const top = entries.filter((e) => !e.bottom && e.target).map((e) => e.target as string);
  const centre = entries.find((e) => e.key === CENTRE_KEY);
  return centre ? [...top, CENTRE_KEY] : top;
}

/** Cible suivante (`step` 1) ou précédente (-1), en boucle ; une cible hors de la liste compte comme la première. */
export function nextTarget(targets: readonly string[], current: string, step: number): string | null {
  if (!targets.length) return null;
  const i = Math.max(0, targets.indexOf(current));
  return targets[(i + step + targets.length) % targets.length] ?? null;
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
