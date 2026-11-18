import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte de la Recherche (P4-13) : ses méthodes sont les actions du contrôleur `mire-search` (recherches récentes,
 * ouvrir un résultat, sa page, un titre de « Où regarder », chercher sur un site), qui vit avec l'état de l'interface
 * (`src/renderer/controllers/search.ts`). Il contient la vue de la Recherche (`mire-search-view`, placée par la page).
 * Une seule balise dans la page, pour que les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-search', shadow: false })
export class MireSearch {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-search' } }));
  }

  render() {
    return <Host class="mire-search" />;
  }
}
