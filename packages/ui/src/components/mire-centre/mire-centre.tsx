import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte du Centre (P4-18) : ses méthodes sont les actions du contrôleur `mire-centre` (téléchargements, apps, BIOS),
 * qui vit avec l'état de l'interface (`src/renderer/controllers/centre.ts`). Il contient la vue du Centre
 * (`mire-centre-view`, placée par la page). Une seule balise dans la page, pour que les `ds-trigger` la trouvent ; sans
 * état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-centre', shadow: false })
export class MireCentre {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-centre' } }));
  }

  render() {
    return <Host class="mire-centre" />;
  }
}
