/** Catalogue d'éléments (P2-01) : nouvelles méthodes, sans usage dans l'interface historique. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function catalogHandlers(ctx: MainContext) {
  return {
    catalogElement: (key) => ctx.catalog.element(key),
  } satisfies Partial<IpcImplementations>;
}
