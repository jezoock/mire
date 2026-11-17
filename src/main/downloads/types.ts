/** Types partagés par le gestionnaire de téléchargements et ses moteurs (HTTP, torrent). */
import type { DownloadAddResult, Downloader as SdkDownloader } from '@mire/plugin-sdk';

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
export type AddResult = DownloadAddResult;

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

/** Moteur de téléchargement interchangeable : l'interface du SDK (contribution `downloaders`), avec les fiches de Mire. */
export interface Downloader extends SdkDownloader<DownloadRecord, DownloadContext> {
  readonly id: DownloadKind;
}

/** Options de la commande « télécharger dans le cache puis prévenir ». */
export interface CacheOptions {
  onProgress?: (received: number, total: number) => void;
  /** Délai accordé au démarrage du téléchargement, en millisecondes (60 s par défaut). */
  startTimeout?: number;
}

/** Résultat de la commande « télécharger dans le cache puis prévenir ». */
export type CacheResult = { ok: true; file: string; id?: string; cached?: boolean } | { ok: false; error: string; id?: string; cancelled?: boolean };
