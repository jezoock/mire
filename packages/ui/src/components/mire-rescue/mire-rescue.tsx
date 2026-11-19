import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte du mode secours (P4-10) : ses méthodes sont les actions du contrôleur `mire-rescue` (choisir un autre thème,
 * aller à l'accueil), qui vit avec l'état de l'interface (`src/renderer/controllers/rescue.ts`). Il contient la vue
 * du mode secours (`mire-rescue-view`, placée par la page, au-dessus de l'explorateur). Une seule balise dans la page.
 */
@Component({ tag: 'mire-rescue', shadow: false })
export class MireRescue {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-rescue' } }));
  }

  render() {
    return <Host class="mire-rescue" />;
  }
}
