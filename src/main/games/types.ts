/** Types du domaine des jeux : jeux PC trouvés dans les dossiers, jeux de console (ROMs) et dépendances du service. */
import type { Config } from '@mire/shared';
import type { ElementInput } from '../catalog/types.ts';
import type { ConfigService } from '../config/service.ts';
import type { CacheResult, DownloadContext } from '../downloads/types.ts';
import type { Launcher } from '../platform/index.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import type { PcFolderDeps } from './pc/folders.ts';
import type { RomFolderDeps } from './roms/list.ts';

/** Jeu PC trouvé dans un dossier de jeux (par un plugin, P5-13). */
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
  /** Jeux PC des dossiers de jeux, trouvés par les sources des plugins (P5-13). */
  pcFolders?: PcFolderDeps;
  /** Dossiers locaux des consoles, lus par les sources des plugins (P5-14a). */
  romFolders?: RomFolderDeps;
  platform?: NodeJS.Platform;
  /** Catalogue d'éléments que chaque liste de jeux alimente (`element-sources.ts`). */
  catalog?: { setSource(source: { plugin: string; instance: string }, elements: ElementInput[]): unknown };
  /** Le catalogue n'a pas pu être alimenté (journal par défaut) ; la liste répond quand même. */
  onCatalogError?: (err: Error) => void;
}

export type { Config };
