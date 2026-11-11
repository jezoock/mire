/** Lancement des jeux PC (ajoutés à la main ou trouvés dans les dossiers) et ajout manuel d'un jeu. */
import fs from 'node:fs';
import path from 'node:path';
import { isUrlTarget } from '@mire/shared';
import type { Config } from '@mire/shared';
import type { LaunchResult } from '../../platform/index.ts';
import type { GamesDeps } from '../types.ts';

type Deps = Pick<GamesDeps, 'config' | 'access' | 'launcher'>;

/** Jeu ajouté à la main, désigné par sa position dans `games` : fichier, raccourci ou adresse (steam://…). */
export async function launchGame(deps: Deps, index: number): Promise<LaunchResult> {
  const g = deps.config.get().games[index];
  if (!g) return { ok: false, error: 'Ce jeu n’existe plus dans la configuration.' };
  const target = String(g.path);
  if (!isUrlTarget(target) && !fs.existsSync(target)) return { ok: false, error: `Fichier introuvable : ${target}` };
  return deps.launcher.openTarget(target, (g.args as string[]) || [], {
    cwd: (g.cwd as string) || (isUrlTarget(target) ? undefined : path.dirname(target)),
    hideWhileRunning: true,
  });
}

/** Jeu trouvé dans un dossier de jeux : l'interface n'est pas crue sur parole, le fichier doit être autorisé. */
export async function launchGamePath(deps: Deps, target: unknown): Promise<LaunchResult> {
  if (typeof target !== 'string' || !deps.access.isAllowed(target)) return { ok: false, error: 'Ce jeu ne fait pas partie de vos dossiers de jeux.' };
  if (!fs.existsSync(target)) return { ok: false, error: `Fichier introuvable : ${target}` };
  return deps.launcher.openTarget(target, [], { cwd: path.dirname(target), hideWhileRunning: true });
}

/** « Ajouter un jeu » : l'utilisateur choisit le fichier ; rend la configuration, ou null s'il a renoncé. */
export async function addGame(deps: Pick<GamesDeps, 'config' | 'pickFile'>): Promise<Config | null> {
  const p = await deps.pickFile('game');
  if (!p) return null;
  const name = path.basename(p).replace(/\.(exe|lnk|url|bat|cmd|app)$/i, '');
  return deps.config.update((c) => ({ ...c, games: [...c.games, { name, path: p, args: [], image: '' }] }));
}
