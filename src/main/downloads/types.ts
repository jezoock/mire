/** Types partagés par le gestionnaire de téléchargements et ses moteurs (HTTP, torrent). */

export type DownloadKind = 'http' | 'torrent';

/**
 * Fiche d'un téléchargement, affichée dans Téléchargements et enregistrée dans `telechargements.json`.
 * États : `pending` (marque-page, ne démarre qu'à la demande), `waiting`, `downloading`, `extracting`, `paused`,
 * `interrupted` (HTTP coupé par la fermeture de Mire), `done`, `cancelled`, `error`, `external` (confié au logiciel
 * de torrent du système).
 */
export interface DownloadRecord {
  id: string;
  kind: DownloadKind;
  createdAt: number;
  name: string;
  source: string;
  dir: string;
  console: string | null;
  consoleName: string;
  state: string;
  received: number;
  total: number;
  speed: number;
  error: string;
  installers: string[];
  [key: string]: unknown;
}

/** Contexte d'un téléchargement demandé : console de destination, nom imposé, groupe d'un jeu sur disque… */
export interface DownloadContext {
  console?: string | null;
  name?: string;
  /** Chemin exact du fichier (fichier cité par un index de disque, copie dans le cache). */
  saveAs?: string;
  group?: string;
  companionsQueued?: boolean;
  gameBookmark?: string | null;
  /** Fiche relancée (reprise, nouvel essai, marque-page). */
  retryOf?: string;
  /** Copie dans le cache : ni décompression, ni programme d'installation, ni fichiers compagnons. */
  cache?: boolean;
  /** Appelé dès que la fiche existe (commande « télécharger dans le cache puis prévenir »). */
  onStart?: (it: DownloadRecord) => void;
}

/** Résultat d'un ajout. */
export type AddResult = { ok: true; id?: string; external?: boolean; duplicate?: boolean } | { ok: false; error: string };

export interface Destination {
  dir: string;
  console: string | null;
  consoleName: string;
  extensions: string[];
}

export interface DownloadSettings {
  dir: string;
  torrentClient: string;
  seed: boolean;
  [key: string]: unknown;
}

/** Ce que le gestionnaire met à disposition de ses moteurs. */
export interface DownloaderHost {
  readonly items: Map<string, DownloadRecord>;
  /** Modifie une fiche, l'enregistre et prévient l'interface. */
  update(it: DownloadRecord, patch?: Partial<DownloadRecord>): void;
  destFor(ctx?: DownloadContext): Destination;
  settings(): DownloadSettings;
  /** Post-traitement d'un téléchargement terminé (voir finish.ts). */
  finish(it: DownloadRecord, files: string[]): Promise<void>;
}

/** Moteur de téléchargement interchangeable. */
export interface Downloader {
  readonly id: DownloadKind;
  canHandle(source: string): boolean;
  /** Nouveau téléchargement, ou relance de la fiche `fiche`. */
  add(source: string, ctx?: DownloadContext, fiche?: DownloadRecord | null): AddResult | Promise<AddResult>;
  /** La fiche a-t-elle un transfert en cours dans ce moteur ? */
  isLive(id: string): boolean;
  pause(it: DownloadRecord): void;
  resume(it: DownloadRecord): void | Promise<void>;
  cancel(it: DownloadRecord, removeFiles: boolean): Promise<void>;
  stop(): Promise<void>;
}

/** Résultat de la commande « télécharger dans le cache puis prévenir ». */
export type CacheResult = { ok: true; file: string; id?: string; cached?: boolean } | { ok: false; error: string; id?: string; cancelled?: boolean };
