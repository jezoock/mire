import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte des pages (P4-11) : ses méthodes sont les actions du contrôleur `mire-page` (ouvrir un regroupement, une étape
 * du chemin, un élément ; tranche suivante), qui vit avec l'état de l'interface (`src/renderer/controllers/`). Il
 * contient la vue de page (`mire-page-view`, placée par la page) et porte le thème des pages (palette, polices, fond :
 * moteur de thèmes, `src/renderer/themes/`). Une seule balise dans la page, pour que les `ds-trigger` la trouvent ;
 * sans état, il ne se rend qu'une fois : ce que la page y place n'est jamais touché.
 */
@Component({ tag: 'mire-page', shadow: false })
export class MirePage {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-page' } }));
  }

  render() {
    return <Host class="mire-page" />;
  }
}
