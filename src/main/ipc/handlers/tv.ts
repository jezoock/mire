/** Télévision : service actif, détection sur le réseau local, chaînes. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function tvHandlers(ctx: MainContext) {
  return {
    tvDetect: async () => {
      const id = await ctx.detectTvService();
      if (id) ctx.config = ctx.saveConfig({ ...ctx.config, tv: { ...ctx.config.tv, active: id, detected: true } });
      return { id, name: ctx.config.tv.services.find((t: { id: string }) => t.id === id)?.name || '' };
    },
    tvSetActive: (id) => {
      ctx.config = ctx.saveConfig({ ...ctx.config, tv: { ...ctx.config.tv, active: String(id || ''), detected: true } });
      return ctx.config;
    },
    tvChannels: (...args) => ctx.fetchChannels(...args),
  } satisfies Partial<IpcImplementations>;
}
