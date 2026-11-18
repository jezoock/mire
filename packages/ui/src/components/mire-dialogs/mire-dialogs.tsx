import { Component, Element, Host, h } from '@stencil/core';

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

  // Un rendu (vide, sans état : il n'a jamais lieu qu'une fois) donne la classe `hydrated`, que la navigation attend
  // des composants affichés (P4-03b) ; les boîtes placées ensuite par le service ne sont pas touchées.
  render() {
    return <Host class="mire-dialogs" />;
  }
}
