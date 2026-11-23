/**
 * Lecteurs externes et navigateur externe : choix du programme, arguments, lancement. Les lecteurs (mpv, VLC…) sont
 * décrits par les plugins (contribution `apps`, P5-20, lue par `src/main/plugins/apps.ts`) ; le cœur cherche
 * lui-même le programme aux emplacements décrits (ou prend celui choisi par l'utilisateur) et fabrique lui-même la
 * ligne de commande : options du plugin limitées à leur forme, titre et position remplacés ici, fichier à lire en
 * dernier. Le lancement passe par `launcher.ts`, sans shell.
 */
import { isUrlTarget } from '@mire/shared';
import type { ExternalPlayerInfo } from '@mire/shared/ipc';
import { substitute } from '../lib/args.ts';
import { programBaseName } from '../plugins/apps.ts';
import { detectBrowser, firstExisting, playerCandidates, systemDetectEnv } from './detect.ts';
import type { Launcher, ShellLike } from './launcher.ts';
import type { DetectEnv, ExternalPlayerSpec, LaunchResult, PlayerVariables, ProgramSetting } from './types.ts';
import { t } from '../i18n/current.ts';

/** Arguments par défaut du navigateur externe : fenêtre d'application sans barre d'adresse. */
export const BROWSER_ARGS = ['--app={url}'];

/** Longueur maximale du titre passé au lecteur. */
export const MAX_TITLE_LENGTH = 300;

/** Valeurs à remplacer dans les arguments : une position nulle retire l'argument de reprise. */
export function playerVars({ url, title, start }: PlayerVariables) {
  const s = Math.floor(Number(start) || 0);
  return { url, title, start: s > 0 ? s : '' };
}

/** Arguments d'un lecteur : plein écran, titre, position (retirés s'ils sont vides), puis le fichier à lire. */
export function playerArgs(player: ExternalPlayerSpec, variables: PlayerVariables): string[] {
  const { fullscreen, title, start } = player.options;
  const vars = playerVars(variables);
  return [
    ...substitute(
      [fullscreen, title, start].filter((o): o is string => !!o),
      { title: vars.title, start: vars.start },
    ),
    variables.url,
  ];
}

/** Le programme est-il ce lecteur ? D'après le nom du fichier (`D:\Outils\VLC\vlc.exe` est VLC). */
export function isPlayer(player: ExternalPlayerSpec, command: string, denv: DetectEnv): boolean {
  const base = programBaseName(command, denv.platform === 'win32');
  return player.names.some((n) => base.includes(n));
}

/** Premier lecteur installé, dans l'ordre de préférence des plugins ; null si aucun. */
export function detectPlayer(players: readonly ExternalPlayerSpec[], denv: DetectEnv = systemDetectEnv()): string | null {
  return firstExisting(
    denv,
    players.flatMap((p) => playerCandidates(p.locations, denv)),
  );
}

/**
 * Programme et arguments du lecteur externe : programme choisi par l'utilisateur, sinon le premier trouvé aux
 * emplacements des plugins, sinon le nom du lecteur préféré (cherché dans le PATH) ; `null` sans aucun lecteur.
 */
export function resolvePlayer(
  setting: ProgramSetting,
  variables: PlayerVariables,
  players: readonly ExternalPlayerSpec[],
  denv: DetectEnv = systemDetectEnv(),
): { cmd: string; args: string[] } | null {
  if (!players.length) return null;
  const cmd = (setting.path || '').trim() || detectPlayer(players, denv) || players[0].names[0];
  if (Array.isArray(setting.args) && setting.args.length) return { cmd, args: substitute(setting.args, playerVars(variables)) };
  const player = players.find((p) => isPlayer(p, cmd, denv)) ?? players[0];
  return { cmd, args: playerArgs(player, variables) };
}

export interface PlayersDeps {
  launcher: Launcher;
  shell: ShellLike;
  /** Réglages actuels du lecteur et du navigateur externes. */
  settings: () => { externalPlayer: ProgramSetting; browser: ProgramSetting };
  /** Politique d'accès : seul un fichier de la bibliothèque peut être confié au lecteur. */
  isAllowed: (file: string) => boolean;
  /** Lecteurs des plugins actifs, dans l'ordre de préférence (vide : plugin désactivé, pas de lecteur externe). */
  players: () => readonly ExternalPlayerSpec[];
  detectEnv?: () => DetectEnv;
}

export function createPlayers({ launcher, shell, settings, isAllowed, players, detectEnv = systemDetectEnv }: PlayersDeps) {
  async function playExternal(target: unknown, title: unknown = '', start: unknown = 0): Promise<LaunchResult> {
    // Le fichier à lire passe en dernier argument : il ne doit pas pouvoir se faire passer pour une option.
    if (typeof target !== 'string' || !target || target.startsWith('-')) return { ok: false, error: t('platform.errors.nothingToPlay') };
    if (!isUrlTarget(target) && !isAllowed(target)) return { ok: false, error: t('platform.errors.notInLibrary') };
    const name = typeof title === 'string' ? title.slice(0, MAX_TITLE_LENGTH) : '';
    const resolved = resolvePlayer(settings().externalPlayer, { url: target, title: name, start: Number(start) || 0 }, players(), detectEnv());
    if (!resolved) return { ok: false, error: t('platform.errors.externalPlayersOff') };
    const r = await launcher.launchProcess(resolved.cmd, resolved.args);
    if (!r.ok && r.notFound) {
      r.error = t('platform.errors.noExternalPlayer');
    }
    return r;
  }

  async function openInBrowser(url: string): Promise<LaunchResult> {
    const b = settings().browser;
    const cmd = (b.path || '').trim() || detectBrowser(detectEnv());
    if (!cmd) {
      await shell.openExternal(url);
      return { ok: true };
    }
    const args = Array.isArray(b.args) && b.args.length ? b.args : BROWSER_ARGS;
    return launcher.launchProcess(cmd, substitute(args, { url }));
  }

  /** Lecteurs proposés à l'interface (« Ouvrir dans le lecteur externe ») : vide quand aucun plugin n'en décrit. */
  function list(): ExternalPlayerInfo[] {
    return players().map((p) => ({ id: p.id, name: p.name }));
  }

  return { playExternal, openInBrowser, list };
}
