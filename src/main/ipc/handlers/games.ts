/** Jeux : sources, lancement, consoles, sites de jeux, suppression, nettoyage et copie locale d'un jeu en ligne. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl, safeFileName } from '@mire/shared';
import type { Game } from '@mire/shared';
import type { CleanupReport, GameRef } from '@mire/shared/ipc';
import { findConsole } from '../../config/index.ts';
import * as http from '../../net/http.ts';
import disc from '../../discfiles.js';
import { resolveLocation } from '../../lib/location.js';
import { isInside } from '../../lib/paths.js';
import { defaultRomSites } from '../../romsites.js';
import { guessSystem } from '../../scraper.js';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

// Supprime un jeu : fichier local effacé, ou jeu PC manuel retiré de la configuration.
export async function deleteGame(ctx: MainContext, ref: GameRef) {
  const config = ctx.config.get();
  if (ref.kind === 'game') {
    const index = ref.manualIndex;
    if (index != null && config.games[index]) {
      const next = ctx.config.update((c) => {
        c.games.splice(index, 1);
      });
      return { ok: true as const, config: next };
    }
    return {
      ok: false as const,
      error: 'Ce jeu est trouvé automatiquement dans un dossier : retirez le dossier dans les réglages, ou supprimez le jeu sur le disque.',
    };
  }
  // Jeu de console local : on supprime son fichier (et les fichiers voisins d'un jeu sur disque).
  if (typeof ref.path !== 'string' || !ref.path || isHttpUrl(ref.path))
    return { ok: false as const, error: 'Un jeu disponible en ligne ne peut pas être supprimé ici.' };
  const emu = ref.kind === 'rom' ? findConsole(config, ref.consoleId) : null;
  if (!emu) return { ok: false as const, error: 'Ce jeu n’est rattaché à aucune console : il n’a pas été supprimé.' };
  // Le renderer n'est pas cru sur parole : le fichier doit être dans un dossier local de cette console.
  const roots = ctx
    .consoleLocations(emu)
    .filter((p: { remote?: boolean }) => !p.remote)
    .map((p: { location: string }) => resolveLocation(p.location))
    .filter((l: { type: string }) => l.type === 'path')
    .map((l: { path: string }) => l.path);
  if (!isInside(ref.path, roots))
    return { ok: false as const, error: `Ce fichier ne se trouve pas dans les dossiers de ${emu.name} : il n’a pas été supprimé.` };
  try {
    const st = await fsp.stat(ref.path);
    if (!st.isFile()) return { ok: false as const, error: 'Seul un fichier de jeu peut être supprimé ici, pas un dossier.' };
    if (disc.isDescriptor(ref.path)) {
      const dir = path.dirname(ref.path);
      const refs = disc.missingLocal(ref.path).length === 0 ? disc.parseRefs(ref.path, disc.decode(await fsp.readFile(ref.path))) : [];
      for (const r of refs) await fsp.rm(path.join(dir, ...(r as string).split('/')), { force: true }).catch(() => {});
    }
    await fsp.rm(ref.path, { force: true });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: `Suppression impossible : ${(err as Error).message}` };
  }
}

// Nettoyage : vérifie que chaque jeu existe encore (fichier local présent, adresse en ligne joignable).
export async function cleanupGames(ctx: MainContext, online?: boolean) {
  const config = ctx.config.get();
  const result: CleanupReport = { missingLocal: [], missingRemote: [], removedManual: 0, checked: 0 };
  const nextGames: Game[] = [];
  for (const g of config.games) {
    result.checked++;
    if (/^[a-z]+:\/\//i.test(g.path) || fs.existsSync(g.path)) nextGames.push(g);
    else {
      result.removedManual++;
      result.missingLocal.push(g.name as string);
    }
  }
  for (const emu of config.emulators) {
    if (online) {
      for (const p of ctx.consoleLocations(emu).filter((x: { remote?: boolean }) => x.remote)) {
        try {
          const res = await http.head(p.location, { timeout: 6000 });
          if (!res.ok) result.missingRemote.push(`${emu.name} : ${p.location}`);
        } catch {
          result.missingRemote.push(`${emu.name} : ${p.location}`);
        }
        result.checked++;
      }
    }
  }
  if (result.removedManual) {
    result.config = ctx.config.update((c) => ({ ...c, games: nextGames }));
  }
  return { ok: true as const, ...result };
}

// Jeu d'une source web : copie locale dans le dossier principal de la console.
export async function downloadGame(ctx: MainContext, consoleId: string, url: string) {
  const emu = findConsole(ctx.config.get(), consoleId);
  const { downloads } = ctx;
  if (!emu) return { ok: false as const, error: 'Cette console n’existe plus dans la configuration.' };
  if (!emu.romsDir) return { ok: false as const, error: `Indiquez d’abord le dossier principal de ${emu.name} (Modifier la console).` };
  const u = String(url || '');
  if (!disc.isDescriptor(u)) return { ...downloads.addUrl(u, { console: consoleId }), count: 1 };
  // Jeu sur disque : l'index et tous les fichiers qu'il cite, dans un dossier au nom du jeu.
  let files;
  try {
    files = await disc.resolveRemote(u, (x: string) => downloads.fetchText(x));
  } catch (err) {
    return { ok: false as const, error: `Index du jeu illisible (${(err as Error).message}).` };
  }
  const base = safeFileName(path.basename(files[0].rel, path.extname(files[0].rel)), { max: Infinity, fallback: '' });
  const folder = path.join(emu.romsDir as string, base);
  const todo = files.filter((f) => !fs.existsSync(path.join(folder, ...f.rel.split('/'))));
  for (const f of todo) downloads.addUrl(f.url, { console: consoleId, saveAs: path.join(folder, ...f.rel.split('/')), group: base, companionsQueued: true });
  return { ok: true as const, count: todo.length, total: files.length };
}

export function gamesHandlers(ctx: MainContext) {
  return {
    scanGameSources: (...args) => ctx.scanGameSources(...args),
    launchGamePath: (...args) => ctx.launchGamePath(...args),
    launchGame: (...args) => ctx.launchGame(...args),
    addGame: (...args) => ctx.addGame(...args),
    listRoms: (...args) => ctx.listRoms(...args),
    launchRom: (...args) => ctx.launchRom(...args),
    romListSource: (consoleId, only) => ctx.listRoms(consoleId, { online: true, only }),
    gameDelete: (ref) => deleteGame(ctx, ref),
    gamesCleanup: (online) => cleanupGames(ctx, online),
    romSites: (consoleId) => {
      const emu = consoleId === 'pc' ? null : findConsole(ctx.config.get(), consoleId);
      return {
        sites: ctx.consoleSites(consoleId),
        custom: consoleId === 'pc' ? true : Array.isArray(emu?.romSites),
        defaults: emu ? defaultRomSites(guessSystem(emu)) : [],
      };
    },
    romDownload: (consoleId, url) => downloadGame(ctx, consoleId, url),
  } satisfies Partial<IpcImplementations>;
}
