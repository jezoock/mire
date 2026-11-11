/** Plateforme : ce qui dépend du système d'exploitation (programmes, lecteurs et navigateurs externes). */
export { createLauncher, type Launcher, type LauncherDeps, type ShellLike } from './launcher.ts';
export { detectPlayer, detectBrowser, systemDetectEnv } from './detect.ts';
export { createPlayers, resolvePlayer, playerVars, PLAYER_PRESETS, BROWSER_ARGS, MPV, VLC, type PlayersDeps } from './players.ts';
export type * from './types.ts';
