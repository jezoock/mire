/** Types du domaine des jeux : jeux PC trouvés dans les dossiers, jeux de console (ROMs) et dépendances du service. */
import type { Config, GameSource } from '@mire/shared';
import type { ConfigService } from '../config/service.ts';
import type { CacheResult, DownloadContext } from '../downloads/types.ts';
import type { ResolvedLocation } from '../library/location.ts';
import type { Launcher } from '../platform/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';

/** Jeu PC trouvé dans un dossier de jeux. */
export interface PcGame {
  name: string;
  path: string;
  /** Identifiant du dossier de jeux (`gameSources[].id`). */
  source: string;
}

/** État de l'analyse d'un dossier de jeux PC. */
export interface SourceStatus {
  ok: boolean;
  error: string | null;
  count: number;
}

/**
 * Fournisseur de jeux PC : sait lire un type d'emplacement (dossier local ou partage réseau aujourd'hui ; plus
 * tard, un addon pourra lire une bibliothèque de lanceur).
 */
export interface GameSourceProvider {
  readonly id: string;
  canHandle(loc: ResolvedLocation): boolean;
  /** Jeux trouvés ; une erreur levée signale un emplacement inaccessible. */
  scan(loc: ResolvedLocation, source: GameSource): Promise<PcGame[]>;
}

/** Jeu de console listé (fichier local ou adresse d'une source web). */
export interface Rom {
  path: string;
  name: string;
  displayName: string;
  dir: string;
  image: string | null;
  remote: boolean;
}

/** Emplacement d'une console : dossier principal (local) ou source supplémentaire. */
export interface ConsoleLocation {
  location: string;
  remote: boolean;
}

/** Ce que le service des jeux utilise du gestionnaire de téléchargements. */
export interface GameDownloads {
  addUrl(url: string, ctx?: DownloadContext): { ok: boolean; id?: string; error?: string };
  addPending(source: string, ctx?: DownloadContext): { ok: boolean; id?: string };
  startPending(id: string): unknown;
  remove(id: string): unknown;
  fetchText(url: string): Promise<string>;
  fetchToCache(url: string, file: string, opts?: { onProgress?: (received: number, total: number) => void }): Promise<CacheResult>;
}

/** Ce que le service des jeux utilise du scraper (fiches de jeux). */
export interface GameScraper {
  one(job: { kind: string; item: Record<string, unknown>; override?: unknown; key?: string }): Promise<{ ok: boolean; error?: string }>;
  copy(from: string, to: string): boolean;
  forget(key: string): unknown;
}

export interface GamesDeps {
  config: Pick<ConfigService, 'get' | 'update'>;
  access: Pick<AccessPolicy, 'isAllowed' | 'isInside'>;
  launcher: Launcher;
  /** Gestionnaire de téléchargements (créé au démarrage, d'où l'accesseur). */
  downloads: () => GameDownloads;
  scraper: () => GameScraper | null;
  /** Dossier du cache des jeux en ligne. */
  romCacheDir: () => string;
  /** Choix d'un fichier par l'utilisateur (« Ajouter un jeu »). */
  pickFile: (kind: string) => Promise<string | null>;
  /** Message vers l'interface (avancement du téléchargement d'un jeu en ligne). */
  toUi: (channel: string, payload: unknown) => void;
  /** Fournisseurs de jeux PC ; par défaut, le dossier local. */
  providers?: GameSourceProvider[];
  platform?: NodeJS.Platform;
}

export type { Config };
