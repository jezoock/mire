/**
 * Accueil de la coquille (P4-12), côté page : l'hôte `<mire-home>` et sa vue (`mire-home-view`), remplis d'après les
 * réglages de l'accueil (`ui.home`), le catalogue et le thème choisi (le même moteur que les pages). L'interface
 * historique place l'hôte dans la vue des écrans quand l'accueil est affiché (section `home`) ; il garde son contenu
 * entre deux affichages, et se met à jour quand les réglages, les pages, la langue ou le thème changent.
 */
import type { HomeSettings, ListSummary, PagesChange } from '@mire/shared';
import type { ThemeEngine } from '../themes/index.ts';
import { homeSections } from './model.ts';
import type { HomeSources } from './model.ts';

export { HOME_ROW_SIZE, homeBars, homeSections, homeSites, recentCard, recentCards, recentKey } from './model.ts';
export type { HomeSources, RecentItem } from './model.ts';
export { chosen, homeOptions, isHomeList, moveChosen, rowId, toggleChosen, withChosen } from './settings.ts';
export type { HomeList, HomeOption } from './settings.ts';

export interface HomeOptions extends Omit<HomeSources, 'card'> {
  settings(): HomeSettings | undefined;
  /** Langue de l'interface (heure et date). */
  language(): string;
  raw(key: string): unknown;
  onLanguageChange(listener: () => void): unknown;
  onPagesChange(listener: (change: PagesChange) => void): unknown;
  /** L'accueil est rendu après une mise à jour (focus à rendre au contenu s'il s'est perdu). */
  onRendered(): void;
}

export interface Home {
  /** Hôte de l'accueil, à placer dans la vue des écrans. Il doit être habillé par `engine` (voir `createPages`). */
  readonly host: HTMLElement;
  /** Relit les rangées (réglages, « Reprendre », sites ouverts, catalogue). */
  refresh(): Promise<void>;
  /** Heure et date de l'horloge. */
  tick(now: Date): void;
  /** Listes connues à la dernière mise à jour (réglages de l'accueil). */
  lists(): readonly ListSummary[];
  /** Branche le moteur de thèmes (mise en page, cartes) : il est créé avec les pages, qui partagent le thème. */
  attach(engine: ThemeEngine): void;
}

type ViewEl = HTMLElement & Record<string, unknown>;

export function createHome(opts: HomeOptions, doc: Document = document): Home {
  const host = doc.createElement('mire-home');
  const view = doc.createElement('mire-home-view') as ViewEl;
  host.append(view);
  let engine: ThemeEngine | null = null;
  let lists: readonly ListSummary[] = [];
  let generation = 0;

  const json = (key: string) => {
    const v = opts.raw(key);
    return v && typeof v === 'object' ? JSON.stringify(v) : '';
  };
  const sources: HomeSources = {
    ...opts,
    lists: async () => lists,
    card: () => engine?.current().page.card ?? 'auto',
  };

  function labels() {
    const { t } = opts;
    return { bars: t('home.bars.label'), open: t('home.sites.open'), seeAll: t('home.rows.seeAll'), empty: t('home.empty'), customize: t('home.customize') };
  }

  function applyTheme() {
    const active = engine?.current();
    if (!active) return;
    Object.assign(view, { layout: active.home.layout, size: active.page.size });
    if (active.page.background === 'image') host.dataset.background = 'image';
    else delete host.dataset.background;
  }

  async function refresh() {
    const gen = ++generation;
    const home = opts.settings();
    if (!home) return;
    // Les listes servent aux rangées et aux réglages de l'accueil.
    lists = await opts.lists().catch(() => lists);
    const sections = await homeSections(home.rows, sources);
    // Une mise à jour plus récente a été demandée pendant la lecture du catalogue.
    if (gen !== generation) return;
    Object.assign(view, {
      sections,
      clock: home.clock,
      labels: labels(),
      cardLabels: json('elements.card'),
      countLabels: json('elements.group.count'),
      scrollerLabels: json('elements.row'),
    });
    await (view as HTMLElement & { componentOnReady?: () => Promise<unknown> }).componentOnReady?.();
    if (gen === generation) opts.onRendered();
  }

  function tick(now: Date) {
    const lang = opts.language() || 'fr';
    Object.assign(view, {
      time: now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }),
      datetime: now.toISOString(),
    });
  }

  opts.onLanguageChange(() => void refresh());
  opts.onPagesChange(() => void refresh());

  return {
    host,
    refresh,
    tick,
    lists: () => lists,
    attach(next) {
      engine = next;
      applyTheme();
      next.onChange(() => {
        applyTheme();
        void refresh();
      });
    },
  };
}
