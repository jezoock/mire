import { Component, Element, Event, Host, Prop, Watch, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readRecord } from '../../utils/elements.ts';
import type { ImageViewerIcons, ImageViewerLabels } from '../../utils/music.ts';

/**
 * Visionneuse d'images plein écran (P4-15) : l'image, son titre et sa place dans la liste, les flèches, le diaporama.
 * Hôte du contrôleur `mire-image-viewer` : ses boutons sont des `ds-trigger` vers ses actions (fermer, image précédente
 * ou suivante, diaporama).
 *
 * Il n'a ni état ni accès au processus principal : la page (`src/renderer/players/images.ts`) tient la liste, la minuterie
 * du diaporama et les touches, et lui donne ce qu'il affiche. Il précharge l'image que la page lui désigne (`preload`),
 * pour que l'image suivante s'affiche sans attente, et signale une image illisible (`mireImageError`).
 */
@Component({ tag: 'mire-image-viewer', shadow: false })
export class MireImageViewer {
  @Element() host!: HTMLElement;

  /** Titre (nom du fichier) et sous-titre (place dans la liste, dossier). */
  @Prop() heading = '';
  @Prop() subheading = '';

  /** Adresse de l'image affichée ; vide : aucune. */
  @Prop() src = '';

  /** Adresse de l'image à précharger (la suivante) ; vide : aucune. */
  @Prop() preload = '';

  /** Le diaporama tourne (le bouton montre « pause » et le libellé pour l'arrêter). */
  @Prop() slideshow = false;

  /** Rien n'a bougé depuis un moment : l'affichage et le pointeur se cachent. */
  @Prop({ reflect: true }) idle = false;

  /** Textes (voir `ImageViewerLabels`) et icônes, en JSON ou en objets. */
  @Prop() labels: ImageViewerLabels | string = '';
  @Prop() icons: ImageViewerIcons | string = '';

  /** L'image affichée ne peut pas être lue. */
  @Event() mireImageError!: EventEmitter<{ src: string }>;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-image-viewer' } }));
  }

  @Watch('preload')
  preloadNext() {
    if (this.preload) new Image().src = this.preload;
  }

  private onError = () => {
    if (this.src) this.mireImageError.emit({ src: this.src });
  };

  private trigger(action: string, child: unknown, extra = '') {
    return (
      <ds-trigger class={`mire-image-viewer__trigger ${extra}`.trim()} target="mire-image-viewer" action={action}>
        {child}
      </ds-trigger>
    );
  }

  render() {
    const l = readJson<ImageViewerLabels>(this.labels) ?? ({} as ImageViewerLabels);
    const icons = readRecord<string>(this.icons as Record<string, string> | string) as ImageViewerIcons;
    return (
      <Host class="mire-image-viewer" tabindex="-1">
        <img class="mire-image-viewer__img" alt="" src={this.src || undefined} onError={this.onError} />
        <div class="mire-image-viewer__ui">
          <div class="mire-image-viewer__top">
            {this.trigger('close', <button type="button" class="mire-image-viewer__icon" aria-label={l.close} innerHTML={icons.close ?? ''} />)}
            <div class="mire-image-viewer__heading">
              <div class="mire-image-viewer__title">{this.heading}</div>
              <div class="mire-image-viewer__sub">{this.subheading}</div>
            </div>
            {this.trigger(
              'toggleSlideshow',
              <button type="button" class="mire-image-viewer__text-btn">
                <span class="mire-image-viewer__text-icon" aria-hidden="true" innerHTML={(this.slideshow ? icons.pause : icons.play) ?? ''} />
                <span>{this.slideshow ? l.slideshowStop : l.slideshow}</span>
              </button>,
            )}
          </div>
          {this.trigger(
            'previous',
            <button type="button" class="mire-image-viewer__nav mire-image-viewer__nav--prev" aria-label={l.prev} innerHTML={icons.chevL ?? ''} />,
          )}
          {this.trigger(
            'next',
            <button type="button" class="mire-image-viewer__nav mire-image-viewer__nav--next" aria-label={l.next} innerHTML={icons.chevR ?? ''} />,
          )}
        </div>
      </Host>
    );
  }
}
