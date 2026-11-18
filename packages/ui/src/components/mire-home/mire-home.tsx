import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte de l'accueil (P4-12) : ses méthodes sont les actions du contrôleur `mire-home` (ouvrir une cible, un
 * regroupement, un élément, un site épinglé ; reprendre), qui vit avec l'état de l'interface
 * (`src/renderer/controllers/`). Il contient la vue de l'accueil (`mire-home-view`, placée par la page) et porte le
 * thème, comme `mire-page` (palette, polices, fond : moteur de thèmes, `src/renderer/themes/`). Une seule balise dans
 * la page, pour que les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-home', shadow: false })
export class MireHome {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-home' } }));
  }

  render() {
    return <Host class="mire-home" />;
  }
}
