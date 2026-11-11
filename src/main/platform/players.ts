/** Lecteurs externes (mpv, VLC) et navigateur externe : préréglages d'arguments, choix du programme, lancement. */
import { isUrlTarget } from '@mire/shared';
import { substitute } from '../lib/args.js';
import { detectBrowser, detectPlayer, firstExisting, playerCandidates, programName, systemDetectEnv } from './detect.ts';
import type { Launcher, ShellLike } from './launcher.ts';
import type { DetectEnv, ExternalPlayer, LaunchResult, PlayerVariables, ProgramSetting } from './types.ts';

/** Arguments par défaut de chaque lecteur : {url}, {title}, {start} (secondes ; argument retiré si 0). */
export const PLAYER_PRESETS = {
  mpv: ['--fs', '--force-media-title={title}', '--start={start}', '{url}'],
  vlc: ['--fullscreen', '--meta-title={title}', '--start-time={start}', '{url}'],
} as const;

/** Arguments par défaut du navigateur externe : fenêtre d'application sans barre d'adresse. */
export const BROWSER_ARGS = ['--app={url}'];

/** Valeurs à remplacer dans les arguments : une position nulle retire l'argument de reprise. */
export function playerVars({ url, title, start }: PlayerVariables) {
  const s = Math.floor(Number(start) || 0);
  return { url, title, start: s > 0 ? s : '' };
}

function presetPlayer(id: keyof typeof PLAYER_PRESETS, name: RegExp): ExternalPlayer {
  return {
    id,
    matches: (command, denv) => name.test(programName(command, denv)),
    detect: (denv = systemDetectEnv()) => firstExisting(denv, playerCandidates(id, denv)),
    args: (variables) => substitute([...PLAYER_PRESETS[id]], playerVars(variables)),
  };
}

export const MPV = presetPlayer('mpv', /mpv/i);
export const VLC = presetPlayer('vlc', /vlc/i);

/** Programme et arguments du lecteur externe : réglage de l'utilisateur, sinon détection (mpv, puis VLC). */
export function resolvePlayer(setting: ProgramSetting, variables: PlayerVariables, denv: DetectEnv = systemDetectEnv()): { cmd: string; args: string[] } {
  const cmd = (setting.path || '').trim() || detectPlayer(denv) || 'mpv';
  if (Array.isArray(setting.args) && setting.args.length) return { cmd, args: substitute(setting.args, playerVars(variables)) };
  const player = VLC.matches(cmd, denv) ? VLC : MPV;
  return { cmd, args: player.args(variables) };
}

export interface PlayersDeps {
  launcher: Launcher;
  shell: ShellLike;
  /** Réglages actuels du lecteur et du navigateur externes. */
  settings: () => { externalPlayer: ProgramSetting; browser: ProgramSetting };
  /** Politique d'accès : seul un fichier de la bibliothèque peut être confié au lecteur. */
  isAllowed: (file: string) => boolean;
  detectEnv?: () => DetectEnv;
}

export function createPlayers({ launcher, shell, settings, isAllowed, detectEnv = systemDetectEnv }: PlayersDeps) {
  async function playExternal(target: unknown, title = '', start: unknown = 0): Promise<LaunchResult> {
    if (typeof target !== 'string' || !target) return { ok: false, error: 'Rien à lire.' };
    if (!isUrlTarget(target) && !isAllowed(target)) return { ok: false, error: 'Ce fichier ne fait pas partie de la bibliothèque.' };
    const { cmd, args } = resolvePlayer(settings().externalPlayer, { url: target, title, start: Number(start) || 0 }, detectEnv());
    const r = await launcher.launchProcess(cmd, args);
    if (!r.ok && r.error?.startsWith('Programme introuvable')) {
      r.error = 'Aucun lecteur externe trouvé. Installez VLC ou mpv, ou indiquez son emplacement dans Réglages.';
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

  return { playExternal, openInBrowser };
}
