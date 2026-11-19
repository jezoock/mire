import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte de la vue web (P4-16) : ses méthodes sont les actions du contrôleur `mire-web` (navigation, fermeture, bloqueur,
 * étoile, recherche mémorisée, focus du site), qui vit avec l'état de l'interface (`src/renderer/controllers/web.ts`).
 * Il contient la barre du site (`mire-webbar`) et la place de la vue native (`mire-web-slot`), placées par la page.
 * Une seule balise dans la page, pour que les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-web', shadow: false })
export class MireWeb {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-web' } }));
  }

  render() {
    return <Host class="mire-web" />;
  }
}
