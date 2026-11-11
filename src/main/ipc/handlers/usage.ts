/** Données d'usage : « Reprendre », positions de reprise des vidéos, volume, recherches récentes. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function usageHandlers(ctx: MainContext) {
  return {
    usageGet: () => ctx.usage.snapshot(),
    // Une seule fois, au premier lancement après la mise à jour : l'interface envoie ce que gardait son localStorage.
    usageMigrate: (legacy) => (ctx.usage.migrate(legacy), ctx.usage.snapshot()),
    usageAddRecent: (entry) => ctx.usage.addRecent(entry),
    usageRemoveRecent: (path) => ctx.usage.removeRecent(path),
    usageResume: (path) => ctx.usage.resume(path),
    usageSaveResume: (path, time, duration) => ctx.usage.saveResume(path, time, duration),
    usageClearResume: (path) => ctx.usage.clearResume(path),
    usageSetVolume: (volume) => ctx.usage.setVolume(volume),
    usageAddQuery: (query) => ctx.usage.addQuery(query),
    usageClearQueries: () => ctx.usage.clearQueries(),
  } satisfies Partial<IpcImplementations>;
}
