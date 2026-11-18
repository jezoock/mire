import { Component, Host, h } from '@stencil/core';

/**
 * Hôte d'une vue historique non encore remplacée (P4-07) : la vue des sections (`#view`, remplie par `app.js`), les
 * lecteurs, les boîtes et les messages de l'interface historique. Le composant ne rend rien lui-même et ne se rend
 * qu'une fois : le contenu que la page y place n'est jamais touché. Il disparaîtra avec la dernière vue historique
 * (P4-24).
 */
@Component({ tag: 'mire-legacy-view', shadow: false })
export class MireLegacyView {
  // Un rendu (vide) donne la classe `hydrated`, que la navigation attend des composants affichés (P4-03b).
  render() {
    return <Host class="mire-legacy-view" />;
  }
}
