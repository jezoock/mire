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
    // L'interface désigne la chaîne par sa clé : le service choisit la variante, puis le lecteur externe s'ouvre.
    tvWatch: async (key) => {
      const r = await ctx.channelStream(String(key));
      if (!r?.ok) return r;
      return ctx.playExternal(r.url, r.title, 0);
    },
  } satisfies Partial<IpcImplementations>;
}
