/**
 * Interfaces des contributions de code (architecture cible, « Contributions ») : ce qu'un plugin `code` ou
 * `privileged` fournit pour chaque nature déclarée dans `contributes`. Elles reprennent les interfaces internes de
 * Mire (phases 1 et 2), qui les importent désormais d'ici.
 *
 * Quand une interface interne a besoin d'un contexte plus riche que celui d'un plugin (configuration, dossier de
 * cache…), le type est générique : le cœur l'instancie avec son contexte, un plugin avec `PluginContext` (le défaut).
 */
import type { Element, InfoType, InfoValue } from './element.ts';
import type { PluginContext } from './context.ts';

// ---------------------------------------------------------------------------------------------------------------
// Sources d'éléments (`sources`)

/** Élément tel qu'une source le donne : le catalogue y ajoute sa source et sa date d'ajout. */
export type ElementInput = Omit<Element, 'source' | 'added'> & { added?: number };

/**
 * Type de fichiers cherchés dans un emplacement : vidéos, musique et images pour un emplacement de la bibliothèque ;
 * `game` pour un dossier de jeux PC (P5-13), proposé de la même façon. Une source ne prend que les emplacements dont
 * elle sait lire le type.
 */
export type SourceMediaKind = 'video' | 'audio' | 'image' | 'game';

/**
 * Emplacement de la bibliothèque ou dossier de jeux PC, tel que le cœur le passe à une source de plugin (`handles`,
 * `scan`) : un dossier ou un partage réseau (`path`), ou une adresse (`url`). Les emplacements restent dans la configuration de Mire ;
 * un dossier n'est passé qu'à une source qui l'a accepté (`handles`), et lui est alors accordé (`ctx.files`) tant
 * qu'il reste dans la bibliothèque.
 */
export interface SourceLocation {
  /** Emplacement tel que l'utilisateur l'a saisi (`D:\\Films`, `smb://nas/films`, `https://…/films/`). */
  location: string;
  /** Dossier à lire (chemin absolu), pour un dossier ou un partage réseau. */
  path?: string;
  /** Adresse, pour un serveur web ou une liste de lecture. */
  url?: string;
  /** Vrai pour un partage réseau (`\\NAS\\Films`, `smb://…`), lu comme un dossier monté par le système. */
  network: boolean;
  /** Types de fichiers demandés à cet emplacement. */
  kinds: SourceMediaKind[];
}

/**
 * Source d'éléments (contribution `sources`) : trouve des éléments dans des emplacements configurés (dossier,
 * serveur, liste…) et les donne au catalogue. Elle réunit les sources de la bibliothèque, des jeux et de la
 * télévision.
 *
 * `Location` est l'emplacement tel que la source le reçoit. Pour un plugin, c'est un emplacement de la bibliothèque
 * (`SourceLocation`) : le cœur demande `handles` à chaque source, puis appelle `scan` pour chaque emplacement accepté
 * (le cœur fixe alors l'instance) ; une source qui n'accepte aucun emplacement reçoit `scan(null)`, une fois, sous
 * l'identifiant de sa contribution. Seuls les plugins inclus ou du dépôt officiel reçoivent les emplacements de la
 * bibliothèque, et un dossier seulement s'ils déclarent la permission `folders`.
 */
export interface ElementSource<Location = unknown> {
  /** Identifiant de la source : celui de la contribution (`src-local`, `src-http`…). */
  readonly id: string;
  /** Tags de source : posés sur tous les éléments de la source (`remote` pour un serveur web…). */
  readonly tags: readonly string[];
  /** Vrai si la source sait analyser cet emplacement (emplacements gérés). */
  handles(location: Location): boolean;
  /**
   * Identifiant stable de l'emplacement : l'`instance` de la source des éléments. Pour un emplacement de la
   * bibliothèque passé à un plugin, le cœur fixe lui-même l'instance (chemin ou adresse normalisés) : un plugin peut
   * rendre `location.path ?? location.url`.
   */
  instance(location: Location): string;
  /**
   * Analyse d'un emplacement : la liste complète de ses éléments. Lève une erreur au message affichable si
   * l'emplacement est inaccessible (le catalogue garde alors les éléments de l'analyse précédente).
   *
   * Un fichier local garde la clé que lui donne le cœur (`local:<chemin>`, chemin normalisé) si son `open.path` est
   * ce même chemin, dans un dossier accordé ; ses images peuvent être des fichiers de ces dossiers.
   */
  scan(location: Location): Promise<ElementInput[]>;
}

// ---------------------------------------------------------------------------------------------------------------
// Tags automatiques (`taggers`) et déclaration des infos

/** Ce qu'un tag automatique pose sur un élément. */
export interface TaggerResult {
  tags?: string[];
  infos?: Record<string, InfoValue>;
}

/**
 * Tag automatique (contribution `taggers`) : reçoit un élément (avec les tags du type de fichier et de la source) et
 * rend des tags et des infos, ou `null`. Rapide et sans réseau : il est appelé pour chaque élément à chaque analyse.
 */
export interface Tagger {
  id: string;
  compute(element: Readonly<Element>): TaggerResult | null;
}

/**
 * Déclaration d'une info : son type de valeur et, pour un texte ou une liste, si la recherche la lit (vrai par
 * défaut). Le cœur déclare ainsi les siennes ; un plugin déclare les siennes dans son manifeste (`infos` d'une
 * contribution), leur nom affiché venant de ses textes (`infos.<id>`).
 */
export interface InfoDeclaration {
  type: InfoType;
  /** Faux pour une info technique qui n'a pas de sens dans une recherche (extension, sous-titres…). */
  searchable?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Infos en ligne (`metadata`)

/** Nature d'un élément à décrire. */
export type MetadataKind = 'video' | 'album' | 'rom' | 'pc';

/** Famille de la récupération groupée : chaque fournisseur appartient à l'une d'elles. */
export type MetadataGroup = 'videos' | 'music' | 'games';

/** Fiche produite par un fournisseur. Les champs absents ne sont pas écrits. */
export interface MetadataFacts {
  title: string;
  year?: string;
  overview?: string;
  genre?: string;
  artist?: string;
  /**
   * Image (affiche) : un plugin rend son adresse `https:`, sur un hôte de ses `permissions.hosts` ; Mire la copie dans
   * son dossier d'images et enregistre le chemin de la copie.
   */
  image: string | null;
  /** Image de fond, comme `image`. */
  backdrop?: string | null;
  series?: boolean;
  source: string;
  /** Fiche choisie par l'utilisateur dans la liste des candidats. */
  picked?: boolean;
}

/** Fiche choisie par l'utilisateur (un des candidats). */
export interface MetadataPick {
  id: string;
  title?: string;
  sub?: string;
  year?: string;
}

/** Correction de l'utilisateur : autre titre (et type, année, artiste) ou fiche choisie. */
export interface MetadataOverride {
  type?: string;
  title?: string;
  year?: string;
  artist?: string;
  pick?: MetadataPick;
}

/** Fiche proposée au choix de l'utilisateur. */
export interface MetadataCandidate {
  id: string;
  title: string;
  year: string;
  sub: string;
  image: string | null;
  fallback?: string | null;
}

/** Recherche de fiches à proposer. */
export interface MetadataQuery<Item = Element> {
  item?: Item;
  query: string;
  year?: string | number;
  artist?: string;
}

/**
 * Résultat d'une récupération : une fiche (enregistrée), `null` (rien trouvé : échec noté, nouvel essai plus tard) ou
 * `undefined` (rien d'enregistré : annulation, fiche choisie introuvable).
 */
export type MetadataOutcome = MetadataFacts | null | undefined;

/** Ce qui manque pour interroger la source (une clé d'API, par exemple). */
export interface MissingRequirement {
  /** Ligne du bilan d'une récupération groupée. */
  skipped: string;
  /** Message d'erreur d'une recherche de fiches. */
  error: string;
}

/**
 * Source d'infos en ligne (contribution `metadata`) : TMDB, MusicBrainz… `Item` est l'élément à décrire, `Ctx` le
 * contexte prêté par Mire, `JobCtx` celui d'une récupération (avec la clé de la fiche), `Options` les options d'une
 * récupération groupée.
 */
export interface MetadataProvider<Item = Element, Ctx = PluginContext, JobCtx extends Ctx = Ctx, Options = unknown> {
  id: string;
  /** Natures d'éléments décrites. */
  kinds: MetadataKind[];
  /** Famille de la récupération groupée. */
  group: MetadataGroup;
  /** Récupérations simultanées au plus pendant une récupération groupée. */
  concurrency: number;
  /** Ce qui manque pour interroger la source (clé…), ou `null`. */
  requires?(ctx: Ctx): MissingRequirement | null;
  /** Clé de la fiche d'un élément. */
  key(item: Item): string;
  /** Éléments à décrire pour une récupération groupée. */
  collect(opts: Options, ctx: Ctx): Item[] | Promise<Item[]>;
  /** Cherche la fiche d'un élément (d'après son nom, ou la correction `override`). */
  scrape(item: Item, override: MetadataOverride | undefined, ctx: JobCtx): Promise<MetadataOutcome>;
  /** Fiches correspondant à une recherche, pour laisser choisir la bonne. */
  candidates(query: MetadataQuery<Item>, ctx: Ctx): Promise<MetadataCandidate[]>;
  /** Récupère la fiche choisie par l'utilisateur. */
  byId(pick: MetadataPick, item: Item, ctx: JobCtx): Promise<MetadataOutcome>;
}

// ---------------------------------------------------------------------------------------------------------------
// Recherche (`search`)

/** Fournisseur de recherche (contribution `search`) : interroge un catalogue et rend ses résultats. */
export interface SearchProvider<Result = unknown, Ctx = PluginContext> {
  id: string;
  search(query: string, ctx: Ctx): Promise<Result>;
}

// ---------------------------------------------------------------------------------------------------------------
// Sous-titres (`subtitles`)

/**
 * Sous-titre trouvé pour une vidéo : un fichier local (`path`) ou une adresse `https:` (`url`), au format SubRip
 * (`.srt`) ou WebVTT (`.vtt`). Mire le lit lui-même, le convertit en WebVTT et l'affiche comme du texte, jamais comme
 * du HTML.
 */
export interface SubtitleFound {
  /** Fichier `.srt` ou `.vtt` (chemin absolu), dans un dossier accordé au plugin. */
  path?: string;
  /** Adresse `https:` du fichier, sur un hôte déclaré dans `permissions.hosts`. */
  url?: string;
  /** Langue (code ISO 639 : `fr`, `en`, `pt-BR`), ou vide si elle n'est pas connue. */
  lang?: string;
  /** Nom montré dans le choix des sous-titres (`fr`, `forced.fr`…) ; à défaut, Mire écrit « Sous-titres ». */
  label?: string;
}

/**
 * Fournisseur de sous-titres (contribution `subtitles`) : à l'ouverture d'une vidéo, Mire demande ses sous-titres à
 * chaque fournisseur actif et réunit les résultats.
 *
 * `videoPath` est le chemin absolu d'une vidéo locale que Mire a déjà le droit de lire. Pendant l'appel, le dossier
 * de cette vidéo est accordé au plugin (`ctx.files`) s'il déclare la permission `folders`. Seuls les plugins inclus
 * ou du dépôt officiel sont interrogés. Rendre `[]` quand rien n'est trouvé ; une erreur levée compte comme une panne
 * du plugin.
 */
export interface SubtitleProvider {
  /** Identifiant : celui de la contribution. */
  id: string;
  find(videoPath: string): Promise<SubtitleFound[]>;
}

// ---------------------------------------------------------------------------------------------------------------
// Extensions des vues web (`webExtensions`, niveau `privileged`)

/** En-têtes d'une requête. */
export type RequestHeaders = Record<string, string>;
/** En-têtes d'une réponse (plusieurs valeurs possibles). */
export type ResponseHeaders = Record<string, string[]>;

/** Détails d'une requête, tels que les donne Electron (sous-ensemble utilisé). */
export interface RequestDetails {
  id?: number;
  url: string;
  method?: string;
  resourceType?: string;
  referrer?: string;
  webContentsId?: number;
  requestHeaders?: RequestHeaders;
  responseHeaders?: ResponseHeaders;
  statusLine?: string;
  [key: string]: unknown;
}

/** Réponse d'une extension pour une requête (la même forme que les réponses de `webRequest`). */
export interface RequestResponse {
  cancel?: boolean;
  redirectURL?: string;
  requestHeaders?: RequestHeaders;
  responseHeaders?: ResponseHeaders;
  statusLine?: string;
}

export type WebRequestHandler = (details: RequestDetails) => RequestResponse | void | Promise<RequestResponse | void>;

export interface WebRequestHandlers {
  onBeforeRequest?: WebRequestHandler;
  onBeforeSendHeaders?: WebRequestHandler;
  onHeadersReceived?: WebRequestHandler;
}

export type WebRequestEvent = keyof WebRequestHandlers;

type WebRequestListener = (details: any, callback: (response: RequestResponse) => void) => void;

/** Session des vues web (sous-ensemble utilisé par l'hôte des extensions). */
export interface ExtensionSession {
  webRequest: Record<WebRequestEvent, (listener: WebRequestListener | null) => void>;
  [key: string]: any;
}

/**
 * Extension des vues web (contribution `webExtensions`) : agit sur les requêtes réseau, fournit un script exécuté
 * avant le code des pages, annule une navigation et compte ce qu'elle bloque.
 */
export interface WebExtension {
  id: string;
  /** Branchement sur la session des vues web (scripts de page propres, canaux…). */
  attach(session: ExtensionSession): void;
  detach(): void;
  webRequest?: WebRequestHandlers;
  /**
   * Script à exécuter dans la page avant son propre code ('' : rien). `url` : adresse du cadre ; `topUrl` : celle de
   * la page qui le contient (la même pour le cadre principal).
   */
  beforePageScript?(url: string, topUrl: string): string;
  /** Navigation de `from` vers `url` à annuler (true) : redirection publicitaire, par exemple. */
  guardNavigation?(url: string, from: string): boolean;
  /** État de l'extension (réglages). */
  status?(): unknown;
  /** Nombre d'éléments bloqués dans une page (identifiant de webContents). */
  blockedCount?(webContentsId: number): number;
  /** Nouvelle page dans la vue : le compteur repart de zéro. */
  resetPage?(webContentsId: number): void;
  /** L'extension agit-elle sur cette page (bouclier de la barre du site) ? */
  activeOn?(url: string): boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Moteurs de téléchargement (`downloaders`, niveau `privileged`)

/** Fiche d'un téléchargement, telle que Téléchargements l'affiche (sous-ensemble commun à tous les moteurs). */
export interface DownloadItem {
  id: string;
  name: string;
  source: string;
  /** `pending`, `waiting`, `downloading`, `extracting`, `paused`, `interrupted`, `done`, `cancelled`, `error`… */
  state: string;
  received: number;
  total: number;
  speed: number;
  error: string;
}

/** Résultat d'un ajout. */
export type DownloadAddResult = { ok: true; id?: string; external?: boolean; duplicate?: boolean } | { ok: false; error: string };

/**
 * Ce que le gestionnaire de téléchargements donne au moteur d'un plugin (`attach`) : les fiches, de quoi les créer et
 * les mettre à jour, la destination d'une demande, et le post-traitement d'un téléchargement terminé.
 */
export interface DownloaderHost<Item extends DownloadItem = DownloadItem, Request = unknown> {
  /** Nature à donner aux fiches de ce moteur (champ `kind`), pour qu'elles lui reviennent après un redémarrage. */
  readonly kind: string;
  readonly items: Map<string, Item>;
  /** Modifie une fiche (ou l'ajoute), l'enregistre et prévient l'interface. */
  update(item: Item, patch?: Partial<Item>): void;
  /** Dossier de destination d'une demande (dossier de la console, sinon celui des téléchargements). */
  destFor(request?: Request): { dir: string; console: string | null; consoleName: string };
  /** Téléchargement terminé : décompression, programme d'installation, fichiers compagnons. */
  finish(item: Item, files: string[]): Promise<void>;
}

/**
 * Moteur de téléchargement (contribution `downloaders`). `Item` est la fiche d'un téléchargement, `Request` le
 * contexte d'une demande (destination, nom imposé…).
 */
export interface Downloader<Item extends DownloadItem = DownloadItem, Request = unknown> {
  readonly id: string;
  canHandle(source: string): boolean;
  /** Nouveau téléchargement, ou relance de la fiche `item`. */
  add(source: string, request?: Request, item?: Item | null): DownloadAddResult | Promise<DownloadAddResult>;
  /** La fiche a-t-elle un transfert en cours dans ce moteur ? */
  isLive(id: string): boolean;
  pause(item: Item): void;
  resume(item: Item): void | Promise<void>;
  cancel(item: Item, removeFiles: boolean): Promise<void>;
  stop(): Promise<void>;
  /** Moteur d'un plugin : reçoit le gestionnaire au démarrage, avant toute demande (les moteurs du cœur l'ont déjà). */
  attach?(host: DownloaderHost<Item, Request>): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Module d'un plugin de code

/** Interface fournie pour chaque nature de contribution de code. */
export interface CodeContributionTypes {
  sources: ElementSource;
  metadata: MetadataProvider;
  taggers: Tagger;
  search: SearchProvider;
  subtitles: SubtitleProvider;
  webExtensions: WebExtension;
  downloaders: Downloader;
}

/**
 * Ce que le fichier `main` d'une contribution exporte par défaut : une fonction qui reçoit le contexte du plugin et
 * rend la contribution. Forme provisoire : l'hôte de plugins (P3-03) la confirme ou la précise.
 */
export type ContributionFactory<K extends keyof CodeContributionTypes> = (ctx: PluginContext) => CodeContributionTypes[K] | Promise<CodeContributionTypes[K]>;
