import { Component, Host, Prop, h } from '@stencil/core';
import { cardSubtitle, infoText, readJson } from '../../utils/elements.ts';
import type { CardElement, CardLabels } from '../../utils/elements.ts';
import { mediaUrl } from '../../utils/media.ts';

/**
 * Infos de l'élément sélectionné (P4-05) : logo ou titre, une ligne d'infos (année, genres, durée…), et le résumé.
 * La page lui donne l'élément qui a le focus ; il n'affiche rien sans élément. Les infos montrées et leur ordre
 * viennent de l'attribut `infos` ; aucun texte n'est écrit dans le composant.
 */
@Component({ tag: 'mire-focus-info', shadow: false })
export class MireFocusInfo {
  /** Élément du catalogue, en propriété ou en JSON. */
  @Prop() element: CardElement | string | null = null;

  /** Infos de la ligne, dans l'ordre, séparées par des virgules (`year,genres,duration`). */
  @Prop() infos = 'year,genres';

  /** Info qui donne le résumé. */
  @Prop() summaryInfo = 'summary';

  /** Textes des cartes (JSON, voir `mire-card`) : l'épisode d'une série s'affiche en tête de la ligne d'infos. */
  @Prop() labels: CardLabels | string = '';

  render() {
    const el = readJson<CardElement>(this.element);
    if (!el || typeof el.name !== 'string') return <Host class="mire-focus-info --empty" />;
    const infos = el.infos ?? {};
    const episode = typeof infos.season === 'number' ? cardSubtitle(el, readJson<CardLabels>(this.labels) ?? {}) : '';
    const meta = [
      episode,
      ...this.infos
        .split(',')
        .map((id) => infoText(infos[id.trim()]))
        .filter(Boolean),
    ].filter(Boolean);
    const summary = infoText(infos[this.summaryInfo]);
    const logo = el.images?.logo;
    return (
      <Host class="mire-focus-info">
        {logo ? <img class="mire-focus-info__logo" src={mediaUrl(logo)} alt={el.name} decoding="async" /> : <p class="mire-focus-info__title">{el.name}</p>}
        {meta.length > 0 && (
          <p class="mire-focus-info__meta">
            {meta.map((text) => (
              <span class="mire-focus-info__info">{text}</span>
            ))}
          </p>
        )}
        {summary && <p class="mire-focus-info__summary">{summary}</p>}
      </Host>
    );
  }
}
