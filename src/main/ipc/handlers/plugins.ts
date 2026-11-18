/** Plugins (P3-03) : liste et activation, pour le futur Centre (P4-18). */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function pluginsHandlers(ctx: MainContext) {
  return {
    pluginsList: () => ctx.plugins.list(),
    pluginsSetEnabled: (id, enabled) => ctx.plugins.setEnabled(id, enabled),
  } satisfies Partial<IpcImplementations>;
}
