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

  @State() count = 0;

  /** Émis à chaque changement du compteur, avec sa nouvelle valeur. */
  @Event({ eventName: 'mireDemoChange' }) changed!: EventEmitter<{ count: number }>;

  /** Ajoute `step` au compteur ; méthode publique, appelée par `ds-trigger` (`action='increment:[1]'`). */
  @Method()
  async increment(step = 1): Promise<number> {
    this.count += step;
    this.changed.emit({ count: this.count });
    return this.count;
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
      </Host>
    );
  }
}
