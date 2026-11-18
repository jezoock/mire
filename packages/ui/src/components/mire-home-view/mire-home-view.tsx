import { Component, Element, Host, Prop, h } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { homeIsEmpty, homeLayout, keyArgs, sectionHasContent, targetArgs } from '../../utils/home.ts';
import type { HomeBar, HomeLabels, HomeSection, HomeSite } from '../../utils/home.ts';

/**
 * Vue de l'accueil (P4-12), dessinée selon le thème choisi : l'horloge, puis les rangées choisies dans les réglages,
 * dans leur ordre : barres de la mire, sites épinglés, « Reprendre », premiers éléments ou regroupements d'une page ou
 * d'une liste. Les rangées d'éléments sont des `mire-row` (ou des `mire-grid` en mise en page en grille).
 *
 * Elle n'a ni état ni accès au catalogue : la page (`src/renderer/home/`) lui donne les rangées, l'heure, ses textes
 * et la mise en page du thème. Les actions vont au contrôleur `mire-home` (`open`, `openGroup`, `openElement`,
 * `openSite`, `resume`) et à `mire-app` (`openSettings`) ; les cibles sont écrites en texte (`movies`,
 * `screen:search`), les éléments désignés par leur clé, les regroupements par leur valeur.
 */
@Component({ tag: 'mire-home-view', shadow: false })
export class MireHomeView {
  @Element() host!: HTMLElement;

  /** Rangées, dans l'ordre (JSON ou propriété, voir `HomeSection`). */
  @Prop() sections: HomeSection[] | string = [];

  /** Horloge : affichée ou non, heure et date déjà mises en forme, et l'instant (`datetime`). */
  @Prop() clock = true;
  @Prop() time = '';
  @Prop() date = '';
  @Prop() datetime = '';

  /** Mise en page du thème (`rows` ou `grid`) et taille des cartes (`s`, `m`, `l`). */
  @Prop({ reflect: true }) layout = 'rows';
  @Prop({ reflect: true }) size = 'm';

  /** Textes (JSON, voir `HomeLabels`) et ceux des cartes et des regroupements (JSON, voir `mire-card`, `mire-group-card`). */
  @Prop() labels: HomeLabels | string = '';
  @Prop() cardLabels = '';
  @Prop() countLabels = '';
  @Prop() scrollerLabels = '';

  private renderBars(bars: HomeBar[], labels: HomeLabels) {
    return (
      <nav class="mire-home-view__bars" aria-label={labels.bars || undefined}>
        {bars.map((b) => (
          <ds-trigger
            key={b.target}
            class="mire-home-view__bar"
            style={{ '--mire-home-bar': b.color }}
            data-target={b.target}
            label={[b.label, b.meta].filter(Boolean).join(', ')}
            target="mire-home"
            action={`open:${targetArgs(b.target)}`}
          >
            <span class="mire-home-view__bar-label" aria-hidden="true">
              {b.label}
            </span>
            {b.meta && (
              <span class="mire-home-view__bar-meta" aria-hidden="true">
                {b.meta}
              </span>
            )}
          </ds-trigger>
        ))}
      </nav>
    );
  }

  private renderSites(sites: HomeSite[], labels: HomeLabels) {
    return (
      <div class="mire-home-view__sites">
        {sites.map((s) => (
          <ds-trigger
            key={s.key}
            class="mire-home-view__site"
            style={{ '--mire-home-site': s.color, '--mire-home-site-ink': s.ink }}
            data-key={s.key}
            label={[s.name, s.open ? labels.open : ''].filter(Boolean).join(', ')}
            target="mire-home"
            action={`openSite:${keyArgs(s.key)}`}
          >
            <span class="mire-home-view__site-name" aria-hidden="true">
              {s.name}
            </span>
            {s.open && labels.open && (
              <span class="mire-home-view__site-open" aria-hidden="true">
                {labels.open}
              </span>
            )}
          </ds-trigger>
        ))}
      </div>
    );
  }

  /** Titre d'une rangée : un lien vers sa page quand elle en a une, sinon un simple titre. */
  private renderHeading(heading: string, target: string | undefined, labels: HomeLabels) {
    if (!target) return <h2 class="mire-home-view__heading">{heading}</h2>;
    return (
      <ds-trigger
        class="mire-home-view__heading-link"
        mods="stl-3"
        data-focus-last
        label={[heading, labels.seeAll].filter(Boolean).join(', ')}
        target="mire-home"
        action={`open:${targetArgs(target)}`}
      >
        <span class="mire-home-view__heading" aria-hidden="true">
          {heading}
        </span>
        {labels.seeAll && (
          <span class="mire-home-view__see-all" aria-hidden="true">
            {labels.seeAll}
          </span>
        )}
      </ds-trigger>
    );
  }

  private renderSection(s: HomeSection, labels: HomeLabels, grid: boolean) {
    if (s.kind === 'bars') return this.renderBars(s.bars, labels);
    const heading = this.renderHeading(s.heading, s.kind === 'sites' ? undefined : s.target, labels);
    if (s.kind === 'sites') return [heading, this.renderSites(s.sites, labels)];
    if (s.kind === 'groups') {
      const cards = s.groups.map((g) => (
        <mire-group-card
          key={JSON.stringify(g.value)}
          class="mire-home-view__group"
          group={g}
          variant={s.variant}
          target="mire-home"
          action="openGroup"
          args={JSON.stringify({ target: s.target })}
          countLabels={this.countLabels}
        />
      ));
      if (grid) return [heading, <div class="mire-home-view__groups">{cards}</div>];
      return [
        heading,
        // Une autre liste de regroupements recrée le ds-scroller (il déplace ses enfants, voir mire-row).
        <ds-scroller
          key={s.groups.map((g) => JSON.stringify(g.value)).join('\n')}
          class="mire-home-view__scroller"
          label={s.heading}
          labels={this.scrollerLabels || undefined}
        >
          {cards}
        </ds-scroller>,
      ];
    }
    // Deux balises : l'action est écrite telle quelle, pour que `npm run check:actions` la vérifie.
    const cards = { elements: s.elements, variant: s.variant, labels: this.cardLabels };
    const resume = s.action === 'resume';
    if (grid)
      return [heading, resume ? <mire-grid {...cards} target="mire-home" action="resume" /> : <mire-grid {...cards} target="mire-home" action="openElement" />];
    const row = { ...cards, key: s.elements.map((e) => e.key).join('\n'), scrollerLabels: this.scrollerLabels };
    return [heading, resume ? <mire-row {...row} target="mire-home" action="resume" /> : <mire-row {...row} target="mire-home" action="openElement" />];
  }

  render() {
    const sections = readList<HomeSection>(this.sections).filter(sectionHasContent);
    const labels = readJson<HomeLabels>(this.labels) ?? {};
    const layout = homeLayout(this.layout);
    const empty = homeIsEmpty(this.clock, sections);
    return (
      <Host class={{ 'mire-home-view': true, [`--layout-${layout}`]: true, [`--size-${this.size}`]: true, '--no-clock': !this.clock }}>
        {this.clock && (
          <div class="mire-home-view__clock">
            <time class="mire-home-view__time" dateTime={this.datetime}>
              {this.time}
            </time>
            <p class="mire-home-view__date">{this.date}</p>
          </div>
        )}
        {sections.map((s) => (
          <section
            key={s.id}
            class={{ 'mire-home-view__section': true, [`--${s.kind}`]: true }}
            data-row={s.id}
            aria-label={s.kind === 'bars' ? undefined : s.heading}
          >
            {this.renderSection(s, labels, layout === 'grid')}
          </section>
        ))}
        {empty && labels.empty && <p class="mire-home-view__empty">{labels.empty}</p>}
        <div class="mire-home-view__foot">
          <ds-trigger class="mire-home-view__customize" mods="stl-2" data-focus-last target="mire-app" action='openSettings:[{"part":"home"}]'>
            {labels.customize}
          </ds-trigger>
        </div>
      </Host>
    );
  }
}
