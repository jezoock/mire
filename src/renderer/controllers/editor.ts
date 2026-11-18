import { Controller } from './base.ts';
import { openEditor } from '../editors/editor.ts';

/**
 * `mire-editor` : éditeurs (P4-22). Modifier les infos, les tags et les images d'un élément du catalogue, désigné par
 * sa clé ; rechercher sa fiche en ligne ; le réinitialiser. Le formulaire est celui de P4-06 (`mire-form`).
 */
export class EditorController extends Controller {
  /** Ouvre l'éditeur d'un élément ; rend le bouton choisi (`save`, `reset`, `cancel`), ou `null` s'il n'existe pas. */
  edit({ key }: { key: string }): Promise<string | null> {
    return openEditor(this.ctx, String(key));
  }

  /** Ouvre l'éditeur de l'élément dont la carte a le focus ; faux s'il n'y en a pas. */
  editSelected(): boolean {
    const key = this.ctx.ui.selectedKey?.();
    if (key) void openEditor(this.ctx, key);
    return !!key;
  }
}
