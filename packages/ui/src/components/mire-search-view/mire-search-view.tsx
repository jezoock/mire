import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { searchArgs } from '../../utils/search.ts';
import type { SearchGroupView, SearchLabels, SearchSiteView, WatchCard, WatchView } from '../../utils/search.ts';

/**
 * Vue de la Recherche (P4-13) : le champ, puis, sans recherche, les recherches récentes ; avec une recherche, les
 * éléments du catalogue groupés par page (une rangée `mire-row` par page), les films et séries des fournisseurs
 * `search` (« Où regarder ») et les sites où chercher.
 *
 * Elle n'a ni état ni accès au processus principal : la page (`src/renderer/search/`) lui donne les groupes et les
 * textes déjà rédigés, et reçoit ce qui est tapé (`mireSearchInput`, `mireSearchSubmit`). Le champ n'est réécrit que
 * si la page change la recherche (recherche récente) : la frappe n'est jamais interrompue. Les actions vont au
 * contrôleur `mire-search`, avec la clé de l'élément, la page ou l'identifiant du site.
 */
@Component({ tag: 'mire-search-view', shadow: false })
export class MireSearchView {
  @Element() host!: HTMLElement;

  /** Recherche affichée dans le champ. */
  @Prop() query = '';

  /** Recherches récentes, de la plus récente à la plus ancienne. */
  @Prop() recent: string[] | string = [];

  /** Groupes du catalogue ; `null` sans recherche (les recherches récentes sont montrées). */
  @Prop() groups: SearchGroupView[] | string | null = null;

  /** « Où regarder » ; `null` sans recherche. */
  @Prop() watch: WatchView | string | null = null;

  /** Sites où chercher la recherche en cours. */
  @Prop() sites: SearchSiteView[] | string = [];

  /** Textes (voir `SearchLabels`), ceux des cartes (`mire-card`) et ceux des rangées (`ds-scroller`), en JSON. */
  @Prop() labels: SearchLabels | string = '';
  @Prop() cardLabels = '';
  @Prop() scrollerLabels = '';

  /** Texte tapé (à chaque frappe) et recherche validée (Entrée). */
  @Event() mireSearchInput!: EventEmitter<{ query: string }>;
  @Event() mireSearchSubmit!: EventEmitter<{ query: string }>;

  // Chaque rendu est signalé : la page rend le focus au contenu s'il s'est perdu ; le test de fumée compte les rendus.
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireSearchRender'));
  }

  private onInput = (e: Event) => {
    this.mireSearchInput.emit({ query: (e.target as HTMLInputElement).value });
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // Entrée valide la recherche : la navigation ne la traite pas en plus.
    e.preventDefault();
    e.stopPropagation();
    this.mireSearchSubmit.emit({ query: (e.target as HTMLInputElement).value });
  };

  private renderField(l: SearchLabels) {
    return (
      <div class="mire-search-view__bar">
        <input
          class="mire-search-view__input"
          type="search"
          value={this.query}
          placeholder={l.placeholder}
          aria-label={l.field}
          autocomplete="off"
          spellcheck={false}
          onInput={this.onInput}
          onKeyDown={this.onKeyDown}
        />
      </div>
    );
  }

  private renderIntro(l: SearchLabels) {
    const recent = readList<string>(this.recent);
    return (
      <div class="mire-search-view__intro">
        <p class="mire-search-view__hint">{l.intro}</p>
        {recent.length > 0 && (
          <div class="mire-search-view__recent" role="group" aria-label={l.recent}>
            {recent.map((q) => (
              <ds-trigger key={q} class="mire-search-view__chip" target="mire-search" action={`useRecentQuery:${searchArgs({ query: q })}`}>
                {q}
              </ds-trigger>
            ))}
            <ds-trigger class="mire-search-view__clear" mods="stl-3" target="mire-search" action="clearQueries">
              {l.clearRecent}
            </ds-trigger>
          </div>
        )}
      </div>
    );
  }

  /** Titre d'un groupe : un lien vers sa page quand il en a une. */
  private renderHeading(g: SearchGroupView, l: SearchLabels) {
    const count = (
      <span class="mire-search-view__count" aria-hidden="true">
        {g.total}
      </span>
    );
    if (!g.page)
      return (
        <h2 class="mire-search-view__heading">
          {g.heading}
          {count}
        </h2>
      );
    return (
      <ds-trigger
        class="mire-search-view__heading-link"
        mods="stl-3"
        data-focus-last
        label={[`${g.heading} (${g.total})`, l.seeAll].filter(Boolean).join(', ')}
        target="mire-search"
        action={`openPage:${searchArgs({ page: g.page })}`}
      >
        <span class="mire-search-view__heading" aria-hidden="true">
          {g.heading}
          {count}
        </span>
        {l.seeAll && (
          <span class="mire-search-view__see-all" aria-hidden="true">
            {l.seeAll}
          </span>
        )}
      </ds-trigger>
    );
  }

  private renderGroups(groups: SearchGroupView[], l: SearchLabels) {
    if (!groups.length) return <p class="mire-search-view__hint">{l.none}</p>;
    return groups.map((g) => (
      <section key={g.id} class="mire-search-view__group" data-group={g.id}>
        {this.renderHeading(g, l)}
        <mire-row
          heading={g.heading}
          elements={g.elements}
          variant={g.variant}
          target="mire-search"
          action="openResult"
          labels={this.cardLabels}
          scrollerLabels={this.scrollerLabels}
        />
      </section>
    ));
  }

  private renderWatchCard(c: WatchCard) {
    return (
      <ds-trigger
        key={c.key}
        class="mire-search-view__watch-card"
        data-key={c.key}
        label={[c.title, c.meta, ...c.chips.map((x) => x.name), c.more].filter(Boolean).join(', ')}
        target="mire-search"
        action={`openWatch:${searchArgs({ key: c.key })}`}
      >
        <ds-thumb class="mire-search-view__poster" src={c.poster} ratio="2/3" label={c.title} loading="lazy" decorative />
        <span class="mire-search-view__watch-texts" aria-hidden="true">
          <span class="mire-search-view__watch-title">{c.title}</span>
          <span class="mire-search-view__watch-meta">{c.meta}</span>
          <span class="mire-search-view__chips">
            {c.chips.map((x) => (
              <span
                class={{ 'mire-search-view__provider': true, '--mine': !!x.color }}
                style={x.color ? { '--mire-search-chip': x.color, '--mire-search-chip-ink': x.ink ?? '' } : {}}
              >
                {x.name}
              </span>
            ))}
            {c.more && <span class={{ 'mire-search-view__provider': true, '--none': !c.chips.length }}>{c.more}</span>}
          </span>
        </span>
      </ds-trigger>
    );
  }

  private renderWatch(w: WatchView, l: SearchLabels) {
    let body;
    if (w.status === 'done')
      body = [
        <ds-scroller key="watch" class="mire-search-view__watch" label={l.watch} labels={this.scrollerLabels || undefined}>
          {w.cards.map((c) => this.renderWatchCard(c))}
        </ds-scroller>,
        <p class="mire-search-view__attribution">{l.attribution}</p>,
      ];
    else
      body = (
        <div class="mire-search-view__note">
          <p>{w.message}</p>
          {w.status === 'nokey' && (
            <ds-trigger mods="stl-2" target="mire-search" action="addKey">
              {l.addKey}
            </ds-trigger>
          )}
        </div>
      );
    return (
      <section class="mire-search-view__group" data-group="watch" aria-busy={String(w.status === 'loading')}>
        <h2 class="mire-search-view__heading">{l.watch}</h2>
        {body}
      </section>
    );
  }

  private renderSites(sites: SearchSiteView[], l: SearchLabels) {
    if (!sites.length) return null;
    return (
      <section class="mire-search-view__group" data-group="sites">
        <h2 class="mire-search-view__heading">{l.sites}</h2>
        <div class="mire-search-view__sites">
          {sites.map((s) => (
            <ds-trigger
              key={s.id}
              class="mire-search-view__site"
              style={{ '--mire-search-site': s.color, '--mire-search-site-ink': s.ink }}
              data-key={s.id}
              label={`${s.name}, ${s.how}`}
              target="mire-search"
              action={`searchSite:${searchArgs({ id: s.id })}`}
            >
              <span class="mire-search-view__site-name" aria-hidden="true">
                {s.name}
              </span>
              <span class="mire-search-view__site-how" aria-hidden="true">
                {s.how}
              </span>
            </ds-trigger>
          ))}
        </div>
      </section>
    );
  }

  render() {
    const l = readJson<SearchLabels>(this.labels) ?? {};
    const groups = this.groups === null ? null : readList<SearchGroupView>(this.groups);
    const watch = readJson<WatchView>(this.watch);
    return (
      <Host class="mire-search-view">
        {this.renderField(l)}
        {groups === null ? (
          this.renderIntro(l)
        ) : (
          <div class="mire-search-view__results">
            {this.renderGroups(groups, l)}
            {watch && this.renderWatch(watch, l)}
            {this.renderSites(readList<SearchSiteView>(this.sites), l)}
          </div>
        )}
      </Host>
    );
  }
}
