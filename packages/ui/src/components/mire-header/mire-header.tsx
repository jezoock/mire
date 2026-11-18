import { Component, Host, Prop, h } from '@stencil/core';

/**
 * En-tête de l'écran (P4-07) : titre, outils de l'écran, recherche dans l'écran, rouage (réglages de la page, vers le
 * contrôleur `mire-app`) et horloge. Les outils (`#header-tools`, `#header-tools-right`) sont remplis par la vue
 * affichée ; le champ de recherche garde sa saisie (la vue la lit). Textes et heure viennent de la page.
 */
@Component({ tag: 'mire-header', shadow: false })
export class MireHeader {
  /** Titre de l'écran. */
  @Prop() heading = '';

  /** Recherche dans l'écran : affichée ou non, texte indicatif et nom. */
  @Prop() searchable = false;
  @Prop() searchPlaceholder = '';
  @Prop() searchLabel = '';

  /** Rouage : nom, bulle (état de la récupération des infos), occupé, caché (écran Réglages). */
  @Prop() gearLabel = '';
  @Prop() gearTitle = '';
  @Prop() gearBusy = false;
  @Prop() gearHidden = false;

  /** Icône du rouage (SVG de l'interface), fournie par la page. */
  @Prop() gearIcon = '';

  /** Heure affichée (`20:45`) et sa valeur machine (`datetime`). */
  @Prop() time = '';
  @Prop() datetime = '';

  render() {
    return (
      <Host class="mire-header topbar">
        <h1 id="title">{this.heading}</h1>
        <div class="header-tools" id="header-tools" key="tools" />
        <input
          class="search focusable"
          id="search"
          type="search"
          key="search"
          hidden={!this.searchable}
          placeholder={this.searchPlaceholder}
          aria-label={this.searchLabel}
        />
        <div class="header-tools" id="header-tools-right" key="tools-right" />
        <ds-trigger class="mire-header__gear" target="mire-app" action="openPageSettings">
          <button
            type="button"
            class={{ 'icon-btn': true, gear: true, focusable: true, 'is-busy': this.gearBusy }}
            id="page-gear"
            aria-label={this.gearLabel}
            title={this.gearTitle || this.gearLabel}
            hidden={this.gearHidden}
            innerHTML={this.gearIcon}
          />
        </ds-trigger>
        <time class="clock" id="clock" dateTime={this.datetime}>
          {this.time}
        </time>
      </Host>
    );
  }
}
