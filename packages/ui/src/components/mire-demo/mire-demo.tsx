import { Component, Element, Event, Host, Method, Prop, State, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { parsePluralLabels, pluralLabel } from '../../utils/plural.ts';

/**
 * Composant de démonstration de `@mire/ui` (P4-01) : prouve la chaîne Stencil en light DOM, l'habillage compilé
 * avec le moteur dot-stash et l'appel d'une méthode publique par un `ds-trigger`. Ses textes viennent des
 * attributs, fournis par la page à partir des catalogues.
 */
@Component({ tag: 'mire-demo', shadow: false })
export class MireDemo {
  @Element() host!: HTMLElement;

  /** Titre du bloc. */
  @Prop() heading = '';

  /** Texte du bouton qui appelle `increment`. */
  @Prop() actionLabel = '';

  /** Formes du compteur (JSON : `{"one": "{count} clic", "other": "{count} clics"}`). */
  @Prop() countLabels = '';

  /** Texte de la dernière action reçue d'une carte (`{key}` : sa clé, ou la valeur d'un regroupement). */
  @Prop() pickedLabel = '';

  @State() count = 0;

  @State() picked = '';

  /** Émis à chaque changement du compteur, avec sa nouvelle valeur. */
  @Event({ eventName: 'mireDemoChange' }) changed!: EventEmitter<{ count: number }>;

  /** Ajoute `step` au compteur ; méthode publique, appelée par `ds-trigger` (`action='increment:[1]'`). */
  @Method()
  async increment(step = 1): Promise<number> {
    this.count += step;
    this.changed.emit({ count: this.count });
    return this.count;
  }

  /** Émis quand une carte de la démonstration appelle `pick`, avec ce qui la désigne (clé ou valeur). */
  @Event({ eventName: 'mireDemoPick' }) pickEvent!: EventEmitter<{ key?: string; value?: unknown }>;

  /**
   * Action des cartes de la démonstration (P4-05) : `pick:[{"key":"…"}]` pour un élément, `pick:[{"value":…}]` pour
   * un regroupement. Montre ce qui a été reçu, pour vérifier à la main qu'une carte désigne l'élément par sa clé.
   */
  @Method()
  async pick(arg: { key?: string; value?: unknown } = {}): Promise<void> {
    this.picked = arg.key ?? JSON.stringify(arg.value ?? null);
    this.pickEvent.emit(arg);
  }

  /** Émis quand un bouton de la démonstration des boîtes (P4-06) demande une boîte : `form`, `confirm`, `pick`… */
  @Event({ eventName: 'mireDemoDialog' }) dialogEvent!: EventEmitter<{ kind: string }>;

  /**
   * Action des boutons de la démonstration des boîtes de dialogue (P4-06) : `openDialog:[{"kind":"form"}]`. La page
   * ouvre la boîte demandée (service des boîtes) ; le composant n'importe rien de l'interface.
   */
  @Method()
  async openDialog(arg: { kind?: string } = {}): Promise<void> {
    if (arg.kind) this.dialogEvent.emit({ kind: arg.kind });
  }

  private countText(): string {
    const labels = parsePluralLabels(this.countLabels);
    const lang = this.host.closest('[lang]')?.getAttribute('lang') || 'fr';
    return labels ? pluralLabel(labels, this.count, lang) : String(this.count);
  }

  render() {
    return (
      <Host class="mire-demo">
        <p class="mire-demo__heading">{this.heading}</p>
        <p class="mire-demo__count" role="status">
          {this.countText()}
        </p>
        <ds-trigger class="mire-demo__action" type="button" mods="stl-1" target="mire-demo" action="increment:[1]">
          {this.actionLabel}
        </ds-trigger>
        {this.picked && this.pickedLabel && (
          <p class="mire-demo__picked" role="status">
            {this.pickedLabel.replaceAll('{key}', this.picked)}
          </p>
        )}
      </Host>
    );
  }
}
