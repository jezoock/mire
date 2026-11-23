import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte de l'assistant du premier lancement (P4-23) : ses méthodes sont les actions du contrôleur `mire-assistant`
 * (étapes, choix, installation), qui vit avec l'état de l'interface (`src/renderer/controllers/assistant.ts`). Il contient
 * sa vue (`mire-assistant-view`). Une seule balise dans la page.
 */
@Component({ tag: 'mire-assistant', shadow: false })
export class MireAssistant {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-assistant' } }));
  }

  render() {
    return <Host class="mire-assistant" />;
  }
}
