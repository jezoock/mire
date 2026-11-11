/** Types partagés par le lancement de programmes, la détection et les lecteurs externes. */

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

export interface LaunchOptions {
  /** Dossier de travail du programme (ignoré s'il n'existe pas). */
  cwd?: string;
  /** « Réduire pendant le jeu » : la fenêtre de Mire est réduite tant que le programme tourne. */
  hideWhileRunning?: boolean;
}

/** Ce que la détection lit du système : plateforme, variables d'environnement et système de fichiers. */
export interface DetectEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fs: { statSync(file: string): { isFile(): boolean } };
}

/** Variables passées au lecteur externe. `start` en secondes (0 : début). */
export interface PlayerVariables {
  url: string;
  title: string;
  start: number;
}

/** Lecteur externe (mpv, VLC…) : futur addon « lecteur externe ». */
export interface ExternalPlayer {
  id: string;
  /** Le programme choisi est-il ce lecteur ? (d'après le nom du fichier) */
  matches(command: string, denv?: DetectEnv): boolean;
  /** Emplacement du lecteur installé, ou null. */
  detect(denv?: DetectEnv): string | null;
  /** Arguments de lancement, variables remplacées. */
  args(variables: PlayerVariables): string[];
}

/** Réglage d'un programme externe (lecteur, navigateur) : emplacement et arguments, vides = automatique. */
export interface ProgramSetting {
  path?: string;
  args?: unknown;
}
