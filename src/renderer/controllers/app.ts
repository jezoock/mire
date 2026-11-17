import { Controller } from './base.ts';
import type { ItemRef } from './types.ts';

/** `mire-app` : écrans, menu, réglages de la page, édition de l'élément sélectionné, notifications. */
export class AppController extends Controller {
  /** Affiche un écran (`home`, `videos`, `settings`…) ; le focus va au contenu, sauf `focus: 'keep'`. */
  go({ section, focus = 'content' }: { section: string; focus?: string }): void {
    this.ctx.ui.go(section, { focus });
  }

  /** Retour : ferme la console ouverte, quitte le site affiché, sinon revient à l'accueil. */
  back(): void {
    this.ctx.ui.back();
  }

  /** Écran suivant (`step: 1`) ou précédent (`-1`), depuis la manette ; depuis un site, on part de sa page d'origine. */
  cycleSection({ step }: { step: number }): void {
    const { S, ui } = this.ctx;
    const next = ui.nextSection(S.section === 'web' ? ui.webHome() : S.section, step);
    ui.go(next, { focus: next === 'search' ? 'keep' : 'content' });
  }

  openFile(): void {
    this.ctx.ui.openFileDialog();
  }

  quit(): void {
    this.ctx.api.quit();
  }

  /** « Afficher plus » : rend la position du premier élément ajouté. */
  showMore(): number {
    const { S, ui, page } = this.ctx;
    const first = S.limit;
    S.limit += page;
    ui.render();
    return first;
  }

  /** Réglages de la page affichée (le rouage), sur un onglet (`store`, `pc`…) ou le dernier ouvert. */
  openPageSettings({ tab }: { tab?: string } = {}): void {
    this.ctx.ui.openPageSettings(tab);
  }

  /** Écran Réglages, ouvert sur une partie (`sources`, `home`). */
  openSettings({ part }: { part: string }): void {
    this.ctx.ui.revealSettings(`set-${part}`);
  }

  /** Modifie les infos de l'élément décrit en haut de la vue (sinon le premier de la vue). */
  editInfo(): void {
    const { S, ui } = this.ctx;
    ui.editRef((S.focusRef as ItemRef | null) || ui.firstItemRef());
  }

  /** Modifie les infos de l'élément sélectionné (touche ou bouton de la manette) ; faux s'il n'y en a pas. */
  editSelection(): boolean {
    const ref = this.ctx.ui.selectedRef();
    if (ref) this.ctx.ui.editRef(ref);
    return !!ref;
  }

  /** Message bref en bas de l'écran (texte déjà traduit). */
  notify({ message, duration }: { message: string; duration?: number }): void {
    this.ctx.toast(message, duration ? { duration } : {});
  }
}
