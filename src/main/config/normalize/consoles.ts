/** Consoles (émulateurs). */
import type { Emulator } from '@mire/shared';
import { isObjectLike, type Loose } from './common.ts';
import { normalizeLinkSites } from './games.ts';

export function normalizeEmulators(list: unknown[]): Emulator[] {
  return list
    .filter((e): e is Loose => isObjectLike(e) && !!e.path)
    .map((e) => {
      const out: Loose = { ...e, sources: Array.isArray(e.sources) ? e.sources.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [] };
      if (Array.isArray(e.romSites)) out.romSites = normalizeLinkSites(e.romSites);
      else delete out.romSites;
      return out as Emulator;
    });
}
