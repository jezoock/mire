/**
 * Vue web de la coquille (P4-16), côté page : l'hôte `<mire-web>`, la barre du site (`mire-webbar`) et la place de la
 * vue native (`mire-web-slot`). La barre est redessinée à chaque état publié par le processus principal ; la place
 * réservée, à chaque changement de taille, part au processus principal (`webShow`, `webBounds`), qui la contrôle.
 */
import { slotBounds } from '@mire/ui/utils';
import type { Box, MenuSide, WebBarIcons, WebBarView } from '@mire/ui/utils';
import { webBarView } from './model.ts';

export { adLabel, kindOf, webBarView, webHome } from './model.ts';

export interface WebOptions {
  t(key: string, vars?: Record<string, string | number>): string;
  icons: WebBarIcons;
  /** Bloqueur de publicités allumé dans les réglages. */
  adblock(): boolean;
  /** Menu automatique déplié par-dessus le contenu : sa zone et son côté ; `null` sinon. */
  menu(): { box: Box; side: MenuSide } | null;
  /** La vue native peut-elle se montrer (section web affichée, aucune couche ni boîte devant) ? */
  shouldShow(): boolean;
  show(id: string, bounds: Box, focus: boolean): unknown;
  bounds(bounds: Box): unknown;
  hide(): unknown;
  /** Site de jeux choisi dans la barre. */
  onSite(id: string, site: number): void;
  onLanguageChange(listener: () => void): unknown;
}

export interface Web {
  readonly host: HTMLElement;
  /** Affiche le site `id` avec son dernier état publié (`null` : aucun site). */
  set(id: string | null, state: Record<string, unknown> | null): void;
  /** Montre la vue native sur sa place, ou la cache. */
  sync(focus?: boolean): void;
  /** Barre affichée (tests, focus). */
  bar(): WebBarView | null;
  /** Premier bouton utilisable de la barre. */
  firstButton(): HTMLElement | null;
}

type El = HTMLElement & Record<string, unknown>;

export function createWeb(opts: WebOptions, doc: Document = document): Web {
  const host = doc.createElement('mire-web');
  const barEl = doc.createElement('mire-webbar') as El;
  const slot = doc.createElement('mire-web-slot') as El;
  host.append(barEl, slot);
  let id: string | null = null;
  let state: Record<string, unknown> | null = null;
  let view: WebBarView | null = null;

  const labels = () => {
    const keys = [
      'label',
      'back',
      'forward',
      'reload',
      'site',
      'siteChoice',
      'learn',
      'learnTitle',
      'learned',
      'learnedTitle',
      'bookmarkPage',
      'bookmarkPageTitle',
      'bookmarkGame',
      'bookmarkGameTitle',
      'immersive',
      'immersiveTitle',
      'browser',
      'browserTitle',
      'close',
      'closeTitle',
    ];
    return Object.fromEntries(keys.map((k) => [k, opts.t(`webView.bar.${k}`)]));
  };

  function render() {
    view = id ? webBarView(state ?? { id }, { t: opts.t, adblock: opts.adblock() }) : null;
    barEl.labels = labels();
    barEl.icons = opts.icons;
    barEl.bar = view;
    slot.loadingLabel = view ? opts.t('webView.loading', { name: view.name }) : '';
  }

  const place = (): Box | null => {
    if (!host.isConnected) return null;
    const r = slot.getBoundingClientRect();
    return slotBounds({ x: r.left, y: r.top, width: r.width, height: r.height }, opts.menu());
  };

  slot.addEventListener('mireWebSlotResize', () => {
    const b = place();
    if (b && id && opts.shouldShow()) opts.bounds(b);
  });
  barEl.addEventListener('mireWebSite', (e) => {
    if (id) opts.onSite(id, (e as CustomEvent<{ site: number }>).detail.site);
  });
  opts.onLanguageChange(render);
  render();

  return {
    host,
    set(nextId, nextState) {
      id = nextId;
      state = nextState;
      render();
    },
    sync(focus = false) {
      const b = place();
      if (!id || !b || !opts.shouldShow()) {
        opts.hide();
        return;
      }
      opts.show(id, b, focus);
    },
    bar: () => view,
    firstButton: () => [...host.querySelectorAll<HTMLElement>('mire-webbar .focusable')].find((el) => !(el as HTMLButtonElement).disabled) ?? null,
  };
}
