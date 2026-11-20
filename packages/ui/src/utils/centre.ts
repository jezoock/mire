/**
 * Centre (P4-18) : ce qu'affichent `mire-centre-view` et `mire-download-row`, déjà rédigé par la page
 * (`src/renderer/centre/`, et `src/renderer/games/` pour l'onglet des consoles, P4-17). Sans DOM.
 */

/** Onglets du Centre. */
export const CENTRE_TABS = ['downloads', 'apps', 'consoles'] as const;
export type CentreTab = (typeof CENTRE_TABS)[number];

/** Onglet connu, sinon les téléchargements. */
export const centreTab = (value: unknown): CentreTab => (CENTRE_TABS.includes(value as CentreTab) ? (value as CentreTab) : 'downloads');

/** Programme d'installation contenu dans un téléchargement terminé : son chemin et le texte du bouton. */
export interface DownloadInstaller {
  file: string;
  label: string;
}

/** Une ligne de la liste des téléchargements. */
export interface DownloadRow {
  id: string;
  name: string;
  /** `Torrent` ou `HTTP`, déjà rédigé. */
  kind: string;
  state: string;
  /** Ligne d'infos : état, quantité, débit, temps restant, destination. */
  meta: string;
  /** Avancement en pour cent ; `null` : pas de barre (confié au logiciel de torrent). */
  percent: number | null;
  error: string;
  /** Boutons de la ligne, selon l'état. */
  actions: { pause: boolean; resume: boolean; retry: boolean; cancel: boolean; remove: boolean; reveal: boolean; start: boolean };
  installers: DownloadInstaller[];
}

/** Textes des boutons d'une ligne. */
export interface DownloadRowLabels {
  pause?: string;
  resume?: string;
  retry?: string;
  cancel?: string;
  remove?: string;
  reveal?: string;
  start?: string;
}

/** Avancement d'une installation, déjà rédigé ; `percent` absent : barre indéterminée. */
export interface AppProgress {
  text: string;
  percent: number | null;
}

/** Une console d'un émulateur ; `picked` : cochée pour RetroArch. */
export interface AppSystem {
  id: string;
  name: string;
  installed: boolean;
  picked: boolean;
}

/** Une carte d'émulateur. */
export interface AppEmulator {
  id: string;
  name: string;
  desc: string;
  status: string;
  installed: boolean;
  retroarch: boolean;
  systems: AppSystem[];
  /** Texte de l'accessibilité de la liste des consoles. */
  systemsLabel: string;
  progress: AppProgress | null;
  /** Bouton principal : installer, mettre à jour, ajouter des consoles (RetroArch). */
  install: { label: string; disabled: boolean; primary: boolean };
  /** Désinstaller : seulement s'il est installé. */
  uninstall: { label: string; disabled: boolean } | null;
  /** Rappel des BIOS : texte, fichiers présents, dossier. */
  bios: { hint: string; files: string; dir: string } | null;
}

/** Une carte de jeu libre ; `ready` : sa console est installée. */
export interface AppGame {
  id: string;
  name: string;
  meta: string;
  desc: string;
  monogram: string;
  /** Teinte de la vignette (couleur du système). */
  color: string;
  installed: boolean;
  ready: boolean;
  /** Texte d'état, quand il n'y a pas de bouton (déjà dans la ludothèque, console manquante). */
  status: string;
  busy: boolean;
  progress: AppProgress | null;
}

/** L'onglet des apps. */
export interface AppsView {
  root: string;
  unavailable: boolean;
  emulators: AppEmulator[];
  games: AppGame[];
  /** Au moins une console a un dossier de jeux : l'import est possible. */
  canImport: boolean;
}

/** Une carte de l'onglet des consoles (P4-17) : textes déjà rédigés. */
export interface ConsoleCard {
  id: string;
  name: string;
  /** Système et nombre de dossiers de jeux. */
  meta: string;
  /** Émulateur qui lance les jeux : le sien, ou celui d'une autre console du même système. */
  emulator: string;
  /** Console installée par les apps du Centre (et non créée à la main). */
  store: boolean;
}

/** Textes du Centre (hors lignes et cartes, déjà rédigées). */
export interface CentreLabels {
  tabs?: string;
  tabDownloads?: string;
  tabApps?: string;
  tabConsoles?: string;
  consolesHelp?: string;
  newConsole?: string;
  noConsoles?: string;
  editConsole?: string;
  chooseEmulator?: string;
  openSites?: string;
  removeConsole?: string;
  fromApps?: string;
  add?: string;
  torrent?: string;
  hint?: string;
  running?: string;
  others?: string;
  noneRunning?: string;
  noneOthers?: string;
  clear?: string;
  loading?: string;
  root?: string;
  changeRoot?: string;
  unavailable?: string;
  emulators?: string;
  emulatorsHelp?: string;
  systemAdded?: string;
  biosTitle?: string;
  biosAdd?: string;
  biosOpen?: string;
  games?: string;
  gamesHelp?: string;
  gamesNone?: string;
  download?: string;
  own?: string;
  ownHelp?: string;
  import?: string;
  noConsole?: string;
}

/** Arguments d'une action qui désigne un téléchargement, un émulateur ou un jeu par son identifiant. */
export const idArgs = (id: string): string => JSON.stringify([{ id }]);

/** Arguments de « Lancer le programme d'installation ». */
export const installerArgs = (id: string, file: string): string => JSON.stringify([{ id, file }]);
