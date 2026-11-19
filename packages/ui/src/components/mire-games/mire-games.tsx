import { Component, Element, Host, h } from '@stencil/core';

/**
 * Hôte des jeux (P4-17) : ses méthodes sont les actions du contrôleur `mire-games` (consoles créées à la main,
 * émulateur choisi pour une console ou pour un jeu, sites de jeux, marque-pages « à télécharger », suppression d'un
 * jeu désigné par sa clé), qui vit avec l'état de l'interface (`src/renderer/controllers/games.ts`). Les formulaires
 * sont les boîtes de P4-06 (`mire-form`, dans `mire-dialogs`). Une seule balise dans la page, pour que les
 * `ds-trigger` la trouvent ; sans état, il ne se rend qu'une fois.
 */
@Component({ tag: 'mire-games', shadow: false })
export class MireGames {
  @Element() host!: HTMLElement;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-games' } }));
  }

  render() {
    return <Host class="mire-games" hidden />;
  }
}
