/** Suppression d'un jeu : fichier local effacé, ou jeu PC ajouté à la main retiré de la configuration. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl } from '@mire/shared';
import type { GameRef } from '@mire/shared/ipc';
import { findConsole } from '../config/index.ts';
import { resolveLocation } from '../library/location.ts';
import * as disc from './disc/index.ts';
import { consoleLocations } from './roms/list.ts';
import type { GamesDeps } from './types.ts';
import { t } from '../i18n/current.ts';

export async function deleteGame(deps: Pick<GamesDeps, 'config' | 'access'>, ref: GameRef) {
  const config = deps.config.get();
  if (ref.kind === 'game') {
    const index = ref.manualIndex;
    if (index != null && config.games[index]) {
      const next = deps.config.update((c) => {
        c.games.splice(index, 1);
      });
      return { ok: true as const, config: next };
    }
    return {
      ok: false as const,
      error: t('games.errors.deleteAutoFound'),
    };
  }
  // Jeu de console local : on supprime son fichier (et les fichiers voisins d'un jeu sur disque).
  if (typeof ref.path !== 'string' || !ref.path || isHttpUrl(ref.path)) return { ok: false as const, error: t('games.errors.deleteOnline') };
  const emu = ref.kind === 'rom' ? findConsole(config, ref.consoleId) : null;
  if (!emu) return { ok: false as const, error: t('games.errors.deleteNoConsole') };
  // L'interface n'est pas crue sur parole : le fichier doit être dans un dossier local de cette console.
  const roots = consoleLocations(emu)
    .filter((p) => !p.remote)
    .map((p) => resolveLocation(p.location))
    .flatMap((l) => (l.type === 'path' ? [l.path] : []));
  if (!deps.access.isInside(ref.path, roots)) return { ok: false as const, error: t('games.errors.deleteOutsideConsole', { console: String(emu.name) }) };
  try {
    const st = await fsp.stat(ref.path);
    if (!st.isFile()) return { ok: false as const, error: t('games.errors.deleteNotFile') };
    if (disc.isDescriptor(ref.path)) {
      const dir = path.dirname(ref.path);
      const refs = disc.missingLocal(ref.path).length === 0 ? disc.parseRefs(ref.path, disc.decode(await fsp.readFile(ref.path))) : [];
      for (const r of refs) await fsp.rm(path.join(dir, ...r.split('/')), { force: true }).catch(() => {});
    }
    await fsp.rm(ref.path, { force: true });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: t('games.errors.deleteFailed', { reason: (err as Error).message }) };
  }
}
