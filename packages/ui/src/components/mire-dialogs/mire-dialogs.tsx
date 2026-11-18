import { Component, Element } from '@stencil/core';

/**
 * Hôte des boîtes de dialogue et des notifications (P4-06) : le service des boîtes (`src/renderer/ui/dialogs.ts`) y
 * place les `mire-form` et `mire-pick` ouverts et le `ds-toaster`. Ses méthodes sont les actions du contrôleur
 * `mire-dialogs` (boutons des boîtes, `act`), qui vit avec le service ; une seule balise dans la page, pour que les
 * `ds-trigger` de toutes les boîtes la trouvent. Elle n'affiche rien elle-même.
 */
@Component({ tag: 'mire-dialogs', shadow: false })
export class MireDialogs {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-dialogs' } }));
  }
}
