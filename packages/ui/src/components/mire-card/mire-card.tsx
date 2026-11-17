import { Component, Host, Prop, h } from '@stencil/core';
import { CARD_RATIOS, cardImage, cardTexts, cardVariant, keyAction, progressPercent, readJson } from '../../utils/elements.ts';
import type { CardElement, CardLabels } from '../../utils/elements.ts';

/**
 * Carte d'un élément du catalogue (P4-05) : un `ds-trigger` autour d'un `ds-thumb`, avec titre, sous-titre, badge et
 * jauge de reprise. Variantes : affiche, vignette, ligne. L'action désigne l'élément par sa clé
 * (`target="mire-page" action="open"` donne `open:[{"key":"…"}]`). Ses textes viennent de l'élément et des attributs.
 */
@Component({ tag: 'mire-card', shadow: false })
export class MireCard {
  /** Élément du catalogue (`key`, `name`, `images`, `infos`, `tags`), en propriété ou en JSON. */
  @Prop() element: CardElement | string | null = null;

  /** `poster` (affiche, par défaut), `thumbnail` (vignette 16/9) ou `line` (ligne). */
  @Prop({ reflect: true }) variant = 'poster';

  /** Contrôleur visé par l'action (balise d'un `mire-*`). */
  @Prop() target = '';

  /** Méthode du contrôleur appelée avec la clé de l'élément (`open` → `open:[{"key":"…"}]`). */
  @Prop() action = '';

  /** Badge donné par la page (« Nouveau », « 4K ») ; sans lui, « Indisponible » pour un élément disparu. */
  @Prop() badge = '';

  /** Avancement de la reprise, entre 0 et 1 (la jauge ne s'affiche qu'entre les deux). */
  @Prop() progress: number | string | null = null;

  /** Info affichée en sous-titre (`year`, `genres`…) ; sans elle : épisode, année ou artiste. */
  @Prop() subtitleInfo = '';

  /** Textes tirés des catalogues (JSON) : `episode`, `progress`, `unavailable` (voir `CardLabels`). */
  @Prop() labels: CardLabels | string = '';

  /** Image chargée tout de suite (cartes du haut de la page) plutôt qu'à l'approche de l'écran. */
  @Prop() eager = false;

  render() {
    const el = readJson<CardElement>(this.element);
    if (!el || typeof el.key !== 'string') return <Host class="mire-card" />;
    const variant = cardVariant(this.variant);
    const t = cardTexts(el, readJson<CardLabels>(this.labels) ?? {}, { badge: this.badge, progress: this.progress, subtitleInfo: this.subtitleInfo });
    const act = this.target && this.action ? { target: this.target, action: keyAction(this.action, el.key) } : {};
    return (
      <Host class={{ 'mire-card': true, [`--${variant}`]: true, '--unavailable': !!el.unavailable }}>
        <ds-trigger class="mire-card__trigger" label={t.label} data-key={el.key} {...act}>
          <ds-thumb
            class="mire-card__thumb"
            src={cardImage(el, variant)}
            ratio={CARD_RATIOS[variant]}
            label={t.title}
            loading={this.eager ? 'eager' : 'lazy'}
            decorative
          />
          <span class="mire-card__texts" aria-hidden="true">
            <span class="mire-card__title">{t.title}</span>
            {t.subtitle && <span class="mire-card__subtitle">{t.subtitle}</span>}
          </span>
          {t.badge && (
            <span class="mire-card__badge" aria-hidden="true">
              {t.badge}
            </span>
          )}
          {t.progress !== null && (
            <span class="mire-card__progress" aria-hidden="true">
              <span class="mire-card__progress-bar" style={{ width: `${progressPercent(t.progress)}%` }} />
            </span>
          )}
        </ds-trigger>
      </Host>
    );
  }
}
