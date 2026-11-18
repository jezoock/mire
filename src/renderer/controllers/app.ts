import { Controller } from './base.ts';
import { openEditor } from '../editors/editor.ts';
import type { PagePath } from '@mire/shared';
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

  /** Écran ou page suivant (`step: 1`) ou précédent (`-1`) du menu, depuis la manette ; depuis un site, sa page d'origine. */
  cycleSection({ step }: { step: number }): void {
    this.ctx.ui.cycle(step);
  }

  /**
   * Ouvre une cible (P4-07) : un écran du cœur (`screen:search`), une page (`movies`) ou une liste (`list:<id>`), et un
   * chemin dans ses regroupements. Le focus va au contenu, sauf `focus: 'keep'` (choix dans le menu). Faux si aucune
   * vue ne l'affiche encore (explorateur, liste).
   */
  open({ target, path, focus = 'content' }: { target: string; path?: PagePath; focus?: string }): boolean {
    return this.ctx.ui.open(target, { path: path ?? [], focus });
  }

  /** Site ouvert, choisi dans le menu sous la page d'où il vient. */
  openSite({ id }: { id: string }): void {
    this.ctx.ui.openSite(String(id));
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

  /**
   * Modifie les infos de l'élément sélectionné (touche ou bouton de la manette) ; faux s'il n'y en a pas. Une carte du
   * catalogue (vue de page, accueil, Recherche) ouvre l'éditeur de P4-22, un élément d'une vue historique l'ancien.
   */
  editSelection(): boolean {
    const key = this.ctx.ui.selectedKey?.();
    if (key) {
      void openEditor(this.ctx, key);
      return true;
    }
    const ref = this.ctx.ui.selectedRef();
    if (ref) this.ctx.ui.editRef(ref);
    return !!ref;
  }

  /** Message bref en bas de l'écran (texte déjà traduit). */
  notify({ message, duration }: { message: string; duration?: number }): void {
    this.ctx.toast(message, duration ? { duration } : {});
  }
}
