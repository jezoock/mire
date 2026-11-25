/**
 * Coquille de l'application, côté page (P4-07) : monte `<mire-app>`, puis donne au menu (`mire-rail`), à l'en-tête
 * (`mire-header`), à l'aide de la manette (`mire-padbar`) et à la zone de dépôt des fichiers leurs entrées et leurs
 * textes, tirés des catalogues. Tient le routeur (`router.ts`) et les classes du document qui règlent la mise en page
 * du menu (`menu-left`… `menu-auto`, `menu-open`, lues par styles.css et par le placement de la vue web).
 */
import type { PageDefinition, PagePath } from '@mire/shared';
import { menuPosition } from '@mire/ui/utils';
import type { MenuPosition, PadHint, RailEntry, RailLabels, RailSession } from '@mire/ui/utils';
import { ICON } from '../core/icons.ts';
import { currentEntry, cycleTargets, nextTarget, railEntries, railSessions } from './menu.ts';
import type { WebSession } from './menu.ts';
import { createRouter } from './router.ts';
import type { Router, RouterHost } from './router.ts';

export {
  CENTRE_VIEW,
  EXPLORER_VIEW,
  HOME_VIEW,
  PAGE_VIEW,
  SEARCH_VIEW,
  SETTINGS_VIEW,
  legacySectionOf,
  routeOf,
  settingsPartOf,
  targetOfLegacyView,
  viewOf,
} from './router.ts';
export type { Route, Router } from './router.ts';

type Rendered = HTMLElement & { componentOnReady?: () => Promise<unknown> };

/** Attend le premier rendu d'un composant `mire-*` (et de ceux qu'il contient). */
async function whenRendered(el: Rendered): Promise<void> {
  await customElements.whenDefined(el.localName);
  if (el.componentOnReady) await el.componentOnReady();
  while (!el.classList.contains('hydrated')) await new Promise((r) => requestAnimationFrame(r));
}

/** Monte la coquille : attend le rendu de `<mire-app>` (menu, en-tête, lecteurs). La page (`app.js`) ne démarre qu'après. */
export async function mountShell(doc: Document = document): Promise<void> {
  const app = doc.querySelector('mire-app') as Rendered;
  await whenRendered(app);
  // Le lecteur vidéo (P4-14) contient l'élément <video> que les lecteurs prennent au démarrage.
  await whenRendered(doc.querySelector('mire-video-player') as Rendered);
  // Les lecteurs de musique et d'images (P4-15) reçoivent leurs textes et le volume au démarrage.
  await Promise.all(['mire-mini-player', 'mire-image-viewer'].map((tag) => whenRendered(doc.querySelector(tag) as Rendered)));
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Ce que la coquille demande à la page : traduction, et ce qui suit l'ouverture ou la fermeture du menu. */
export interface ShellHost extends RouterHost {
  t: Translate;
  /** Langue de l'interface (format de l'heure) ; prévient à chaque changement. */
  language(): string;
  onLanguageChange(listener: () => void): unknown;
  /** Le menu rétractable s'ouvre ou se ferme, ou sa position change : la vue web se replace. */
  onLayout(): void;
}

/** En-tête demandé par la vue affichée : un titre tiré tel quel (nom d'une page) ou celui de la vue. */
export interface HeaderState {
  view: string;
  title?: string;
}

export interface ScrapeProgress {
  running?: boolean;
  done?: number;
  total?: number;
}

export interface Shell {
  readonly router: Router;
  /** Pages (`pages.list`) ; `null` si la liste manque. */
  setPages(pages: readonly PageDefinition[] | null): void;
  /** Position du menu et menu rétractable (réglages `ui.menu`). */
  setMenu(menu: { position?: unknown; autohide?: unknown } | undefined): void;
  /** Section historique affichée ; `webHome` : page d'où vient le site affiché. */
  setSection(section: string, webHome: string): void;
  /** Sites ouverts et site affiché. */
  setSessions(sessions: readonly WebSession[], active: string, home: (id: string) => string, safeColor: (c: unknown) => string): void;
  /** Téléchargements en cours (badge du Centre). */
  setDownloads(count: number): void;
  setHeader(state: HeaderState): void;
  /** Rouage : caché, et état de la récupération des infos. */
  setGear(state: { hidden: boolean; scrape?: ScrapeProgress | null }): void;
  /** Heure de l'en-tête. */
  tick(now: Date): void;
  /** Aide de la manette ; `null` : cachée. */
  setPadHints(hints: PadHint[] | null): void;
  /** Ouvre une cible (`screen:home`, `movies`, `list:<id>`) ; faux si aucune vue ne l'affiche encore. */
  open(target: unknown, opts?: { path?: PagePath; focus?: string }): boolean;
  /** Écran ou page suivant (`step` 1) ou précédent (-1) du menu (LB et RB de la manette). */
  cycle(step: number): void;
  /** Pages connues (`pages.list`), ou `null`. */
  pages(): readonly PageDefinition[] | null;
}

type RailEl = HTMLElement & {
  entries: RailEntry[];
  current: string;
  sessions: Record<string, RailSession[]>;
  currentSite: string;
  badges: Record<string, number>;
  position: string;
  autohide: boolean;
  open: boolean;
  labels: RailLabels;
  icons: Record<string, string>;
};
type HeaderEl = HTMLElement &
  Record<'heading' | 'gearLabel' | 'gearTitle' | 'gearIcon' | 'time' | 'datetime', string> &
  Record<'gearBusy' | 'gearHidden', boolean>;
type PadbarEl = HTMLElement & { hints: PadHint[] };

export function createShell(host: ShellHost, doc: Document = document): Shell {
  const rail = doc.querySelector('mire-rail') as RailEl;
  const header = doc.querySelector('mire-header') as HeaderEl;
  const padbar = doc.querySelector('mire-padbar') as PadbarEl;
  const body = doc.body;
  const router = createRouter(host);
  const { t } = host;

  let pages: readonly PageDefinition[] | null = null;
  let entries: RailEntry[] = [];
  let section = 'home';
  let webHome = 'streaming';
  let sessions: { list: readonly WebSession[]; home: (id: string) => string; safeColor: (c: unknown) => string } = {
    list: [],
    home: () => '',
    safeColor: String,
  };
  let downloads = 0;
  let headerState: HeaderState = { view: 'home' };
  let scrape: ScrapeProgress | null = null;
  let lastTime: Date | null = null;

  rail.icons = ICON as Record<string, string>;
  header.gearIcon = ICON.gear;

  const current = () => currentEntry(entries, section === 'web' ? webHome : section, router.current().target);
  router.onChange(() => (rail.current = current()));
  const centerKey = () => entries.find((e) => e.target === 'screen:center')?.key ?? '';
  function renderRail() {
    entries = railEntries(pages, t);
    rail.entries = entries;
    rail.current = current();
    rail.sessions = railSessions(entries, sessions.list, sessions.home, sessions.safeColor);
    rail.badges = { [centerKey()]: downloads };
    const sessionLabels: Record<string, string> = {};
    for (const e of entries) if (e.sessions && e.view) sessionLabels[e.key] = t(`shell.menu.sessions.${e.view}`);
    rail.labels = { menu: t('shell.menu.label'), brand: t('shell.brand'), prev: t('shell.menu.prev'), next: t('shell.menu.next'), sessions: sessionLabels };
  }

  function renderHeader() {
    const s = headerState;
    header.heading = s.title ?? t(`shell.views.${s.view}`);
    header.gearLabel = t('shell.header.gear');
    header.gearBusy = !!scrape?.running;
    header.gearTitle = scrape?.running
      ? scrape.total
        ? t('shell.header.gearScraping', { done: scrape.done ?? 0, total: scrape.total })
        : t('shell.header.gearPreparing')
      : '';
  }

  // Zone de dépôt des fichiers (glisser-déposer) : son texte suit la langue.
  const renderDrop = () => {
    const text = doc.querySelector('#drop .drop__text');
    if (text) text.textContent = t('shell.drop');
  };

  function tick(now: Date) {
    lastTime = now;
    header.time = now.toLocaleTimeString(host.language() || 'fr', { hour: '2-digit', minute: '2-digit' });
    header.datetime = now.toISOString();
  }

  rail.addEventListener('mireRailToggle', (e) => {
    body.classList.toggle('menu-open', (e as CustomEvent<{ open: boolean }>).detail.open);
    setTimeout(() => host.onLayout(), 260);
  });

  host.onLanguageChange(() => {
    renderRail();
    renderHeader();
    renderDrop();
    if (lastTime) tick(lastTime);
  });

  renderRail();
  renderDrop();

  return {
    router,
    setPages(next) {
      pages = next;
      renderRail();
    },
    setMenu(menu) {
      const position: MenuPosition = menuPosition(menu?.position);
      const autohide = !!menu?.autohide;
      for (const p of ['left', 'right', 'top', 'bottom']) body.classList.toggle(`menu-${p}`, position === p);
      body.classList.toggle('menu-auto', autohide);
      body.classList.remove('menu-open');
      rail.open = false;
      rail.position = position;
      rail.autohide = autohide;
    },
    setSection(next, home) {
      section = next;
      webHome = home;
      router.follow(next);
      rail.current = current();
    },
    setSessions(list, active, home, safeColor) {
      sessions = { list, home, safeColor };
      rail.sessions = railSessions(entries, list, home, safeColor);
      rail.currentSite = section === 'web' ? active : '';
    },
    setDownloads(count) {
      downloads = count;
      rail.badges = { [centerKey()]: count };
    },
    setHeader(state) {
      headerState = state;
      renderHeader();
    },
    setGear(state) {
      header.gearHidden = state.hidden;
      scrape = state.scrape ?? null;
      renderHeader();
    },
    tick,
    setPadHints(hints) {
      padbar.hints = hints ?? [];
    },
    open: (target, opts) => router.open(target, opts),
    cycle(step) {
      const from = section === 'web' ? (entries.find((e) => e.view === webHome)?.target ?? '') : router.current().target;
      const next = nextTarget(cycleTargets(entries), from, step);
      if (next) router.open(next, { focus: next === 'screen:search' ? 'keep' : 'content' });
    },
    pages: () => pages,
  };
}
