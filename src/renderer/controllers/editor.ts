import { Controller } from './base.ts';
import type { PagePath } from '@mire/shared';
import { openEditor } from '../editors/editor.ts';
import { openGroupEditor } from '../editors/group-editor.ts';

/**
 * `mire-editor` : éditeurs (P4-22). Modifier les infos, les tags et les images d'un élément du catalogue, désigné par
 * sa clé ; rechercher sa fiche en ligne ; le réinitialiser. Le formulaire est celui de P4-06 (`mire-form`). Un
 * regroupement (un album, une série) est désigné par sa page et son chemin ; ses modifications valent pour tous ses
 * éléments.
 */
export class EditorController extends Controller {
  /** Ouvre l'éditeur d'un élément ; rend le bouton choisi (`save`, `reset`, `cancel`), ou `null` s'il n'existe pas. */
  edit({ key }: { key: string }): Promise<string | null> {
    return openEditor(this.ctx, String(key));
  }

  /** Ouvre l'éditeur d'un regroupement d'une page ; rend le bouton choisi, ou `null` s'il n'existe pas. */
  editGroup({ page, path }: { page: string; path: PagePath }): Promise<string | null> {
    return openGroupEditor(this.ctx, { page: String(page), path: Array.isArray(path) ? path : [] });
  }

  /** Ouvre l'éditeur de la carte (élément ou regroupement) qui a le focus ; faux s'il n'y en a pas. */
  editSelected(): boolean {
    const key = this.ctx.ui.selectedKey?.();
    if (key) {
      void openEditor(this.ctx, key);
      return true;
    }
    const group = this.ctx.ui.selectedGroup?.();
    if (group) void openGroupEditor(this.ctx, group);
    return !!group;
  }
}
