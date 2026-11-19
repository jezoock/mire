import { Controller } from './base.ts';

/**
 * `mire-rescue` : bandeau du mode secours (P4-10), au-dessus de l'explorateur : choisir un autre thème (désigné par
 * son identifiant, parmi les thèmes connus), aller à l'accueil.
 */
export class RescueController extends Controller {
  /** Choisit le thème des pages ; un identifiant inconnu est refusé. */
  async chooseTheme({ id }: { id: string }): Promise<boolean> {
    const { ui, t, toast } = this.ctx;
    const theme = ui.rescue.themes().find((th) => th.id === String(id));
    if (!theme) return false;
    await ui.saveUi((cfg) => {
      cfg.pageTheme = theme.id;
    });
    ui.rescue.refresh();
    toast(t('rescue.chosen', { theme: theme.name }));
    return true;
  }

  /** Quitte l'explorateur pour l'accueil, dessiné par le thème choisi. */
  goHome(): void {
    this.ctx.ui.go('home', { focus: 'content' });
  }
}
