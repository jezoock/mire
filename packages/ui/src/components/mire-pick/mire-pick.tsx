import { Component, Element, Event, Host, Method, Prop, State, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson } from '../../utils/elements.ts';
import { nextCandidateImage } from '../../utils/forms.ts';
import type { Candidate, FormLabels } from '../../utils/forms.ts';
import type { DialogEventDetail } from '../mire-form/mire-form.tsx';

type ModalElement = HTMLElement & { shown: boolean; componentOnReady?: () => Promise<unknown> };

/**
 * Choisir la bonne fiche parmi celles trouvées en ligne (P4-06), équivalent de `pickCandidate` de l'interface
 * historique : une carte par fiche (image, titre, année), l'image de secours essayée si la première ne se charge pas,
 * puis l'initiale du titre (`ds-thumb`). Chaque carte appelle l'action `act` du contrôleur `mire-dialogs` avec la clé
 * de la fiche ; fermée sans choix (Échap, B, « Annuler »), la boîte émet `mireDialogClose`.
 */
@Component({ tag: 'mire-pick', shadow: false })
export class MirePick {
  @Element() host!: HTMLElement;

  @Prop() dialog = '';

  @Prop() heading = '';

  @Prop() help = '';

  /** Fiches complétées (`normalizeCandidates`). */
  @Prop() candidates: Candidate[] | string = [];

  /** Textes tirés des catalogues : `cancel`. */
  @Prop() labels: FormLabels | string = {};

  @State() shown = false;

  /** Image affichée de chaque fiche, quand elle n'est plus la première (secours, ou aucune). */
  @State() images: Record<string, string> = {};

  @Event({ eventName: 'mireDialogOpen' }) opened!: EventEmitter<DialogEventDetail>;
  @Event({ eventName: 'mireDialogClose' }) closed!: EventEmitter<DialogEventDetail>;

  private modal?: ModalElement;

  async componentDidLoad() {
    // Phase de capture : ds-modal arrête la propagation d'Échap avant qu'elle ne remonte jusqu'ici.
    this.host.addEventListener('keydown', this.onKeyDown, true);
    await customElements.whenDefined('ds-modal');
    await this.modal?.componentOnReady?.();
    if (this.host.isConnected) this.shown = true;
  }

  @Method()
  async close(): Promise<void> {
    this.shown = false;
  }

  private own = (e: Event) => (e.target as Element).closest('ds-modal') === this.modal;

  private onModalOpen = (e: Event) => {
    if (this.own(e)) this.opened.emit({ dialog: this.dialog });
  };

  private onModalClose = (e: Event) => {
    if (!this.own(e)) return;
    this.shown = false;
    this.closed.emit({ dialog: this.dialog });
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Esc') e.preventDefault();
  };

  // Une image qui ne se charge pas (l'événement ne remonte pas : phase de capture) : la vignette de secours, puis rien.
  private onImageError = (e: Event) => {
    const img = e.target as HTMLImageElement;
    const key = img.closest?.('[data-key]')?.getAttribute('data-key');
    const c = (readJson<Candidate[]>(this.candidates) ?? []).find((x) => x.key === key);
    if (!c) return;
    const failed = this.images[c.key] ?? c.image;
    this.images = { ...this.images, [c.key]: nextCandidateImage(c, failed) };
  };

  render() {
    const labels = readJson<FormLabels>(this.labels) ?? {};
    const candidates = readJson<Candidate[]>(this.candidates) ?? [];
    const arg = (args: Record<string, string>) => JSON.stringify([{ dialog: this.dialog, ...args }]);
    return (
      <Host class="mire-pick" onErrorCapture={this.onImageError}>
        <ds-modal ref={(el) => (this.modal = el as ModalElement)} shown={this.shown} onModalOpen={this.onModalOpen} onModalClose={this.onModalClose}>
          <h2 slot="title" class="mire-pick__title">
            {this.heading}
          </h2>
          {this.help && (
            <p slot="description" class="mire-pick__help">
              {this.help}
            </p>
          )}
          <div class="mire-pick__grid">
            {candidates.map((c) => (
              <ds-trigger
                class="mire-pick__card"
                key={c.key}
                data-key={c.key}
                label={[c.title, c.sub].filter(Boolean).join(', ')}
                target="mire-dialogs"
                action={`act:${arg({ action: 'pick', value: c.key })}`}
              >
                <ds-thumb class="mire-pick__thumb" src={this.images[c.key] ?? c.image} ratio="2/3" label={c.title} decorative />
                <span class="mire-pick__name" aria-hidden="true">
                  {c.title}
                </span>
                {c.sub && (
                  <span class="mire-pick__sub" aria-hidden="true">
                    {c.sub}
                  </span>
                )}
              </ds-trigger>
            ))}
          </div>
          <div class="mire-pick__actions">
            <ds-trigger type="button" mods="stl-3" target="mire-dialogs" action={`act:${arg({ action: 'cancel' })}`}>
              {labels.cancel}
            </ds-trigger>
          </div>
        </ds-modal>
      </Host>
    );
  }
}
