/**
 * Contrôleur `mire-dialogs` (P4-06) : les boutons des boîtes de dialogue sur les composants (`mire-form`,
 * `mire-pick`) appellent son action `act` par `ds-trigger`, avec la clé de la boîte et du bouton
 * (`act:[{"dialog":"d1","action":"save"}]`, `{"action":"list-del","field":"sources","value":"/films"}`). Il la
 * transmet au service des boîtes (`ui/dialogs.ts`), injecté par l'interface.
 */
import { Controller } from './base.ts';
import type { ActionArgs } from './registry.ts';

export class DialogsController extends Controller {
  /** Bouton d'une boîte : `{ dialog, action, field?, value? }`. */
  act(args: ActionArgs = {}): Promise<void> {
    return this.ctx.dialogs.act(args);
  }
}
