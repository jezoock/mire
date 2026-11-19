/**
 * Suppression d'un jeu : fichier local effacé, ou jeu PC ajouté à la main retiré de la configuration. L'interface
 * désigne le jeu par sa clé d'élément (`deleteGameElement`, P4-17) ; le chemin à effacer est toujours contrôlé ici,
 * dans le processus principal (contrôle de P0-06, renforcé par celui des fichiers : liens symboliques compris).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl } from '@mire/shared';
import type { Element, ElementKey } from '@mire/shared';
import type { GameRef } from '@mire/shared/ipc';
import { checkExisting } from '../files/guard.ts';
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
  const outside = { ok: false as const, error: t('games.errors.deleteOutsideConsole', { console: String(emu.name) }) };
  if (!deps.access.isInside(ref.path, roots)) return outside;
  // Même contrôle que la gestion des fichiers : un lien symbolique qui mène hors des dossiers de la console est refusé.
  const checked = await checkExisting(ref.path, roots, { platform: process.platform, fs: fsp });
  if (!checked.ok && checked.code !== 'missing') return outside;
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

/** Ce que la suppression lit d'un élément du catalogue. */
type ElementLookup = (key: ElementKey) => Pick<Element, 'open'> | null;

/**
 * Supprime le jeu désigné par sa clé : un jeu de console (son fichier, sous les dossiers de sa console) ou un jeu PC
 * ajouté à la main (retiré de la liste). Rien d'autre ne se supprime par ce chemin.
 */
export async function deleteGameElement(deps: Pick<GamesDeps, 'config' | 'access'>, lookup: ElementLookup, key: string) {
  const el = typeof key === 'string' && key ? lookup(key) : null;
  const open = el?.open;
  if (open?.kind === 'game') return deleteGame(deps, { kind: 'rom', consoleId: open.console, path: open.path });
  if (open?.kind === 'program') {
    const manualIndex = deps.config.get().games.findIndex((g) => g.path === open.path);
    return deleteGame(deps, { kind: 'game', manualIndex: manualIndex >= 0 ? manualIndex : undefined });
  }
  return { ok: false as const, error: t('games.errors.deleteNotGame') };
}
