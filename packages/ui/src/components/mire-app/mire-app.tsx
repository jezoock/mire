import { Component, Element, Host, h } from '@stencil/core';

/**
 * Coquille de l'application (P4-07) : le menu (`mire-rail`), l'en-tête (`mire-header`), l'écran affiché, l'aide de la
 * manette (`mire-padbar`) et l'hôte des boîtes de dialogue (`mire-dialogs`). Ses méthodes sont les actions du
 * contrôleur `mire-app` (écrans, menu, réglages de la page, notifications), qui vit avec l'état de l'interface
 * (`src/renderer/controllers/`) ; la page (`src/renderer/shell/`) donne au menu et à l'en-tête leurs entrées et textes.
 *
 * Les écrans s'affichent dans `#view`, où la page place l'hôte de l'écran affiché. Les lecteurs (`mire-video-player`,
 * P4-14 ; `mire-mini-player` et `mire-image-viewer`, P4-15) sont cachés tant que rien n'est lu ; le message bref
 * (`#toast`, celui qui a un bouton d'action) et la zone de dépôt des fichiers (`#drop`) reçoivent leur texte de la
 * page. La coquille ne se rend qu'une fois (aucun état) : ce que la page place dans ces éléments n'est jamais touché.
 */
@Component({ tag: 'mire-app', shadow: false })
export class MireApp {
  @Element() host!: HTMLElement;

  // Le registre des contrôleurs lui donne alors les actions de son contrôleur (convention des mire-* qui en ont un).
  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-app' } }));
  }

  render() {
    return (
      <Host class="mire-app">
        <div class="app">
          <mire-rail />
          <main class="main">
            <mire-header />
            <div class="view" id="view" />
          </main>
        </div>
        <div class="toast" id="toast" role="status" aria-live="polite" />
        <div class="drop" id="drop" hidden>
          <span class="drop__text" />
        </div>
        <mire-video-player id="video-layer" hidden />
        <mire-mini-player id="mini" hidden />
        <mire-image-viewer id="image-layer" hidden />
        <mire-padbar id="padbar" />
        <mire-dialogs />
      </Host>
    );
  }
}
