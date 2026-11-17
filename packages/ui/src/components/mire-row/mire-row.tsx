import { Component, Host, Prop, h } from '@stencil/core';
import { readList, readRecord } from '../../utils/elements.ts';
import type { CardElement } from '../../utils/elements.ts';

/**
 * Rangée défilante d'éléments (P4-05) : un titre et des `mire-card` dans un `ds-scroller` horizontal. Les flèches et
 * la manette passent d'une carte à l'autre par le service de navigation ; la rangée montre la carte qui reçoit le
 * focus. Cartes et actions comme `mire-card` (clé de l'élément).
 */
@Component({ tag: 'mire-row', shadow: false })
export class MireRow {
  /** Titre de la rangée (et nom de la région pour les lecteurs d'écran). */
  @Prop() heading = '';

  /** Éléments du catalogue, en propriété ou en JSON. */
  @Prop() elements: CardElement[] | string = [];

  /** Variante des cartes : `poster` (par défaut), `thumbnail` ou `line`. */
  @Prop() variant = 'poster';

  /** Contrôleur visé et méthode appelée avec la clé de l'élément (voir `mire-card`). */
  @Prop() target = '';
  @Prop() action = '';

  /** Avancement de la reprise par clé d'élément (JSON : `{"local:/a.mkv": 0.4}`). */
  @Prop() progress: Record<string, number> | string = '';

  /** Info en sous-titre des cartes ; textes des cartes (JSON, voir `mire-card`). */
  @Prop() subtitleInfo = '';
  @Prop() labels = '';

  /** Boutons « précédent » et « suivant » du `ds-scroller`, et leurs noms (JSON : `previous`, `next`). */
  @Prop() controls = false;
  @Prop() scrollerLabels = '';

  render() {
    const elements = readList<CardElement>(this.elements);
    const progress = readRecord<number>(this.progress);
    return (
      <Host class="mire-row">
        {this.heading && (
          <p class="mire-row__heading" aria-hidden="true">
            {this.heading}
          </p>
        )}
        {/* Le ds-scroller déplace ses enfants dans sa zone de défilement (autre moteur Stencil) : une autre liste
            d'éléments le recrée plutôt que de modifier des enfants qu'il a déplacés. */}
        <ds-scroller key={elements.map((el) => el.key).join('\n')} class="mire-row__scroller" label={this.heading} controls={this.controls} labels={this.scrollerLabels || undefined}>
          {elements.map((el, i) => (
            <mire-card
              key={el.key}
              class="mire-row__card"
              element={el}
              variant={this.variant}
              target={this.target}
              action={this.action}
              progress={progress[el.key] ?? null}
              subtitleInfo={this.subtitleInfo}
              labels={this.labels}
              eager={i < 8}
            />
          ))}
        </ds-scroller>
      </Host>
    );
  }
}

