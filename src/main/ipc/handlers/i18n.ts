/** Langue de l'interface et catalogues de textes. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function i18nHandlers(ctx: MainContext) {
  return {
    i18nGet: () => ctx.i18n.snapshot(),
  } satisfies Partial<IpcImplementations>;
}
