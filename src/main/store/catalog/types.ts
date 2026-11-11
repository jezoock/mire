/** Types du catalogue de la boutique. */

/** Plateforme vue par la boutique : elle n'installe que sous Windows et Linux. */
export type StorePlatform = 'win32' | 'linux' | 'other';
export type InstallPlatform = Exclude<StorePlatform, 'other'>;

/** Console proposée par la boutique. */
export interface StoreSystem {
  /** Identifiant dans la boutique (`nes`, `ps1`…), utilisé dans `store` des consoles (`<émulateur>:<système>`). */
  id: string;
  name: string;
  /** Sous-dossier des jeux, sous le dossier des ROMs de la boutique. */
  folder: string;
  /** Système du référentiel `SYSTEMS` (`@mire/shared`). */
  libretro: string;
  /** Extensions enregistrées sur la console. */
  ext: string[];
  /** Cœur RetroArch (systèmes de RetroArch seulement). */
  core?: string;
}

/** D'où vient l'émulateur : dernière version d'un dépôt GitHub, ou lien trouvé sur une page de téléchargement. */
export type EmulatorSource = { github: string; win32?: RegExp; linux?: RegExp } | { page: string; win32?: RegExp; linux?: RegExp };

export interface StoreEmulator {
  id: string;
  name: string;
  desc: string;
  site: string;
  /** RetroArch : installé depuis le buildbot, avec un cœur par console choisie. */
  retroarch?: boolean;
  source?: EmulatorSource;
  /** Nom du programme à lancer, cherché dans le dossier d'installation. */
  exe: Partial<Record<InstallPlatform, RegExp>>;
  /** Arguments de lancement (`{rom}` : le jeu). */
  args?: string[];
  systems: StoreSystem[];
}

/** Jeu homebrew publié librement par son auteur. */
export interface FreeGame {
  id: string;
  name: string;
  /** Identifiant d'un système RetroArch de la boutique. */
  system: string;
  author: string;
  desc: string;
  url: string;
  file: string;
}
