/** Types partagés par le lancement de programmes, la détection et les lecteurs externes. */

export interface LaunchResult {
  ok: boolean;
  error?: string;
  /** Le programme à lancer n'existe pas (le message seul ne suffit pas : il est traduit). */
  notFound?: boolean;
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

/** Emplacements d'un lecteur par système (`process.platform`), vérifiés par `src/main/plugins/apps.ts`. */
export type PlayerLocations = Partial<Record<'win32' | 'darwin' | 'linux', string[]>>;

/** Options choisies par le plugin, chacune limitée à sa forme (`--fs`, `--titre={title}`, `--debut={start}`). */
export interface PlayerOptions {
  fullscreen?: string;
  title?: string;
  start?: string;
}

/** Lecteur externe décrit par un plugin (contribution `apps` de genre `player`, P5-20), données vérifiées. */
export interface ExternalPlayerSpec {
  /** `<plugin>/<contribution>`. */
  id: string;
  /** Clé du nom affiché (`pluginTexts.<plugin>.apps.<contribution>.name`). */
  name: string;
  priority: number;
  /** Noms du programme, en minuscules, sans extension. */
  names: string[];
  locations: PlayerLocations;
  options: PlayerOptions;
}

/** Réglage d'un programme externe (lecteur, navigateur) : emplacement et arguments, vides = automatique. */
export interface ProgramSetting {
  path?: string;
  args?: unknown;
}
