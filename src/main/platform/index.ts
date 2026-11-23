/** Plateforme : ce qui dépend du système d'exploitation (programmes, lecteurs et navigateurs externes). */
export { createLauncher, type Launcher, type LauncherDeps, type ShellLike } from './launcher.ts';
export { detectBrowser, playerCandidates, systemDetectEnv } from './detect.ts';
export { createPlayers, detectPlayer, isPlayer, playerArgs, resolvePlayer, playerVars, BROWSER_ARGS, type PlayersDeps } from './players.ts';
export type * from './types.ts';
