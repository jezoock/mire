import { Component, Element, Host, Prop, State, h } from '@stencil/core';
import { readJson, readList, readRecord } from '../../utils/elements.ts';
import type { CardElement } from '../../utils/elements.ts';
import { groupKey, groupsAsRows, pageCardVariant, pageLayout } from '../../utils/page-view.ts';
import type { PageCrumb, PageViewGroup, PageViewLabels } from '../../utils/page-view.ts';
import { parsePluralLabels, pluralLabel } from '../../utils/plural.ts';

/**
 * Vue de page (P4-11) : une page du catalogue et ses regroupements, dessinée selon le thème choisi. Elle montre le
 * chemin parcouru (Séries › Friends › Saison 1), puis le niveau affiché : les regroupements (en cartes, ou en rangées
 * de leurs premiers éléments), « Autres » compris, ou les éléments (`mire-grid`). Les tranches suivantes se chargent
 * à l'approche de la fin et par « Afficher la suite ».
 *
 * Elle n'a ni état de la page ni accès au catalogue : la page (`src/renderer/pages/`) lui donne le niveau chargé, ses
 * textes et la mise en page du thème. Les actions vont au contrôleur `mire-page` (`openGroup`, `openPath`,
 * `openElement`, `loadMore`, `openLegacy`) ; les éléments sont désignés par leur clé, les regroupements par leur valeur.
 */
@Component({ tag: 'mire-page-view', shadow: false })
export class MirePageView {
  @Element() host!: HTMLElement;

  /** Chemin parcouru, la page d'abord (JSON ou propriété). */
  @Prop() crumbs: PageCrumb[] | string = [];

  /** Niveau affiché : `groups` (regroupements) ou `elements`. */
  @Prop() kind = 'elements';

  /** Regroupements du niveau (avec leurs premiers éléments en mise en page en rangées). */
  @Prop() groups: PageViewGroup[] | string = [];

  /** Éléments du niveau. */
  @Prop() elements: CardElement[] | string = [];

  /** Nombre total de regroupements ou d'éléments du niveau, et s'il reste des tranches à charger. */
  @Prop() total = 0;
  @Prop() hasMore = false;
  @Prop() loading = false;

  /** Rang du niveau dans les regroupements de la page (`path.length`), et nombre de niveaux (`groupBy.length`). */
  @Prop() depth = 0;
  @Prop() levels = 0;

  /** Indication de la page pour le thème : `posters`, `thumbnails`, `list`, `rows`. */
  @Prop() display = '';

  /** Mise en page du thème : `layout` (`grid`, `rows`), `card` (`auto`…), `size` (`s`, `m`, `l`), `background`. */
  @Prop() layout = 'grid';
  @Prop() card = 'auto';
  @Prop({ reflect: true }) size = 'm';
  @Prop({ reflect: true }) background = 'none';

  /** Avancement de la reprise par clé d'élément (JSON). */
  @Prop() progress: Record<string, number> | string = '';

  /** Textes (JSON, voir `PageViewLabels`) et ceux des cartes et de la grille (JSON, voir `mire-card`, `mire-grid`). */
  @Prop() labels: PageViewLabels | string = '';
  @Prop() cardLabels = '';
  @Prop() moreLabels = '';

  /** Image de fond de l'élément sélectionné (fond `backdrop`). */
  @State() backdrop = '';

  private observer?: IntersectionObserver;

  private readonly onFocusIn = (e: FocusEvent) => {
    if (this.background !== 'backdrop') return;
    const key = (e.target as HTMLElement).closest('[data-key]')?.getAttribute('data-key');
    if (!key) return;
    const all = [...readList<CardElement>(this.elements), ...readList<PageViewGroup>(this.groups).flatMap((g) => g.elements ?? [])];
    const el = all.find((x) => x.key === key);
    const src = el?.images?.background || '';
    if (src) this.backdrop = src;
  };

  connectedCallback() {
    this.host.addEventListener('focusin', this.onFocusIn);
  }

  disconnectedCallback() {
    this.host.removeEventListener('focusin', this.onFocusIn);
    this.observer?.disconnect();
    this.observer = undefined;
  }

  // Chaque rendu est signalé (`mirePageRender`) : la page sait ainsi quand le niveau chargé est à l'écran (focus).
  // À l'approche de la fin du niveau, la page demande la tranche suivante (`mirePageMore`).
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mirePageRender', { detail: { loading: this.loading } }));
    const sentinel = this.host.querySelector('.mire-page-view__end');
    this.observer?.disconnect();
    if (!sentinel || !this.hasMore || this.loading || typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) this.host.dispatchEvent(new CustomEvent('mirePageMore', { bubbles: true, detail: {} }));
      },
      { rootMargin: '600px' },
    );
    this.observer.observe(sentinel);
  }

  private plural(json: string | undefined, count: number): string {
    const labels = parsePluralLabels(json ?? '');
    const lang = this.host.closest('[lang]')?.getAttribute('lang') || 'fr';
    return labels ? pluralLabel(labels, count, lang) : '';
  }

  private renderPath(crumbs: PageCrumb[], labels: PageViewLabels) {
    return (
      <nav class="mire-page-view__path" aria-label={labels.path || undefined} data-focus-last>
        {/* À la racine de la page, le chemin se réduit à son nom, déjà dans l'en-tête. */}
        <ol class="mire-page-view__crumbs" hidden={crumbs.length < 2}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={JSON.stringify(c.path)} class={{ 'mire-page-view__crumb': true, '--current': last }}>
                {last ? (
                  <span class="mire-page-view__title" aria-current="page">
                    {c.label}
                  </span>
                ) : (
                  <ds-trigger class="mire-page-view__crumb-link" mods="stl-3" target="mire-page" action={`openPath:${JSON.stringify([{ path: c.path }])}`}>
                    {c.label}
                  </ds-trigger>
                )}
              </li>
            );
          })}
        </ol>
        {labels.legacy && (
          <ds-trigger class="mire-page-view__legacy" mods="stl-3" target="mire-page" action="openLegacy">
            {labels.legacy}
          </ds-trigger>
        )}
      </nav>
    );
  }

  private renderGroups(groups: PageViewGroup[], rows: boolean, variant: string, labels: PageViewLabels, progress: Record<string, number>) {
    if (rows) {
      return (
        <div class="mire-page-view__rows">
          {groups.map((g) => (
            <section key={groupKey(g.value)} class="mire-page-view__row" aria-label={g.name}>
              <ds-trigger
                class="mire-page-view__row-title"
                mods="stl-3"
                target="mire-page"
                action={`openGroup:${JSON.stringify([{ value: g.value }])}`}
                label={[g.name, this.plural(labels.count, g.count)].filter(Boolean).join(', ')}
              >
                <span class="mire-page-view__row-name">{g.name}</span>
                <span class="mire-page-view__row-count">{this.plural(labels.count, g.count)}</span>
              </ds-trigger>
              <mire-row
                key={`${groupKey(g.value)}:${(g.elements ?? []).length}`}
                elements={g.elements ?? []}
                variant={variant}
                target="mire-page"
                action="openElement"
                progress={progress}
                labels={this.cardLabels}
              />
            </section>
          ))}
        </div>
      );
    }
    return (
      <div class="mire-page-view__groups" role="list">
        {groups.map((g) => (
          <mire-group-card
            key={groupKey(g.value)}
            role="listitem"
            group={g}
            variant={variant}
            target="mire-page"
            action="openGroup"
            countLabels={labels.count ?? ''}
          />
        ))}
      </div>
    );
  }

  render() {
    const crumbs = readList<PageCrumb>(this.crumbs);
    const labels = readJson<PageViewLabels>(this.labels) ?? {};
    const groups = readList<PageViewGroup>(this.groups);
    const elements = readList<CardElement>(this.elements);
    const progress = readRecord<number>(this.progress);
    const variant = pageCardVariant(this.display, this.card);
    const layout = pageLayout(this.display, this.layout);
    const rows = this.kind === 'groups' && groupsAsRows(layout, this.depth, this.levels);
    const count = this.kind === 'groups' ? groups.length : elements.length;
    const remaining = Math.max(0, this.total - count);
    return (
      <Host
        class={{
          'mire-page-view': true,
          [`--layout-${rows ? 'rows' : 'grid'}`]: true,
          [`--size-${this.size}`]: true,
          [`--bg-${this.background}`]: true,
          [`--${variant}`]: true,
        }}
      >
        {this.background === 'backdrop' && <mire-backdrop class="mire-page-view__backdrop" src={this.backdrop} />}
        {crumbs.length > 0 && this.renderPath(crumbs, labels)}
        {this.kind === 'groups' ? (
          this.renderGroups(groups, rows, variant, labels, progress)
        ) : (
          <mire-grid
            key={JSON.stringify(crumbs[crumbs.length - 1]?.path ?? [])}
            class="mire-page-view__grid"
            elements={elements}
            variant={variant}
            target="mire-page"
            action="openElement"
            progress={progress}
            labels={this.cardLabels}
            moreLabels={this.moreLabels}
          />
        )}
        {!this.loading && count === 0 && labels.empty && <p class="mire-page-view__status">{labels.empty}</p>}
        {this.loading && labels.loading && (
          <p class="mire-page-view__status" role="status">
            {labels.loading}
          </p>
        )}
        {this.hasMore && (
          <div class="mire-page-view__end">
            <ds-trigger class="mire-page-view__more" mods="stl-3" target="mire-page" action="loadMore" disabled={this.loading}>
              {this.plural(labels.more, remaining) || String(remaining)}
            </ds-trigger>
          </div>
        )}
      </Host>
    );
  }
}
