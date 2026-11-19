import { Component, Element, Host, h } from '@stencil/core';

/**
 * Coquille de l'application (P4-07) : le menu (`mire-rail`), l'en-tête (`mire-header`), l'écran affiché, l'aide de la
 * manette (`mire-padbar`) et l'hôte des boîtes de dialogue (`mire-dialogs`). Ses méthodes sont les actions du
 * contrôleur `mire-app` (écrans, menu, réglages de la page, notifications), qui vit avec l'état de l'interface
 * (`src/renderer/controllers/`) ; la page (`src/renderer/shell/`) donne au menu et à l'en-tête leurs entrées et textes.
 *
 * Les écrans pas encore remplacés s'affichent dans un `mire-legacy-view` : `#view` pour les sections, et un second
 * pour les lecteurs, boîtes et messages de l'interface historique. Le lecteur vidéo (`mire-video-player`, P4-14) est
 * caché tant qu'aucune vidéo n'est ouverte. La coquille ne se rend qu'une fois (aucun état) :
 * ce que la page place dans ces hôtes n'est jamais touché.
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
            <div class="backdrop" id="backdrop" aria-hidden="true">
              <div class="bd" />
              <div class="bd" />
            </div>
            <mire-header />
            {/* Vues historiques, en français jusqu'à leur remplacement (docs/adr/0001-dot-stash.md § 9). */}
            <mire-legacy-view class="view" id="view" lang="fr" />
          </main>
        </div>
        <mire-legacy-view class="mire-legacy-view--layers" id="legacy-layers" lang="fr" />
        <mire-video-player id="video-layer" hidden />
        <mire-padbar id="padbar" />
        <mire-dialogs />
      </Host>
    );
  }
}
