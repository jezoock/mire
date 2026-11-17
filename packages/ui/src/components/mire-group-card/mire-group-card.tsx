import { Component, Element, Host, Prop, h } from '@stencil/core';
import { CARD_RATIOS, cardVariant, groupAction, readJson } from '../../utils/elements.ts';
import { mediaUrl } from '../../utils/media.ts';
import { parsePluralLabels, pluralLabel } from '../../utils/plural.ts';
import type { PageGroup } from '@mire/shared';

/**
 * Carte d'un regroupement d'une page (P4-05) : une série (Friends), une saison, une console. Elle montre le nom, le
 * nombre d'éléments et l'affiche du regroupement ; l'action le désigne par sa valeur dans le niveau
 * (`openGroup:[{"value":"Friends"}]`, `null` pour « Autres »), jamais par son rang.
 */
@Component({ tag: 'mire-group-card', shadow: false })
export class MireGroupCard {
  @Element() host!: HTMLElement;

  /** Regroupement (`value`, `name`, `count`, `poster`) tel que le renvoie `catalog.page`, en propriété ou en JSON. */
  @Prop() group: PageGroup | string | null = null;

  /** `poster` (par défaut), `thumbnail` ou `line`, comme `mire-card`. */
  @Prop({ reflect: true }) variant = 'poster';

  /** Contrôleur visé par l'action (balise d'un `mire-*`). */
  @Prop() target = '';

  /** Méthode du contrôleur appelée avec la valeur du regroupement. */
  @Prop() action = '';

  /** Formes du nombre d'éléments (JSON : `{"one": "{count} élément", "other": "{count} éléments"}`). */
  @Prop() countLabels = '';

  private countText(count: number): string {
    const labels = parsePluralLabels(this.countLabels);
    const lang = this.host.closest('[lang]')?.getAttribute('lang') || 'fr';
    return labels ? pluralLabel(labels, count, lang) : '';
  }

  render() {
    const g = readJson<PageGroup>(this.group);
    if (!g || typeof g.name !== 'string') return <Host class="mire-group-card" />;
    const variant = cardVariant(this.variant);
    const count = this.countText(Number(g.count) || 0);
    const act = this.target && this.action ? { target: this.target, action: groupAction(this.action, g.value ?? null) } : {};
    return (
      <Host class={{ 'mire-group-card': true, [`--${variant}`]: true }}>
        <ds-trigger class="mire-group-card__trigger" label={[g.name, count].filter(Boolean).join(', ')} {...act}>
          <span class="mire-group-card__stack" aria-hidden="true">
            <ds-thumb class="mire-group-card__thumb" src={g.poster ? mediaUrl(g.poster) : ''} ratio={CARD_RATIOS[variant]} label={g.name} decorative />
          </span>
          <span class="mire-group-card__texts" aria-hidden="true">
            <span class="mire-group-card__title">{g.name}</span>
            {count && <span class="mire-group-card__count">{count}</span>}
          </span>
        </ds-trigger>
      </Host>
    );
  }
}
