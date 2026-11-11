/** Télévision : service actif, détection sur le réseau local, chaînes. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function tvHandlers(ctx: MainContext) {
  return {
    tvDetect: async () => {
      const id = await ctx.detectTvService();
      if (id) ctx.config.update((c) => ({ ...c, tv: { ...c.tv, active: id, detected: true } }));
      return { id, name: ctx.config.get().tv.services.find((t) => t.id === id)?.name || '' };
    },
    tvSetActive: (id) => {
      return ctx.config.update((c) => ({ ...c, tv: { ...c.tv, active: String(id || ''), detected: true } }));
    },
    tvChannels: (...args) => ctx.fetchChannels(...args),
  } satisfies Partial<IpcImplementations>;
}
