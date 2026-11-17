import { Component, Element, Host, Method, Prop, State, h } from '@stencil/core';
import { gridGroups, gridView, readList, readRecord, sameRange, visibleRange } from '../../utils/elements.ts';
import type { CardElement, GridGroup, ItemRange } from '../../utils/elements.ts';
import { parsePluralLabels, pluralLabel } from '../../utils/plural.ts';

/** Ce que la grille mesure de ses cartes : colonnes, et hauteur d'une ligne avec l'espace qui la suit. */
interface Metrics {
  columns: number;
  rowHeight: number;
}

/**
 * Grille d'éléments (P4-05), en groupes facultatifs (titre et cartes), avec « Afficher plus » quand un groupe dépasse
 * `limit`. Virtualisée : seules les lignes visibles, et deux lignes de chaque côté, sont rendues ; des marges tiennent
 * la place des autres, si bien que la page défile comme si toutes étaient là. Les flèches et la manette passent de
 * carte en carte par le service de navigation (la ligne suivante est toujours rendue). Cartes et actions comme
 * `mire-card` (clé de l'élément).
 */
@Component({ tag: 'mire-grid', shadow: false })
export class MireGrid {
  @Element() host!: HTMLElement;

  /** Éléments d'une grille sans groupes, en propriété ou en JSON. */
  @Prop() elements: CardElement[] | string = [];

  /** Groupes (`key`, `name`, `elements`), en propriété ou en JSON ; prioritaires sur `elements`. */
  @Prop() groups: GridGroup[] | string = [];

  /** Variante des cartes : `poster` (par défaut), `thumbnail` ou `line`. */
  @Prop({ reflect: true }) variant = 'poster';

  /** Contrôleur visé et méthode appelée avec la clé de l'élément (voir `mire-card`). */
  @Prop() target = '';
  @Prop() action = '';

  /** Éléments montrés par groupe avant « Afficher plus », et à chaque appui (0 : tous). */
  @Prop() limit = 0;

  /** Formes du bouton « Afficher plus » (JSON, `{count}` : éléments restants). */
  @Prop() moreLabels = '';

  /** Avancement de la reprise par clé d'élément (JSON : `{"local:/a.mkv": 0.4}`). */
  @Prop() progress: Record<string, number> | string = '';

  /** Info en sous-titre des cartes ; textes des cartes (JSON, voir `mire-card`). */
  @Prop() subtitleInfo = '';
  @Prop() labels = '';

  /** « Afficher plus » demandés, par clé de groupe (1 : aucun). */
  @State() pages = new Map<string, number>();

  /** Part rendue de chaque groupe, par clé. */
  @State() ranges: Record<string, ItemRange> = {};

  @State() metrics: Metrics = { columns: 1, rowHeight: 0 };

  private frame = 0;
  private resizeObserver?: ResizeObserver;
  /** Carte qui doit recevoir le focus quand elle sera rendue (première carte montrée par « Afficher plus »). */
  private focusKey: string | null = null;
  /** La grille avait le focus quand une carte a disparu (défilement au stick) : il revient sur une carte visible. */
  private lastFocused: string | null = null;

  private readonly onScroll = () => this.schedule();
  private readonly onFocusIn = (e: FocusEvent) => {
    this.lastFocused = (e.target as HTMLElement).closest('[data-key]')?.getAttribute('data-key') ?? null;
  };

  /** Montre une page de plus du groupe `key` ; méthode publique, appelée aussi par le bouton « Afficher plus ». */
  @Method()
  async showMore(arg: { key?: string } = {}): Promise<void> {
    const key = arg.key ?? '';
    const group = this.view().find((g) => g.key === key);
    if (!group || group.remaining <= 0) return;
    this.focusKey = group.elements[group.shown]?.key ?? null;
    this.pages = new Map(this.pages).set(key, (this.pages.get(key) ?? 1) + 1);
  }

  connectedCallback() {
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.host.addEventListener('focusin', this.onFocusIn);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.schedule());
      this.resizeObserver.observe(this.host);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.host.removeEventListener('focusin', this.onFocusIn);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  componentDidRender() {
    this.schedule();
    this.restoreFocus();
  }

  private view() {
    return gridView(gridGroups(readList<GridGroup>(this.groups), readList<CardElement>(this.elements)), this.limit, this.pages);
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** Zone visible de la page : celle du conteneur qui défile, dans les limites de la fenêtre. */
  private viewport(): { top: number; bottom: number } {
    for (let x = this.host.parentElement; x && x !== document.body; x = x.parentElement) {
      const overflow = getComputedStyle(x).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        const r = x.getBoundingClientRect();
        return { top: Math.max(0, r.top), bottom: Math.min(innerHeight, r.bottom) };
      }
    }
    return { top: 0, bottom: innerHeight };
  }

  /** Mesure les cartes et la zone visible, puis la part de chaque groupe à rendre (nouveau rendu si elle change). */
  private measure() {
    const items = [...this.host.querySelectorAll<HTMLElement>('.mire-grid__items')];
    const card = items.map((el) => el.querySelector('mire-card')).find(Boolean);
    let metrics = this.metrics;
    if (card && items[0]) {
      const style = getComputedStyle(card.parentElement as HTMLElement);
      const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const rowHeight = card.getBoundingClientRect().height + (parseFloat(style.rowGap) || 0);
      if (rowHeight > 0 && (columns !== metrics.columns || Math.abs(rowHeight - metrics.rowHeight) > 0.5)) metrics = { columns, rowHeight };
    }
    const vp = this.viewport();
    const view = this.view();
    const ranges: Record<string, ItemRange> = {};
    let changed = metrics !== this.metrics;
    for (const el of items) {
      const key = el.dataset.group ?? '';
      const group = view.find((g) => g.key === key);
      if (!group) continue;
      const top = el.getBoundingClientRect().top;
      ranges[key] = visibleRange(group.shown, metrics.columns, metrics.rowHeight, vp.top - top, vp.bottom - top);
      const old = this.ranges[key];
      if (!old || !sameRange(old, ranges[key])) changed = true;
    }
    if (!changed) return;
    this.metrics = metrics;
    this.ranges = ranges;
  }

  /** Focus demandé par « Afficher plus », ou focus perdu parce que sa carte n'est plus rendue. */
  private restoreFocus() {
    const byKey = (key: string) => this.host.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (this.focusKey) {
      const el = byKey(this.focusKey);
      if (el) {
        this.focusKey = null;
        el.focus();
      }
      return;
    }
    const active = document.activeElement;
    if (this.lastFocused && (!active || active === document.body) && !byKey(this.lastFocused)) {
      const vp = this.viewport();
      const visible = [...this.host.querySelectorAll<HTMLElement>('mire-card [data-key]')].find((el) => el.getBoundingClientRect().top >= vp.top);
      visible?.focus({ preventScroll: true });
    }
  }

  private moreText(remaining: number): string {
    const labels = parsePluralLabels(this.moreLabels);
    const lang = this.host.closest('[lang]')?.getAttribute('lang') || 'fr';
    return labels ? pluralLabel(labels, remaining, lang) : String(remaining);
  }

  render() {
    const progress = readRecord<number>(this.progress);
    const { columns, rowHeight } = this.metrics;
    return (
      <Host class={{ 'mire-grid': true, [`--${this.variant}`]: true }}>
        {this.view().map((g) => {
          const range = this.ranges[g.key] ?? visibleRange(g.shown, columns, rowHeight, 0, 0);
          const rows = Math.ceil(g.shown / columns);
          const before = rowHeight ? Math.floor(range.start / columns) * rowHeight : 0;
          const after = rowHeight ? Math.max(0, rows - Math.ceil(range.end / columns)) * rowHeight : 0;
          return (
            <section key={g.key} class="mire-grid__group" aria-label={g.name || undefined}>
              {g.name && (
                <p class="mire-grid__heading" aria-hidden="true">
                  {g.name}
                </p>
              )}
              <div class="mire-grid__items" role="list" data-group={g.key} style={{ paddingTop: `${before}px`, paddingBottom: `${after}px` }}>
                {g.elements.slice(range.start, Math.min(range.end, g.shown)).map((el, i) => (
                  <mire-card
                    key={el.key}
                    role="listitem"
                    aria-posinset={range.start + i + 1}
                    aria-setsize={g.shown}
                    element={el}
                    variant={this.variant}
                    target={this.target}
                    action={this.action}
                    progress={progress[el.key] ?? null}
                    subtitleInfo={this.subtitleInfo}
                    labels={this.labels}
                  />
                ))}
              </div>
              {g.remaining > 0 && (
                <ds-trigger class="mire-grid__more" type="button" mods="stl-3" onClick={() => void this.showMore({ key: g.key })}>
                  {this.moreText(g.remaining)}
                </ds-trigger>
              )}
            </section>
          );
        })}
      </Host>
    );
  }
}
