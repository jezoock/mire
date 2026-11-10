/** Bibliothèque et fichiers : analyse des sources, sous-titres, fichiers ouverts, emplacements, boîtes de dialogue. */
import fsp from 'node:fs/promises';
import * as http from '../../net/http.ts';
import { resolveLocation } from '../../lib/location.js';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function libraryHandlers(ctx: MainContext) {
  return {
    scanLibrary: (...args) => ctx.scanLibrary(...args),
    subtitles: (...args) => ctx.findSubtitles(...args),
    openMediaDialog: (...args) => ctx.openMediaDialog(...args),
    fromPaths: async (paths) => (await Promise.all((paths || []).map(ctx.itemFromPath))).filter(Boolean),
    takePendingFiles: async () => {
      const items = (await Promise.all(ctx.pendingFiles.map(ctx.itemFromPath))).filter(Boolean);
      ctx.pendingFiles = [];
      return items;
    },
    checkLocation: async (loc) => {
      const r = resolveLocation(loc);
      if (r.type === 'url') {
        try {
          const res = await http.request(r.url as string, { timeout: 10000 });
          return { ok: res.ok, error: res.ok ? null : `Le serveur a répondu avec le code ${res.status}.` };
        } catch {
          return { ok: false, error: 'Adresse injoignable.' };
        }
      }
      try {
        await fsp.access(r.path as string);
        return { ok: true };
      } catch {
        return { ok: false, error: ctx.locationError(loc, r) };
      }
    },
    pickFolder: (...args) => ctx.pickFolder(...args),
    pickFile: (...args) => ctx.pickFile(...args),
  } satisfies Partial<IpcImplementations>;
}
