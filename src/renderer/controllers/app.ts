import { Controller } from './base.ts';
import { openEditor } from '../editors/editor.ts';
import { openGroupEditor } from '../editors/group-editor.ts';
import type { PagePath } from '@mire/shared';
import { isGameBookmarkKey, isGameKey } from '../games/model.ts';
import { callAction } from './registry.ts';

/** `mire-app` : écrans, menu, réglages de la page (le rouage), édition de l'élément sélectionné, notifications. */
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

  /** Écran Réglages, ouvert sur une partie (`sources`, `home`…). */
  openSettings({ part }: { part: string }): void {
    this.ctx.ui.revealSettings(String(part || '') || null);
  }

  /** Le rouage de l'en-tête : les Réglages, sur la partie de la page affichée (ses sources, ses sites, ses jeux…). */
  openPageSettings(): void {
    this.ctx.ui.openPageSettings();
  }

  /**
   * Modifie les infos de l'élément sélectionné (touche ou bouton de la manette) ; faux s'il n'y en a pas. Une carte du
   * catalogue (vue de page, accueil, Recherche, explorateur) ouvre l'éditeur de P4-22, un regroupement le sien.
   */
  editSelection(): boolean {
    const key = this.ctx.ui.selectedKey?.();
    if (key) {
      // Un jeu ouvre sa boîte (P4-17) : émulateur, lancer, modifier ses infos, supprimer.
      if (isGameKey(key) || isGameBookmarkKey(key)) void callAction('mire-games', 'gameOptions', { key });
      else void openEditor(this.ctx, key);
      return true;
    }
    const group = this.ctx.ui.selectedGroup?.();
    if (!group) return false;
    void openGroupEditor(this.ctx, group);
    return true;
  }

  /** Message bref en bas de l'écran (texte déjà traduit). */
  notify({ message, duration }: { message: string; duration?: number }): void {
    this.ctx.toast(message, duration ? { duration } : {});
  }
}
