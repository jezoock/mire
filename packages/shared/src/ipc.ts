/**
 * Contrat IPC entre l'interface (renderer) et le processus principal, décrit une seule fois :
 * - `IPC_METHODS` : méthode de `window.api` → canal `ipcRenderer.invoke` / `ipcMain.handle` ;
 * - `IPC_EVENTS` : abonnement `window.api.onX` → canal des messages envoyés par le processus principal ;
 * - `IpcMethods` et `IpcEvents` : arguments et résultats de chaque méthode, contenu de chaque événement.
 * Le preload construit `window.api` à partir de ces tables (`createApi`) ; le processus principal y enregistre
 * ses implémentations. Les noms sont ceux de l'interface d'origine : ne pas les renommer sans migrer le renderer.
 *
 * Les canaux synchrones du preload des sites (`mire:scriptlets`, `mire:signin-ua`) ne passent pas par ce contrat.
 */

import type { Bookmark, Config, ConsoleRef, GameBookmark, LinkSite } from './config.ts';
import type { Element, ElementImages, InfoChanges, TagChanges, TagSummary } from './element.ts';
import type { TagLookChanges, TagOverview } from './tags.ts';
import type {
  CatalogGroup,
  GroupEdit,
  GroupFetchResult,
  PageDefinition,
  PageLevel,
  PageOverview,
  PagePath,
  PagePreview,
  PageSaveResult,
  PagesChange,
} from './pages.ts';
import type { ListsChange, ListSummary, ListView } from './lists.ts';
import type { SearchOptions, SearchResult } from './search.ts';
import type { CatalogSources, FolderLevel } from './browse.ts';
import type { Catalog, CatalogMeta } from './i18n/types.ts';
import type { RescueRequest } from './rescue.ts';

// Types de la configuration, exposés aussi par le contrat sous leurs noms d'origine.
export type { Bookmark, ConsoleRef, GameBookmark };

/* ------------------------------------------------------------------ */
/* Données échangées                                                   */
/* ------------------------------------------------------------------ */

// Structures décrites par le processus principal ; leurs types détaillés viendront avec les modules qui les
// possèdent (bibliothèque : P1-14…). En attendant, elles restent opaques.
/** Configuration complète (config.json), voir src/main/config/. */
export type MireConfig = Config;
/** Fichier de la bibliothèque (vidéo, musique, image…). */
export type MediaItem = Record<string, unknown>;
/** État d'une vue web publié vers l'interface. */
export type WebState = Record<string, unknown>;
/** Téléchargement suivi par le gestionnaire. */
export type DownloadItem = Record<string, unknown>;
/** Fiche de métadonnées saisie par l'utilisateur (meta.json). */
export type UserMeta = Record<string, unknown>;

/** Échec : message à afficher, ou boîte de dialogue annulée. Toute méthode peut le renvoyer (erreur inattendue). */
export interface Failure {
  ok: false;
  error?: string;
  canceled?: boolean;
}
/** Réussite (avec des données) ou échec. */
export type Outcome<T extends object = object> = ({ ok: true } & T) | Failure;

/** Système de jeu tel que le reçoit l'interface : identifiant libretro et nom court. */
export interface GameSystemInfo {
  id: string;
  name: string;
}

/** Jeu à supprimer (bouton « Supprimer » d'une fiche de jeu). */
export interface GameRef {
  kind: 'game' | 'rom';
  /** Jeu PC ajouté à la main : position dans `config.games`. */
  manualIndex?: number | null;
  /** Jeu de console : fichier à supprimer et console qui le possède. */
  path?: string;
  consoleId?: string;
}

/** Contexte d'un téléchargement : console de destination, nom affiché… */
/** Console créée ou modifiée à la main (P4-17) : dossiers, émulateur, arguments et sites de jeux. */
export interface ConsoleInput {
  name: string;
  /** Système du référentiel (`gameSystems`), pour les jaquettes et l'émulateur partagé ; vide : deviné. */
  system?: string;
  /** Programme de l'émulateur. */
  path: string;
  /** Arguments ; `{rom}` est remplacé par le chemin du jeu. */
  args?: string[];
  /** Dossier principal des jeux (téléchargements et imports). */
  romsDir?: string;
  /** Autres dossiers, partages ou adresses web de jeux. */
  sources?: string[];
  extensions?: string[];
  /** Sites de jeux propres à la console ; `null` : ceux que Mire propose ; absent : inchangés. */
  romSites?: LinkSite[] | null;
}

/** Un émulateur proposé pour une console ou un jeu (D-21) : celui d'une console du même système. */
export interface EmulatorChoice {
  /** Identifiant de la console dont l'émulateur est proposé. */
  id: string;
  /** Nom de l'émulateur (celui de la boutique, sinon celui du programme). */
  emulator: string;
  /** Nom de cette console. */
  console: string;
}

/** Émulateurs d'un jeu désigné par sa clé : ceux proposés, celui de sa console et celui choisi pour lui. */
export interface GameEmulators {
  /** Console du jeu. */
  console: string;
  choices: EmulatorChoice[];
  /** Émulateur choisi pour la console (identifiant d'une console) ; `null` : le sien. */
  consoleDefault: string | null;
  /** Émulateur choisi pour ce jeu ; `null` : celui de la console. */
  game: string | null;
}

export interface DownloadContext {
  /** Identifiant de la console de destination. */
  console?: string;
  name?: string;
  [key: string]: unknown;
}

export interface BookmarkInput {
  url: string;
  title: string;
  type?: 'movie' | 'tv';
  season?: number | string | null;
  episode?: number | string | null;
  year?: string;
}

export interface GameBookmarkInput {
  source: string;
  title?: string;
  console?: ConsoleRef | null;
}

export interface CleanupReport {
  missingLocal: string[];
  missingRemote: string[];
  removedManual: number;
  checked: number;
  config?: MireConfig;
}

export interface WebSession {
  id: string;
  name: string;
  color?: string;
}

/** Entrée de « Reprendre » : ce qu'il faut pour afficher la vignette et rouvrir le fichier. */
export interface RecentEntry {
  path: string;
  name: string | null;
  kind: string | null;
  ext: string | null;
  cover: string | null;
  fanart: string | null;
  native: boolean | null;
  folder: string | null;
  dir: string | null;
  remote: boolean | null;
  /** Clé de l'élément (`local:…`, `remote:…`), tirée du chemin ; `null` pour ce qui n'est ni un fichier ni une adresse web. */
  key: string | null;
}

/** Données d'usage (usage.json) : « Reprendre », positions de reprise des vidéos, volume, recherches récentes. */
export interface UsageData {
  recent: RecentEntry[];
  /**
   * Position de reprise (secondes entières) par clé d'élément (`local:…`, `remote:…`) ; par chemin pour ce qui n'a
   * pas de clé. Le contrat IPC reste par chemin : le service en tire la clé.
   */
  resume: Record<string, number>;
  volume: number;
  queries: string[];
}

/** Ce que l'interface lit au démarrage (les positions de reprise se demandent vidéo par vidéo). */
export type UsageSnapshot = Pick<UsageData, 'recent' | 'volume' | 'queries'>;

/** Données d'usage encore dans le `localStorage` d'une version précédente (reprises une seule fois). */
export interface LegacyUsage {
  recent?: unknown;
  resume?: Record<string, unknown>;
  volume?: unknown;
  queries?: unknown;
}

/** Langue de l'interface : réglage, langue retenue, langues disponibles et catalogues à consulter. */
export interface LanguageInfo {
  /** Valeur de `ui.language` (`auto` ou un code BCP 47). */
  setting: string;
  /** Langue retenue, toujours une langue disponible. */
  language: string;
  /** Langues disponibles : code et nom dans la langue. */
  available: Pick<CatalogMeta, 'code' | 'name'>[];
  /** Catalogues de la langue retenue puis des langues de repli, dans l'ordre de consultation. */
  catalogs: Record<string, Catalog>;
}

/** Un plugin trouvé par l'hôte de plugins (P3-03) : ce que le futur Centre (P4-18) affiche. */
export interface PluginSummary {
  id: string;
  /** Version (`null` : manifeste illisible d'un plugin inclus). */
  version: string | null;
  /** `bundled` : livré avec Mire (`resources/plugins/`) ; `installed` : `userData/plugins/`. */
  origin: 'bundled' | 'installed';
  /** Plugin installé : dépôt qui l'a installé (`official` : dépôt officiel), `null` sinon (P3-07). */
  repository: string | null;
  /** Confiance (P3-08) : livré avec Mire, dépôt officiel, dépôt tiers, ou installé à la main (`local`). */
  trust: PluginTrust;
  /** Niveau de sécurité (D-18), `null` si le manifeste est illisible. */
  level: 'data' | 'code' | 'privileged' | null;
  /** Permissions demandées par le manifeste (`permissions`), vide s'il est illisible. */
  permissions: Record<string, unknown>;
  /** Dépendances déclarées par le manifeste (identifiant → versions acceptées), vide s'il est illisible (P4-19). */
  dependencies: Record<string, string>;
  /** Nom affiché (textes du plugin), ou l'identifiant. */
  name: string;
  /** Voulu actif (état mémorisé). */
  enabled: boolean;
  /** `active` ; `disabled` à la demande ; `fault` : désactivé par une erreur ; `refused` : invalide ou incompatible. */
  status: 'active' | 'disabled' | 'fault' | 'refused';
  /** Raison du refus ou de la désactivation, dans la langue de l'interface. */
  message: string | null;
  contributions: { kind: string; id: string }[];
  /** Le changement prendra effet au prochain démarrage de Mire. */
  restartRequired: boolean;
}

/** Niveau de confiance de l'origine d'un plugin (P3-08). */
export type PluginTrust = 'bundled' | 'official' | 'third-party' | 'local';

/** Dépôt de plugins configuré et état de son index (P3-07 ; le Centre, P4-18). */
export interface RepositoryInfo {
  id: string;
  official: boolean;
  trust: 'official' | 'third-party';
  /** Adresse de l'index. */
  index: string;
  /** Empreinte de la clé du dépôt (64 caractères hexadécimaux), à montrer pour vérification. */
  fingerprint: string;
  /** Nom du dépôt dans la langue de l'interface (index), ou son identifiant. */
  name: string;
  /** Date de publication de l'index utilisé, `null` s'il n'y en a pas encore (jamais lu, même en cache). */
  generated: string | null;
  /** Dernière lecture réussie de l'index en ligne pendant cette session (ms), sinon `null`. */
  checkedAt: number | null;
  /** Erreur de la dernière mise à jour (le cache sert alors) : code stable et message, ou `null`. */
  error: string | null;
  message: string | null;
}

/** Plugin proposé par un dépôt (P3-07), tel que l'index vérifié le décrit. */
export interface AvailablePlugin {
  id: string;
  /** Dépôt qui le propose (`official` : dépôt officiel). */
  repository: string;
  official: boolean;
  name: string;
  description: string | null;
  /** Plus récente version compatible avec cette version de Mire, `null` s'il n'y en a aucune. */
  version: string | null;
  /** Plus récente version publiée. */
  latest: string;
  level: 'data' | 'code' | 'privileged';
  permissions: Record<string, unknown>;
  dependencies: Record<string, string>;
  contributes: string[];
  /** Taille du paquet (octets). */
  size: number;
  /** Version installée (ou incluse), `null` sinon. */
  installed: string | null;
  /** Version plus récente compatible proposée (par ce dépôt, s'il l'a installé), `null` sinon. */
  update: string | null;
  trust: 'official' | 'third-party';
  /** Plugin tiers de code sensible (P3-08) : avertissement renforcé et accord nécessaire avant de l'installer. */
  sensitive: boolean;
  /** Accord déjà donné pour la version montrée (toujours vrai si l'accord n'est pas nécessaire). */
  consented: boolean;
  /** Déjà installé depuis un autre dépôt (ou livré avec Mire) : ce dépôt ne peut ni l'installer ni le mettre à jour. */
  conflict: boolean;
}

/** Ce que l'utilisateur doit accepter pour une version d'un plugin tiers de code sensible (P3-08). */
export interface PluginConsentRequest {
  plugin: string;
  repository: string;
  version: string;
  level: 'data' | 'code' | 'privileged';
  permissions: Record<string, unknown>;
}

/**
 * Résultat d'une installation ou d'une mise à jour : les plugins après coup, ou l'erreur (code stable et message).
 * Code `consent` : les versions à faire accepter (`pluginsConsent`), plugin par plugin.
 */
export type PluginsOutcome = { ok: true; plugins: PluginSummary[] } | { ok: false; code: string; error: string; consent?: PluginConsentRequest[] };

/** Dépôt tiers vérifié (P3-08) : ce que l'interface montre avant de l'ajouter. */
export interface RepositoryPreview {
  id: string;
  index: string;
  /** Empreinte de la clé fournie : l'utilisateur la compare à celle que publie le dépôt. */
  fingerprint: string;
  name: string;
  /** Nombre de plugins proposés, et de plugins de code sensible parmi eux. */
  plugins: number;
  sensitive: number;
}

/** Résultat de la vérification ou de l'ajout d'un dépôt tiers. */
export type RepositoryOutcome = { ok: true; repository: RepositoryPreview; repositories: RepositoryInfo[] } | { ok: false; code: string; error: string };

/** Résultat du retrait d'un dépôt tiers : plugins désinstallés, et ceux gardés parce qu'un autre plugin en a besoin. */
export type RepositoryRemoveOutcome =
  { ok: true; uninstalled: string[]; kept: { id: string; by: string[] }[]; repositories: RepositoryInfo[] } | { ok: false; code: string; error: string };

/**
 * Continuité (P5-01) : plugin qui reprend une fonction qu'une installation existante utilisait. `installed` : activé
 * (plugin inclus) ou installé ; `pending` : à installer dès que la connexion le permet ; `failed` : impossible, avec la raison.
 */
export interface ContinuityItem {
  plugin: string;
  /** Nom du plugin dans la langue de l'interface, sinon son identifiant. */
  name: string;
  /** Livré avec Mire (activé) plutôt qu'installé depuis le dépôt officiel. */
  bundled: boolean;
  status: 'installed' | 'pending' | 'failed';
  reason: string | null;
}

/** Récapitulatif de la continuité ; `notice` : message à montrer (ce qui a changé depuis le dernier vu), ou `null`. */
export interface ContinuitySummary {
  items: ContinuityItem[];
  notice: string | null;
}

/** Résultat d'une désinstallation : refusée si un autre plugin en a besoin, ou s'il est livré avec Mire. */
export type UninstallOutcome =
  | { ok: true; keptData: boolean; restored: PluginSummary | null }
  | { ok: false; code: 'needed'; by: string[]; message: string }
  | { ok: false; code: 'bundled'; message: string };

/**
 * Avancement d'une installation depuis un dépôt (P3-07) : des données, que l'interface rédige (P4-18). `id` est le
 * plugin demandé, `plugin` celui en cours (une dépendance, ou lui-même) ; `message` est l'erreur, déjà rédigée.
 */
export interface PluginsProgress {
  id: string;
  phase: 'resolve' | 'download' | 'verify' | 'install' | 'done' | 'error';
  plugin?: string;
  version?: string;
  received?: number;
  total?: number;
  message?: string;
}

/** Réglages d'un plugin, pour l'écran Réglages (P4-20) : ses déclarations (manifeste) et ses valeurs. */
export interface PluginSettingsInfo {
  id: string;
  /** Nom affiché (textes du plugin), ou l'identifiant. */
  name: string;
  /** Réglages déclarés ; libellés : `settings.<key>.label` dans les textes du plugin. */
  settings: {
    key: string;
    type: 'text' | 'secret' | 'choice' | 'toggle' | 'path' | 'list';
    default?: string | number | boolean | string[];
    options?: string[];
  }[];
  /** Valeurs (changées, sinon par défaut), sans celles des secrets. */
  values: Record<string, string | number | boolean | string[]>;
  /** Réglages secrets déjà saisis : leur valeur ne quitte jamais le processus principal. */
  secrets: string[];
}

/** Fournisseur d'infos en ligne d'un plugin actif (contribution `metadata`), pour l'ordre des fournisseurs (P4-20). */
export interface PluginMetadataProvider {
  /** `<plugin>/<contribution>`, en minuscules : la clé de ses fiches et de `catalog.metadataProviders`. */
  id: string;
  plugin: string;
  /** Nom du plugin (textes du plugin), ou son identifiant. */
  name: string;
  /** Natures d'éléments décrites (`video`, `album`, `rom`, `pc`). */
  kinds: string[];
}

/** Bouton d'une manette qui porte un libellé dans l'aide des commandes. */
export type GamepadGlyphButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'select';

/**
 * Profil de manette d'un plugin actif (contribution `gamepads`, P5-04), vérifié par le processus principal : motifs
 * de l'identifiant annoncé par la manette (expressions bornées, à compiler sans distinction de casse ; une expression
 * invalide est ignorée), priorité (la plus petite d'abord), libellés des boutons (un symbole court, ou une clé des
 * catalogues `pluginTexts.…`), et clé du nom de la famille.
 */
export interface GamepadProfile {
  /** `<plugin>/<contribution>`. */
  id: string;
  /** Clé des catalogues du nom de la famille (`pluginTexts.<plugin>.gamepads.<contribution>.name`). */
  name: string;
  match: string[];
  priority: number;
  glyphs: Partial<Record<GamepadGlyphButton, string>>;
}

/**
 * Lecteur externe d'un plugin actif (contribution `apps` de genre `player`, P5-20) : ce que l'interface en montre. Le
 * programme et ses arguments restent dans le processus principal.
 */
export interface ExternalPlayerInfo {
  /** `<plugin>/<contribution>`. */
  id: string;
  /** Clé des catalogues du nom du lecteur (`pluginTexts.<plugin>.apps.<contribution>.name`). */
  name: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Méthodes                                                            */
/* ------------------------------------------------------------------ */

/** Signature de chaque méthode de `window.api`, côté processus principal (le renderer reçoit une promesse). */
export interface IpcMethods {
  // Configuration
  getConfig(): { config: MireConfig; configPath: string; platform: string };
  saveConfig(next: MireConfig): MireConfig;
  revealConfig(): boolean;
  configExport(): Outcome<{ path: string }>;
  configImport(mode?: 'replace' | 'merge'): Outcome<{ config: MireConfig; usage: UsageSnapshot }>;

  // Données d'usage : « Reprendre », positions de reprise, volume, recherches récentes
  usageGet(): UsageSnapshot;
  usageMigrate(legacy: LegacyUsage): UsageSnapshot;
  usageAddRecent(entry: RecentEntry): RecentEntry[];
  usageRemoveRecent(path: string): RecentEntry[];
  usageResume(path: string): number;
  usageSaveResume(path: string, time: number, duration: number): boolean;
  usageClearResume(path: string): boolean;
  usageSetVolume(volume: number): number;
  usageAddQuery(query: string): string[];
  usageClearQueries(): boolean;

  // Bibliothèque et fichiers
  scanLibrary(): { items: MediaItem[]; status: unknown[] };
  subtitles(videoPath: string): unknown[];
  openMediaDialog(): MediaItem[];
  fromPaths(paths: string[]): MediaItem[];
  takePendingFiles(): MediaItem[];
  checkLocation(location: string): { ok: boolean; error?: string | null };
  pickFolder(): string | null;
  pickFile(kind?: string): string | null;

  // Lecteur externe et télévision
  playExternal(target: string, title?: string, start?: number): Outcome;
  /** Lecteurs externes des plugins actifs (P5-20) ; vide : pas de lecteur externe, son bouton disparaît. */
  externalPlayers(): ExternalPlayerInfo[];
  tvChannels(): Outcome<Record<string, unknown>>;
  /** Regarde une chaîne du service choisi, désignée par sa clé d'élément : la variante est choisie par le service. */
  tvWatch(key: string): Outcome;
  tvDetect(): { id: string; name: string };
  tvSetActive(id: string): MireConfig;

  // Vues web
  webOpen(id: string, url?: string | null, opts?: { site?: number }): Outcome<{ integrated: boolean; state?: WebState | null }>;
  webShow(id: string, bounds?: Bounds, focus?: boolean): Outcome<{ state: WebState | null }>;
  webHide(): unknown;
  webBounds(bounds: Bounds): boolean;
  webNav(action: string): boolean;
  webClose(id: string): boolean;
  webFocus(): boolean;
  webKey(name: string): boolean;
  webLearnSearch(id: string): Outcome<{ template: string; config: MireConfig }>;
  webSessions(): WebSession[];

  // Sites de jeux et marque-pages
  romSites(console: ConsoleRef): { sites: unknown[]; custom: boolean; defaults: unknown[] };
  romDownload(console: string, url: string): Outcome<{ count: number; total?: number }>;
  /** Systèmes de jeu connus (référentiel de @mire/shared), pour le choix du système d'une console. */
  gameSystems(): GameSystemInfo[];
  bookmarkAdd(data: BookmarkInput): Outcome<{ bookmark: Bookmark; scraped: boolean; config: MireConfig }>;
  bookmarkRemove(id: string): Outcome<{ config: MireConfig }>;
  bookmarkOpen(id: string): unknown;
  gameBookmarkAdd(data: GameBookmarkInput): Outcome<{ bookmark: GameBookmark; needSystem: boolean; scraped: boolean; config: MireConfig }>;
  gameBookmarkSetConsole(id: string, console: ConsoleRef): Outcome<{ scraped: boolean; config: MireConfig }>;
  gameBookmarkRemove(id: string): Outcome<{ config: MireConfig }>;
  gameBookmarkDownload(id: string): Outcome;
  romListSource(console: string, only?: string): Outcome<Record<string, unknown>>;
  gameDelete(ref: GameRef): Outcome<{ config?: MireConfig }>;
  gamesCleanup(online?: boolean): Outcome<CleanupReport>;

  // Téléchargements
  downloadsList(): { items: DownloadItem[]; settings: Record<string, unknown> };
  downloadsAddUrl(url: string, ctx?: DownloadContext): unknown;
  downloadsAddTorrentFile(ctx?: DownloadContext): unknown;
  downloadsPause(id: string): unknown;
  downloadsResume(id: string): unknown;
  downloadsCancel(id: string, removeFiles?: boolean): unknown;
  downloadsRemove(id: string): unknown;
  downloadsClear(): unknown;
  downloadsReveal(id: string): unknown;
  downloadsRunInstaller(id: string, file?: string): unknown;
  downloadsPickDir(): string | null;

  // Boutique : BIOS
  biosAdd(id: string): unknown;
  biosOpen(id: string): Outcome;

  // DRM et bloqueur de publicités
  drmStatus(): { ecs: boolean; platform: string; widevine?: { status: unknown; version: unknown } | null };
  adblockStatus(): Record<string, unknown> | null;
  adblockSetEnabled(on: boolean): unknown;
  adblockToggleSite(): Record<string, unknown> | null;
  adblockSetLists(lists: Record<string, unknown>): unknown;
  adblockUpdate(): Record<string, unknown>;

  // « Où regarder » : recherche d'un plugin (P5-15), rapprochée des sites de streaming configurés. `reason: 'noprovider'` :
  // aucun plugin ne répond ; `setup` : réglage du plugin `plugin` à remplir (une clé) ; `attribution` : texte du plugin.
  searchStreaming(query: string): {
    ok: boolean;
    plugin?: string;
    results?: unknown[];
    attribution?: string;
    reason?: string;
    error?: string;
    setup?: string;
  };

  // Jeux
  scanGameSources(): { games: unknown[]; status: Record<string, unknown> };
  launchGamePath(target: string): Outcome;

  // Métadonnées saisies à la main
  metaAll(): Record<string, UserMeta>;
  metaSet(key: string, patch: UserMeta): UserMeta | null;
  metaPickImage(key: string, field: 'image' | 'backdrop'): UserMeta | null;
  metaReset(key: string): boolean;

  // Récupération d'infos (scraping)
  scrapeData(): Record<string, unknown>;
  scrapeRun(opts?: Record<string, unknown>): unknown;
  scrapeOne(job?: Record<string, unknown>): unknown;
  scrapeCandidates(job?: Record<string, unknown>): unknown;
  pickImageFile(title?: string): string | null;
  scrapeCancel(): unknown;
  scrapeForget(key: string): unknown;
  scrapeClear(): unknown;

  // Boutique
  storeCatalog(): unknown;
  storeInstall(id: string, systems?: unknown): unknown;
  storeUninstall(id: string): unknown;
  storeGame(id: string): unknown;
  storeImport(console: string): Outcome<{ count?: number }>;
  storePickRoot(): MireConfig | null;

  // Lancement des jeux
  launchGame(index: number): Outcome;
  addGame(): MireConfig | null;
  listRoms(console: string, opts?: { online?: boolean; only?: string }): Outcome<Record<string, unknown>>;
  /** `emulator` : identifiant d'une console du même système dont l'émulateur lance ce jeu, pour cette fois (D-21). */
  launchRom(console: string, romPath: string, emulator?: string): Outcome;

  // Consoles et émulateurs (P4-17) : jeux désignés par leur clé d'élément
  consoleSave(input: ConsoleInput, id?: string): Outcome<{ id: string; config: MireConfig }>;
  consoleRemove(id: string): Outcome<{ config: MireConfig }>;
  consoleEmulators(id: string): EmulatorChoice[];
  consoleSetEmulator(id: string, emulator: string | null): Outcome<{ config: MireConfig }>;
  gameEmulators(key: string): Outcome<GameEmulators>;
  gameSetEmulator(key: string, emulator: string | null): Outcome<{ config: MireConfig }>;
  gameLaunch(key: string, emulator?: string): Outcome;
  gameDeleteElement(key: string): Outcome<{ config?: MireConfig }>;

  // Langue de l'interface et catalogues de textes
  i18nGet(): LanguageInfo;

  // Catalogue d'éléments (P2-01) : `catalog.element(key)` de l'architecture cible
  catalogElement(key: string): Element | null;
  // Moteur de tags et d'infos (P2-04) : `catalog.setTags`, `catalog.setInfos`, `tags.list`. Rendent l'élément
  // modifié (ou `null` s'il n'est pas dans le catalogue : la modification est gardée).
  catalogSetTags(key: string, changes: TagChanges): Element | null;
  catalogSetInfos(key: string, changes: InfoChanges): Element | null;
  tagsList(): TagSummary[];
  // Administration des tags (P4-21) : tags avec leur apparence et qui les pose ; renommer, fusionner dans un autre tag
  // ou supprimer un tag de l'utilisateur (faux / `null` pour un autre tag ou une valeur qui ne convient pas) ; couleur
  // et icône d'un tag connu, choisies dans `TAG_COLORS` et `TAG_ICONS` (`null` : aucune).
  tagsOverview(): TagOverview[];
  tagsRename(id: string, name: string): boolean;
  tagsMerge(from: string, into: string): number | null;
  tagsRemove(id: string): boolean;
  tagsSetLook(id: string, look: TagLookChanges): boolean;
  // Éditeurs (P4-22) : image d'un élément choisie sur le disque (`null` : abandon, élément ou image inconnus), images
  // effacées (retour à l'automatique), réinitialisation (tags, infos et images reviennent à l'automatique).
  catalogPickImage(key: string, field: keyof ElementImages): Element | null;
  catalogClearImages(key: string, fields: (keyof ElementImages)[]): Element | null;
  catalogReset(key: string): Element | null;
  // Éditeurs des regroupements (P4-22) : un regroupement d'une page désigné par son chemin (`null` : page, chemin ou
  // regroupement inconnus) ; une modification qui vaut pour tous ses éléments (rend le regroupement à son nouveau
  // chemin, `null` s'il a disparu) ; une image choisie sur le disque ; une fiche choisie en ligne (`job` : demande
  // de `scrapeCandidates` et fiche choisie), dont les images sont posées sur les éléments et les infos proposées.
  catalogGroup(pageId: string, path: PagePath): CatalogGroup | null;
  catalogEditGroup(pageId: string, path: PagePath, edit: GroupEdit): CatalogGroup | null;
  catalogGroupPickImage(pageId: string, path: PagePath, field: keyof ElementImages): CatalogGroup | null;
  catalogGroupFetch(pageId: string, path: PagePath, job: Record<string, unknown>): GroupFetchResult;
  // Pages et regroupements (P2-07) : `pages.*` et `catalog.page(pageId, path, cursor)` de l'architecture cible.
  pagesList(): PageDefinition[];
  pagesGet(id: string): PageDefinition | null;
  pagesSave(page: PageDefinition): PageSaveResult;
  pagesRemove(id: string): boolean;
  // Administration des pages (P4-21) : pages avec leur origine et leur nombre d'éléments ; nombre d'éléments d'une
  // définition non enregistrée (aperçu) ; retour à la page prête à l'emploi d'origine (`null` : pas une telle page).
  pagesOverview(): PageOverview[];
  pagesPreview(page: PageDefinition): PagePreview;
  pagesReset(id: string): PageDefinition | null;
  // Un niveau d'une page (regroupements ou éléments), par tranches ; `null` : page inconnue ou chemin invalide.
  // `pageId` `list:<id>` : les éléments d'une liste, dans son ordre (P2-08) ; `tag:<id>` : les éléments d'un tag, par
  // nom (explorateur, P4-08).
  catalogPage(pageId: string, path?: PagePath, cursor?: string | null): PageLevel | null;
  // Parcours par source et par dossier (explorateur, P4-08) : les sources du catalogue et les dossiers autorisés ;
  // un dossier désigné par sa source (identifiant de `catalogSources`) et un chemin relatif (`''` : la source), par
  // tranches. `null` : source inconnue, chemin refusé (`..`, lien qui sort de la source) ou dossier sans élément.
  catalogSources(): CatalogSources;
  catalogFolder(source: string, path?: string, cursor?: string | null): FolderLevel | null;
  // Listes (P2-08) : `lists.*` de l'architecture cible. `null` / `false` : liste inconnue ou valeur invalide.
  listsList(): ListSummary[];
  listsGet(id: string): ListView | null;
  listsCreate(name: string | { key: string }): ListSummary | null;
  listsRename(id: string, name: string | { key: string }): boolean;
  listsRemove(id: string): boolean;
  // Nouvel ordre des listes (P4-21) : `ids` d'abord, puis les autres ; faux si un identifiant est inconnu ou en double.
  listsReorder(ids: string[]): boolean;
  // Rendent le nombre d'éléments ajoutés ou retirés.
  listsAdd(id: string, keys: string[], at?: number): number | null;
  listsRemoveItems(id: string, keys: string[]): number | null;
  listsMove(id: string, key: string, to: number): boolean;
  // Recherche dans le catalogue (P2-09) : noms, infos texte et noms des tags, résultats groupés par page.
  catalogSearch(query: string, options?: SearchOptions): SearchResult;
  // Gestion des fichiers (P2-10) : `files.*` de l'architecture cible, seulement sous les dossiers locaux de la
  // configuration ; la confirmation est demandée par l'interface (P4-09). Rendent le nouveau chemin (ou le chemin
  // mis à la corbeille), ou l'erreur à afficher.
  filesRename(path: string, name: string): Outcome<{ path: string }>;
  filesMove(path: string, folder: string): Outcome<{ path: string }>;
  filesRemove(path: string): Outcome<{ path: string }>;
  // Contrôle sans rien changer (explorateur, P4-09) : pour chaque chemin, `null` si le service peut agir dessus, sinon
  // la raison à afficher. `null` en entier : la valeur n'est pas une liste d'au plus 500 chemins.
  filesCheck(paths: string[]): (string | null)[] | null;
  // Plugins (P3-03) : plugins trouvés et leur état ; activer ou désactiver (à chaud quand c'est possible). `null` :
  // plugin inconnu.
  pluginsList(): PluginSummary[];
  pluginsSetEnabled(id: string, enabled: boolean): PluginSummary | null;
  // Réglages des plugins (P4-20) : ceux que déclarent les manifestes, et en changer un (`null` : valeur par défaut).
  // Rend les réglages du plugin, ou l'erreur à afficher (valeur refusée) ; jamais la valeur d'un secret.
  pluginsSettings(): PluginSettingsInfo[];
  pluginsSetSetting(id: string, key: string, value: unknown): Outcome<{ plugin: PluginSettingsInfo }>;
  // Fournisseurs d'infos des plugins actifs (P4-20) : ils rejoignent l'ordre des fournisseurs des Réglages.
  pluginsMetadataProviders(): PluginMetadataProvider[];
  // Profils de manettes des plugins actifs (P5-04) ; sans eux, le cœur garde son profil générique.
  gamepadsProfiles(): GamepadProfile[];
  // Dépôts (P3-07) : dépôts et état de leur index (sans réseau, ou après mise à jour), plugins proposés.
  reposList(): RepositoryInfo[];
  reposRefresh(): RepositoryInfo[];
  reposPlugins(): AvailablePlugin[];
  // Dépôts tiers (P3-08) : vérifier un dépôt (adresse `https:` de l'index, clé publique PEM ed25519) et montrer
  // l'empreinte de sa clé ; l'ajouter avec l'empreinte que l'utilisateur a vue ; le retirer en gardant ses plugins
  // (sans mise à jour) ou en les désinstallant. `null` : arguments refusés.
  reposInspect(index: string, publicKey: string): RepositoryOutcome | null;
  reposAdd(index: string, publicKey: string, fingerprint: string): RepositoryOutcome | null;
  reposRemove(id: string, uninstall: boolean, keepData: boolean): RepositoryRemoveOutcome | null;
  // Installe un plugin des dépôts (une version, ou la plus récente compatible ; depuis un dépôt, ou celui par défaut)
  // avec ses dépendances ; met à jour un plugin installé depuis son dépôt ; désinstalle (en gardant ou non ses
  // données). `null` : arguments refusés (plugin inconnu…).
  pluginsInstall(id: string, version?: string, repository?: string): PluginsOutcome | null;
  // Accord pour une version d'un plugin tiers de code sensible, après l'avertissement renforcé (P3-08) ; rend ce qui a
  // été accepté, `null` si rien n'était à accepter ou si les arguments sont refusés.
  pluginsConsent(id: string, repository: string, version: string): PluginConsentRequest | null;
  pluginsUpdate(id: string): PluginsOutcome | null;
  pluginsUninstall(id: string, keepData: boolean): UninstallOutcome | null;
  // Continuité (P5-01) : fonctions devenues des plugins (activés, installés, en attente, impossibles) ; récapitulatif
  // montré (son message ne revient plus jusqu'au prochain changement).
  pluginsContinuity(): ContinuitySummary;
  pluginsContinuitySeen(): boolean;

  // Fenêtre et application
  toggleFullscreen(): boolean;
  quit(): boolean;

  // Mode secours (P4-10) : premier écran demandé au démarrage (option, touche maintenue, plantages), lu une fois ;
  // thème affiché sans souci (les plantages précédents ne comptent plus).
  rescueStart(): RescueRequest | null;
  rescueThemeOk(): boolean;
}

export type IpcMethodName = keyof IpcMethods;
export type IpcArgs<K extends IpcMethodName> = Parameters<IpcMethods[K]>;
export type IpcResult<K extends IpcMethodName> = ReturnType<IpcMethods[K]>;

/** Méthode de `window.api` → canal IPC. L'ordre est celui de l'ancien preload. */
export const IPC_METHODS = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  revealConfig: 'config:reveal',

  scanLibrary: 'library:scan',
  subtitles: 'media:subtitles',
  openMediaDialog: 'media:openDialog',
  fromPaths: 'media:fromPaths',
  takePendingFiles: 'app:pendingFiles',

  pickFolder: 'dialog:folder',
  pickFile: 'dialog:file',

  playExternal: 'player:external',
  externalPlayers: 'player:externalList',
  tvChannels: 'tv:channels',

  webOpen: 'web:open',
  webShow: 'web:show',
  webHide: 'web:hide',
  webBounds: 'web:bounds',
  webNav: 'web:nav',
  webClose: 'web:close',
  webFocus: 'web:focus',
  webKey: 'web:key',
  webLearnSearch: 'web:learnSearch',
  webSessions: 'web:sessions',
  romSites: 'roms:sites',
  romDownload: 'roms:download',
  gameSystems: 'games:systems',
  bookmarkAdd: 'bookmarks:add',
  bookmarkRemove: 'bookmarks:remove',
  bookmarkOpen: 'bookmarks:open',
  gameBookmarkAdd: 'gameBookmarks:add',
  gameBookmarkSetConsole: 'gameBookmarks:setConsole',
  gameBookmarkRemove: 'gameBookmarks:remove',
  gameBookmarkDownload: 'gameBookmarks:download',
  romListSource: 'roms:listSource',
  gameDelete: 'games:delete',
  consoleSave: 'consoles:save',
  consoleRemove: 'consoles:remove',
  consoleEmulators: 'consoles:emulators',
  consoleSetEmulator: 'consoles:setEmulator',
  gameEmulators: 'games:emulators',
  gameSetEmulator: 'games:setEmulator',
  gameLaunch: 'games:launchElement',
  gameDeleteElement: 'games:deleteElement',
  gamesCleanup: 'games:cleanup',
  downloadsList: 'downloads:list',
  downloadsAddUrl: 'downloads:addUrl',
  downloadsAddTorrentFile: 'downloads:addTorrentFile',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsCancel: 'downloads:cancel',
  downloadsRemove: 'downloads:remove',
  downloadsClear: 'downloads:clear',
  downloadsReveal: 'downloads:reveal',
  downloadsRunInstaller: 'downloads:runInstaller',
  downloadsPickDir: 'downloads:pickDir',
  configExport: 'config:export',
  configImport: 'config:import',
  tvDetect: 'tv:detect',
  tvSetActive: 'tv:setActive',
  biosAdd: 'store:biosAdd',
  biosOpen: 'store:biosOpen',
  drmStatus: 'drm:status',
  adblockStatus: 'adblock:status',
  adblockSetEnabled: 'adblock:setEnabled',
  adblockToggleSite: 'adblock:toggleSite',
  adblockSetLists: 'adblock:setLists',
  adblockUpdate: 'adblock:update',
  searchStreaming: 'search:streaming',

  scanGameSources: 'games:scanSources',
  launchGamePath: 'games:launchPath',
  metaAll: 'meta:all',
  metaSet: 'meta:set',
  metaPickImage: 'meta:pickImage',
  metaReset: 'meta:reset',
  checkLocation: 'location:check',

  scrapeData: 'scrape:data',
  scrapeRun: 'scrape:run',
  scrapeOne: 'scrape:one',
  scrapeCandidates: 'scrape:candidates',
  pickImageFile: 'image:pick',
  scrapeCancel: 'scrape:cancel',
  scrapeForget: 'scrape:forget',
  scrapeClear: 'scrape:clear',

  storeCatalog: 'store:catalog',
  storeInstall: 'store:install',
  storeUninstall: 'store:uninstall',
  storeGame: 'store:game',
  storeImport: 'store:import',
  storePickRoot: 'store:pickRoot',

  launchGame: 'games:launch',
  addGame: 'games:add',
  listRoms: 'emu:roms',
  launchRom: 'emu:launch',

  toggleFullscreen: 'window:fullscreen',
  quit: 'app:quit',

  rescueStart: 'rescue:start',
  rescueThemeOk: 'rescue:themeOk',

  usageGet: 'usage:get',
  usageMigrate: 'usage:migrate',
  usageAddRecent: 'usage:addRecent',
  usageRemoveRecent: 'usage:removeRecent',
  usageResume: 'usage:resume',
  usageSaveResume: 'usage:saveResume',
  usageClearResume: 'usage:clearResume',
  usageSetVolume: 'usage:setVolume',
  usageAddQuery: 'usage:addQuery',
  usageClearQueries: 'usage:clearQueries',

  i18nGet: 'i18n:get',

  catalogElement: 'catalog:element',
  catalogSetTags: 'catalog:setTags',
  catalogSetInfos: 'catalog:setInfos',
  catalogPickImage: 'catalog:pickImage',
  catalogClearImages: 'catalog:clearImages',
  catalogReset: 'catalog:reset',
  catalogGroup: 'catalog:group',
  catalogEditGroup: 'catalog:editGroup',
  catalogGroupPickImage: 'catalog:groupPickImage',
  catalogGroupFetch: 'catalog:groupFetch',
  tagsList: 'tags:list',
  tagsOverview: 'tags:overview',
  tagsRename: 'tags:rename',
  tagsMerge: 'tags:merge',
  tagsRemove: 'tags:remove',
  tagsSetLook: 'tags:setLook',
  pagesList: 'pages:list',
  pagesGet: 'pages:get',
  pagesSave: 'pages:save',
  pagesRemove: 'pages:remove',
  pagesOverview: 'pages:overview',
  pagesPreview: 'pages:preview',
  pagesReset: 'pages:reset',
  catalogPage: 'catalog:page',
  catalogSources: 'catalog:sources',
  catalogFolder: 'catalog:folder',
  listsList: 'lists:list',
  listsGet: 'lists:get',
  listsCreate: 'lists:create',
  listsRename: 'lists:rename',
  listsRemove: 'lists:remove',
  listsReorder: 'lists:reorder',
  listsAdd: 'lists:add',
  listsRemoveItems: 'lists:removeItems',
  listsMove: 'lists:move',
  catalogSearch: 'catalog:search',
  filesRename: 'files:rename',
  filesMove: 'files:move',
  filesRemove: 'files:remove',
  filesCheck: 'files:check',
  pluginsList: 'plugins:list',
  pluginsSetEnabled: 'plugins:setEnabled',
  tvWatch: 'tv:watch',
  pluginsSettings: 'plugins:settings',
  pluginsSetSetting: 'plugins:setSetting',
  pluginsMetadataProviders: 'plugins:metadataProviders',
  gamepadsProfiles: 'gamepads:profiles',
  reposList: 'repos:list',
  reposRefresh: 'repos:refresh',
  reposPlugins: 'repos:plugins',
  reposInspect: 'repos:inspect',
  reposAdd: 'repos:add',
  reposRemove: 'repos:remove',
  pluginsInstall: 'plugins:install',
  pluginsConsent: 'plugins:consent',
  pluginsUpdate: 'plugins:update',
  pluginsUninstall: 'plugins:uninstall',
  pluginsContinuity: 'plugins:continuity',
  pluginsContinuitySeen: 'plugins:continuitySeen',
} as const satisfies Record<IpcMethodName, string>;

export type IpcChannel = (typeof IPC_METHODS)[IpcMethodName];

/* ------------------------------------------------------------------ */
/* Événements                                                          */
/* ------------------------------------------------------------------ */

/**
 * Avancement d'une installation de la boutique (émulateur, ou jeu libre `game:<id>`) : des données, que l'interface
 * rédige (P4-18). `step` dit ce qui se fait : chercher la dernière version, télécharger le programme, un module de
 * RetroArch ou un jeu, extraire ; `message` est l'erreur, déjà rédigée par le processus principal.
 */
export interface StoreProgress {
  id: string;
  phase: 'resolve' | 'download' | 'extract' | 'done' | 'error';
  step?: 'latestVersion' | 'program' | 'core' | 'game' | 'extracting';
  name?: string;
  version?: string;
  core?: string;
  received?: number;
  total?: number;
  message?: string;
}

/** Contenu de chaque événement envoyé par le processus principal. */
export interface IpcEvents {
  onTvDetected: { id: string; name: string };
  onDownload: DownloadItem;
  onDownloadFinished: DownloadItem;
  onDownloadAdded: Record<string, unknown>;
  onRomDownload: Record<string, unknown>;
  onWebBlocked: { id: string; count: number };
  onWebAdblocked: { host: string };
  onRomProgress: Record<string, unknown>;
  onScrapeProgress: Record<string, unknown>;
  onStoreProgress: StoreProgress;
  onOpenFiles: MediaItem[];
  onWebState: WebState;
  onWebSessions: WebSession[];
  onWebError: { message: string };
  onWebClosed: { id: string };
  onWebFocus: boolean;
  onMireFocus: undefined;
  /** La langue de l'interface a changé (réglage ou langue du système) : à appliquer à chaud. */
  onLanguageChange: LanguageInfo;
  /** Le contenu de ces pages a pu changer (analyse, infos, modification à la main, définition) : à redemander. */
  onPagesChange: PagesChange;
  /** Ces listes ont changé (définition, éléments, élément disparu, revenu ou changé) : à redemander. */
  onListsChange: ListsChange;
  /** Les sources, les dossiers autorisés ou leur contenu ont pu changer : à redemander (explorateur). */
  onFoldersChange: undefined;
  /** Ouvrir l'explorateur en mode secours (raccourci clavier, touche maintenue au lancement). */
  onRescue: RescueRequest;
  /** Avancement d'une installation de plugin depuis un dépôt (P3-07). */
  onPluginsProgress: PluginsProgress;
  /** Récapitulatif de la continuité changé (plugin activé, installé, devenu impossible) : son message à montrer. */
  onPluginsContinuity: ContinuitySummary;
  /** Profils de manettes changés (plugin activé ou désactivé) : à redemander. */
  onGamepadsChange: undefined;
  /** Lecteurs externes changés (plugin activé ou désactivé) : à redemander. */
  onExternalPlayersChange: undefined;
}

export type IpcEventName = keyof IpcEvents;

/** Abonnement de `window.api` → canal de l'événement. L'ordre est celui de l'ancien preload. */
export const IPC_EVENTS = {
  onTvDetected: 'tv-detected',
  onDownload: 'download',
  onDownloadFinished: 'download-finished',
  onDownloadAdded: 'download-added',
  onRomDownload: 'rom-download',
  onWebBlocked: 'web-blocked',
  onWebAdblocked: 'web-adblocked',
  onRomProgress: 'rom-progress',
  onScrapeProgress: 'scrape-progress',
  onStoreProgress: 'store-progress',
  onOpenFiles: 'open-files',
  onWebState: 'web-state',
  onWebSessions: 'web-sessions',
  onWebError: 'web-error',
  onWebClosed: 'web-closed',
  onWebFocus: 'web-focus',
  onMireFocus: 'web-mire-focus',
  onLanguageChange: 'i18n:changed',
  onPagesChange: 'pages:changed',
  onListsChange: 'lists:changed',
  onFoldersChange: 'folders:changed',
  onRescue: 'rescue:open',
  onPluginsProgress: 'plugins:progress',
  onPluginsContinuity: 'plugins:continuity-changed',
  onGamepadsChange: 'gamepads:changed',
  onExternalPlayersChange: 'player:externalChanged',
} as const satisfies Record<IpcEventName, string>;

/* ------------------------------------------------------------------ */
/* Construction de window.api                                          */
/* ------------------------------------------------------------------ */

/** Ce dont `createApi` a besoin d'`ipcRenderer` (injecté : le paquet ne dépend pas d'Electron). */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

/** `window.api` tel que le voit le renderer. Une erreur inattendue du processus principal arrive en `Failure`. */
export type IpcApi = {
  [K in IpcMethodName]: (...args: IpcArgs<K>) => Promise<IpcResult<K> | Failure>;
} & {
  [K in IpcEventName]: (callback: (payload: IpcEvents[K]) => void) => () => void;
};

/**
 * Construit les méthodes et abonnements de `window.api` à partir des tables, et rien d'autre :
 * aucun appel générique sur un canal arbitraire n'est exposé à l'interface.
 * Chaque `onX(callback)` renvoie une fonction de désabonnement.
 */
export function createApi(ipc: IpcRendererLike): IpcApi {
  const api: Record<string, unknown> = {};
  for (const [name, channel] of Object.entries(IPC_METHODS)) {
    api[name] = (...args: unknown[]) => ipc.invoke(channel, ...args);
  }
  for (const [name, channel] of Object.entries(IPC_EVENTS)) {
    api[name] = (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipc.on(channel, listener);
      return () => {
        ipc.removeListener(channel, listener);
      };
    };
  }
  return api as IpcApi;
}
