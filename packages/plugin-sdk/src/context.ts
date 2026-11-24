/**
 * Contexte fourni à un plugin de code (architecture cible, « Niveaux de sécurité et exécution ») : tout ce qu'il peut
 * faire passe par lui. Chaque appel est relayé au processus principal, qui applique les permissions du manifeste.
 * Types seulement : l'implémentation et l'application des permissions viennent avec l'hôte de plugins (P3-03, P3-04).
 */

/** Options d'une requête HTTP. */
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  /** Corps de la requête : texte, ou objet envoyé en JSON. */
  body?: string | Record<string, unknown> | unknown[];
  /** Délai en millisecondes avant abandon. */
  timeout?: number;
}

/** Réponse d'une requête HTTP. */
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Corps de la réponse, en texte. */
  text: string;
}

/**
 * Client HTTP : refuse tout hôte absent de `permissions.hosts`. `getJson` et `getText` lèvent une erreur pour un
 * code autre que 2xx, sauf 404 qui rend `null`.
 */
export interface PluginHttp {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  getJson<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T | null>;
  getText(url: string, options?: HttpRequestOptions): Promise<string | null>;
}

/** Entrée d'un dossier parcouru. */
export interface FileEntry {
  /** Chemin complet. */
  path: string;
  /** Taille en octets. */
  size: number;
  /** Date de dernière modification (millisecondes depuis 1970). */
  modified: number;
}

/** Options d'un parcours de dossier. */
export interface WalkOptions {
  /** Extensions gardées, sans le point (`mkv`, `mp3`) ; toutes si absent. */
  extensions?: string[];
  /** Profondeur maximale (illimitée si absent). */
  depth?: number;
  /** Nombre maximal de fichiers rendus (150 000 au plus). */
  limit?: number;
  /** Ignore les dossiers dont le nom commence par `.` ou `$` (cachés, système) et les fichiers commençant par `.`. */
  skipHidden?: boolean;
}

/**
 * Fichiers : ne lit que les dossiers accordés par l'utilisateur, en passant par la politique d'accès de Mire.
 * `walk` parcourt les dossiers dans le processus principal, pour ne pas faire transiter chaque fichier.
 */
export interface PluginFiles {
  /** Demande à l'utilisateur l'accès à un dossier ; le chemin accordé, ou `null` s'il refuse. */
  requestFolder(purpose: string): Promise<string | null>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  walk(root: string, options?: WalkOptions): Promise<FileEntry[]>;
}

/** Stockage du plugin (`userData/plugin-data/<id>/`) : des valeurs JSON rangées par clé. */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Valeur d'un réglage du plugin. */
export type SettingValue = string | number | boolean | string[];

/** Réglages du plugin (`settings` du manifeste), rangés sous `plugins.<id>` dans la configuration. */
export interface PluginSettings {
  /** Valeur d'un réglage ; celle par défaut du manifeste s'il n'a pas été changé. */
  get<T extends SettingValue = SettingValue>(key: string): T | undefined;
  /** Prévient quand un réglage change ; rend de quoi arrêter d'écouter. */
  onChange(listener: (key: string) => void): () => void;
}

/** Journal du plugin, préfixé de son identifiant. */
export interface PluginLog {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

/** Événements de Mire qu'un plugin peut écouter. */
export interface PluginEvents {
  /** Abonnement à un événement ; rend de quoi se désabonner. */
  on(event: string, listener: (payload: unknown) => void): () => void;
}

/** Contexte d'un plugin de code. */
export interface PluginContext {
  /** Identifiant du plugin. */
  readonly id: string;
  /** Version du plugin. */
  readonly version: string;
  /** Langue de l'interface (code BCP 47). */
  readonly locale: string;
  readonly http: PluginHttp;
  readonly files: PluginFiles;
  readonly storage: PluginStorage;
  readonly settings: PluginSettings;
  readonly log: PluginLog;
  readonly events: PluginEvents;
}
