/** Lancement des jeux PC (ajoutés à la main ou trouvés dans les dossiers) et ajout manuel d'un jeu. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isUrlTarget } from '@mire/shared';
import type { Config } from '@mire/shared';
import type { LaunchResult } from '../../platform/index.ts';
import type { GamesDeps } from '../types.ts';
import { t } from '../../i18n/current.ts';
import { isInside } from '../../lib/paths.ts';
import { gameLocations } from './locations.ts';

type Deps = Pick<GamesDeps, 'config' | 'access' | 'launcher' | 'platform'>;

/** Jeu ajouté à la main, désigné par sa position dans `games` : fichier, raccourci ou adresse (steam://…). */
export async function launchGame(deps: Deps, index: number): Promise<LaunchResult> {
  const g = deps.config.get().games[index];
  if (!g) return { ok: false, error: t('games.errors.gameGone') };
  const target = String(g.path);
  if (!isUrlTarget(target) && !fs.existsSync(target)) return { ok: false, error: t('games.errors.fileNotFound', { path: target }) };
  return deps.launcher.openTarget(target, (g.args as string[]) || [], {
    cwd: (g.cwd as string) || (isUrlTarget(target) ? undefined : path.dirname(target)),
    hideWhileRunning: true,
  });
}

/** Jeu trouvé dans un dossier de jeux : l'interface n'est pas crue sur parole, le fichier doit être autorisé. */
export async function launchGamePath(deps: Deps, target: unknown): Promise<LaunchResult> {
  if (typeof target !== 'string' || !deps.access.isAllowed(target)) return { ok: false, error: t('games.errors.notInGameFolders') };
  if (!fs.existsSync(target)) return { ok: false, error: t('games.errors.fileNotFound', { path: target }) };
  return deps.launcher.openTarget(target, [], { cwd: path.dirname(target), hideWhileRunning: true });
}

/** « Ajouter un jeu » : l'utilisateur choisit le fichier ; rend la configuration, ou null s'il a renoncé. */
export async function addGame(deps: Pick<GamesDeps, 'config' | 'pickFile'>): Promise<Config | null> {
  const p = await deps.pickFile('game');
  if (!p) return null;
  const name = path.basename(p).replace(/\.(exe|lnk|url|bat|cmd|app)$/i, '');
  return deps.config.update((c) => ({ ...c, games: [...c.games, { name, path: p, args: [], image: '' }] }));
}

/** Lecture du chemin réel (tests). */
export type Realpath = (p: string) => Promise<string>;

/**
 * Programme d'un élément du catalogue (P5-13), désigné par sa clé : le chemin vient du catalogue, jamais de
 * l'interface. Un jeu ajouté à la main (choisi par l'utilisateur) se lance avec ses arguments ; tout autre programme
 * (trouvé par un plugin) seulement s'il est dans un dossier de jeux, écrit puis réel (liens symboliques résolus), et
 * sans arguments : ceux d'un plugin ne sont jamais repris.
 */
export async function launchProgram(deps: Deps, target: string, realpath: Realpath = (p) => fsp.realpath(p)): Promise<LaunchResult> {
  const index = deps.config.get().games.findIndex((g) => g?.path === target);
  if (index >= 0) return launchGame(deps, index);
  const platform = deps.platform ?? process.platform;
  const dirs = gameLocations(deps.config.get().gameSources, platform).flatMap((l) => (l.location.path ? [l.location.path] : []));
  const refused = { ok: false as const, error: t('games.errors.notInGameFolders') };
  if (!isInside(target, dirs, { platform })) return refused;
  const real = await realpath(target).catch(() => null);
  if (!real) return { ok: false, error: t('games.errors.fileNotFound', { path: target }) };
  const roots = (await Promise.all(dirs.map((d) => realpath(d).catch(() => null)))).filter((r): r is string => !!r);
  if (!isInside(real, roots, { platform })) return refused;
  return deps.launcher.openTarget(target, [], { cwd: path.dirname(target), hideWhileRunning: true });
}
