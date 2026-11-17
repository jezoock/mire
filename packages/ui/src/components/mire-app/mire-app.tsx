import { Component, Element } from '@stencil/core';

/**
 * Racine de l'interface (P4-04) : ses méthodes sont les actions du contrôleur `mire-app` (écrans, recherche,
 * réglages, notifications), qui vit avec l'état de l'interface (`src/renderer/controllers/`). Elle n'affiche rien
 * pour l'instant ; la coquille (P4-07) y logera le menu, l'en-tête et les écrans.
 */
@Component({ tag: 'mire-app', shadow: false })
export class MireApp {
  @Element() host!: HTMLElement;

  // Le registre des contrôleurs lui donne alors les actions de son contrôleur (convention des mire-* qui en ont un).
  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-app' } }));
  }
}
