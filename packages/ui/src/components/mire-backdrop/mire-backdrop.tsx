import { Component, Host, Prop, State, Watch, h } from '@stencil/core';
import { BACKDROP_EMPTY, backdropLoaded, backdropRequest, readJson } from '../../utils/elements.ts';
import type { BackdropState, CardElement } from '../../utils/elements.ts';
import { mediaUrl } from '../../utils/media.ts';

/**
 * Fond de page en fondu (P4-05) : l'image de fond de l'élément sélectionné. Deux calques : la nouvelle image se charge
 * derrière, puis passe devant en fondu (aucun fondu si l'utilisateur réduit les animations). Décoratif : rien n'est
 * lu par les lecteurs d'écran.
 */
@Component({ tag: 'mire-backdrop', shadow: false })
export class MireBackdrop {
  /** Image (chemin local ou adresse) ; prioritaire sur `element`. */
  @Prop() src = '';

  /** Élément du catalogue : son fond, sinon son affiche. */
  @Prop() element: CardElement | string | null = null;

  @State() state: BackdropState = BACKDROP_EMPTY;

  private wanted(): string {
    const el = readJson<CardElement>(this.element);
    const path = this.src || el?.images?.background || el?.images?.poster || '';
    return path ? mediaUrl(path) : '';
  }

  @Watch('src')
  @Watch('element')
  update() {
    this.state = backdropRequest(this.state, this.wanted());
  }

  componentWillLoad() {
    this.update();
  }

  private loaded(layer: 0 | 1, e: Event) {
    this.state = backdropLoaded(this.state, layer, (e.target as HTMLImageElement).getAttribute('src') ?? '');
  }

  render() {
    const { layers, front } = this.state;
    return (
      <Host class={{ 'mire-backdrop': true, '--empty': front === -1 }} aria-hidden="true">
        {([0, 1] as const).map((i) =>
          layers[i] ? <img key={i} class={{ 'mire-backdrop__layer': true, '--front': front === i }} src={layers[i]} alt="" decoding="async" onLoad={(e) => this.loaded(i, e)} /> : null,
        )}
      </Host>
    );
  }
}
