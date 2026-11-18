import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte des éditeurs (P4-22) : ses méthodes sont les actions du contrôleur `mire-editor` (modifier un élément désigné
 * par sa clé, ou celui qui a le focus), qui vit avec l'état de l'interface (`src/renderer/controllers/editor.ts`). Les
 * formulaires eux-mêmes sont les boîtes de P4-06 (`mire-form`, `mire-pick`, dans `mire-dialogs`). Une seule balise
 * dans la page, pour que les `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-editor', shadow: false })
export class MireEditor {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-editor' } }));
  }

  render() {
    return <Host class="mire-editor" hidden />;
  }
}
