import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte de l’explorateur (P4-08) : ses méthodes sont les actions du contrôleur `mire-explorer` (ouvrir une branche,
 * montrer un élément, lire, modifier, ajouter à une liste), qui vit avec l’état de l’interface
 * (`src/renderer/controllers/explorer.ts`). Il contient la vue de l’explorateur (`mire-explorer-view`, placée par la page).
 * Une seule balise dans la page, pour que les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-explorer', shadow: false })
export class MireExplorer {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-explorer' } }));
  }

  render() {
    return <Host class="mire-explorer" />;
  }
}
