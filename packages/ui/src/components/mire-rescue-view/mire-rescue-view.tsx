import { Component, Host, Prop, h } from '@stencil/core';
import { readJson } from '../../utils/elements.ts';

/** Thème proposé : identifiant, nom traduit, thème choisi. */
export interface RescueTheme {
  id: string;
  name: string;
  current: boolean;
}

/** Textes de la vue, traduits par la page. */
export interface RescueLabels {
  title?: string;
  themes?: string;
  home?: string;
}

const args = (a: Record<string, string>): string => JSON.stringify([a]);

/**
 * Bandeau du mode secours (P4-10), au-dessus de l'explorateur : la raison de son ouverture, le choix d'un autre thème
 * et le retour à l'accueil. Habillage du cœur et palette des réglages (D-16) ; aucun texte écrit ici. Sans message, il
 * n'affiche rien.
 */
@Component({ tag: 'mire-rescue-view', shadow: false })
export class MireRescueView {
  /** Raison de l'ouverture, déjà rédigée. */
  @Prop() message = '';

  /** Le message signale un problème (thème cassé, plantage). */
  @Prop() failure = false;

  /** Thèmes proposés, en propriété ou en JSON. */
  @Prop() themes: RescueTheme[] | string = [];

  @Prop() labels: RescueLabels | string = '';

  render() {
    if (!this.message) return <Host class="mire-rescue-view --empty" hidden />;
    const l = readJson<RescueLabels>(this.labels) ?? {};
    const themes = readJson<RescueTheme[]>(this.themes) ?? [];
    return (
      <Host class={{ 'mire-rescue-view': true, '--failure': this.failure }} role="region" aria-label={l.title}>
        <p class="mire-rescue-view__title">{l.title}</p>
        <p class="mire-rescue-view__message" role={this.failure ? 'alert' : 'status'}>
          {this.message}
        </p>
        <div class="mire-rescue-view__themes" role="group" aria-label={l.themes}>
          <span class="mire-rescue-view__label">{l.themes}</span>
          {themes.map((th) => (
            <ds-trigger
              type="button"
              mods="stl-3,sm"
              class="mire-rescue-view__theme"
              target="mire-rescue"
              action={`chooseTheme:${args({ id: th.id })}`}
              aria-pressed={String(th.current)}
              data-key={th.id}
            >
              {th.name}
            </ds-trigger>
          ))}
          <ds-trigger type="button" mods="stl-1,sm" class="mire-rescue-view__home" target="mire-rescue" action="goHome">
            {l.home}
          </ds-trigger>
        </div>
      </Host>
    );
  }
}
