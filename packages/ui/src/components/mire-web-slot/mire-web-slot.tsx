import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import type { Box } from '../../utils/web.ts';

/**
 * Place réservée à la page d'un site (P4-16) : Electron pose la vue native du site par-dessus. À chaque changement de
 * taille (`ResizeObserver`), la zone occupée part en événement (`mireWebSlotResize`) ; la page en déduit la position de
 * la vue native (`slotBounds`) et la transmet au processus principal, qui la contrôle. Le texte de chargement se voit
 * tant que la vue native n'est pas posée.
 */
@Component({ tag: 'mire-web-slot', shadow: false })
export class MireWebSlot {
  @Element() host!: HTMLElement;

  /** Texte affiché sous la vue native (« Chargement de Netflix… »). */
  @Prop() loadingLabel = '';

  @Event() mireWebSlotResize!: EventEmitter<Box>;

  private observer?: ResizeObserver;

  connectedCallback() {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(() => this.mireWebSlotResize.emit(this.box()));
    this.observer.observe(this.host);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** Zone occupée, en pixels de la fenêtre. */
  private box(): Box {
    const r = this.host.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  render() {
    return (
      <Host class="mire-web-slot">
        <span class="mire-web-slot__text" role="status">
          {this.loadingLabel}
        </span>
      </Host>
    );
  }
}
