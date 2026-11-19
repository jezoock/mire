import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte des Réglages (P4-20) : ses méthodes sont les actions du contrôleur `mire-settings` (palette, thème des pages,
 * listes, chemins, plugins, configuration…), qui vit avec l'état de l'interface (`src/renderer/controllers/settings.ts`).
 * Il contient la vue des Réglages (`mire-settings-view`, placée par la page). Une seule balise dans la page, pour que
 * les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-settings', shadow: false })
export class MireSettings {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-settings' } }));
  }

  render() {
    return <Host class="mire-settings" />;
  }
}
