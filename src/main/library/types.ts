/** Types de la bibliothèque : éléments, sources, fournisseurs. */
import type { MediaKind } from '@mire/shared';
import type { ResolvedLocation } from './location.ts';

/** Élément de la bibliothèque, tel que l'interface le reçoit. */
export interface LibraryItem {
  path: string;
  name: string;
  ext: string;
  kind: MediaKind;
  folder: string;
  dir: string;
  native: boolean;
  cover: string | null;
  fanart?: string | null;
  remote?: boolean;
  seriesTitle?: string;
  season?: number | null;
  episode?: number | null;
  bookmark?: boolean;
  bookmarkId?: string;
  series?: boolean;
  bookmarkType?: string;
}

/** Sous-titre trouvé à côté d'une vidéo en ligne : `base` est le nom de la vidéo, en minuscules. */
export interface RemoteSubtitle {
  url: string;
  name: string;
  base: string;
}

/** Table vidéo en ligne → sous-titres trouvés à côté, produite par l'analyse. */
export type RemoteSubtitles = Map<string, RemoteSubtitle[]>;

/** Emplacement d'une source : tel que saisi, et résolu. */
export interface SourceTarget {
  location: string;
  resolved: ResolvedLocation;
}

/** Contexte d'une analyse, partagé par toutes les sources. */
export interface ScanContext {
  /** Éléments trouvés : chaque fournisseur y ajoute les siens. */
  out: LibraryItem[];
  /** Nombre maximal d'éléments de toute l'analyse. */
  maxItems: number;
  /** Sous-titres des vidéos en ligne. */
  subtitles: RemoteSubtitles;
  /** Sous-titres .srt / .vtt à côté des vidéos locales (chemins), pour le catalogue d'éléments. */
  localSubtitles?: Map<string, string[]>;
  platform?: NodeJS.Platform;
}

/** Fournisseur de sources du cœur : sait parcourir un genre d'emplacement (les tests en passent un factice). */
export interface SourceProvider {
  id: string;
  canHandle(target: SourceTarget): boolean;
  /** Ajoute à `ctx.out` les éléments des types demandés ; lève une erreur au message affichable si la source est inaccessible. */
  scan(target: SourceTarget, kinds: ReadonlySet<MediaKind>, ctx: ScanContext): Promise<void>;
}

/** État d'une source après l'analyse. */
export interface SourceStatus {
  ok: boolean;
  error: string | null;
  count: number;
  /** Ce qui explique un emplacement vide sans erreur (aucun plugin actif ne le lit). */
  note?: string;
}

/** Emplacement analysé, avec ce que son fournisseur y a trouvé (pour alimenter le catalogue d'éléments). */
export interface ScannedLocation {
  target: SourceTarget;
  /** Types demandés à cet emplacement. */
  kinds: ReadonlySet<MediaKind>;
  /** Éléments de bibliothèque trouvés à cet emplacement. */
  items: LibraryItem[];
  /** Sous-titres trouvés à côté d'une vidéo (chemins ou adresses). */
  subtitles: (videoPath: string) => string[];
  /** Faux si l'analyse s'est arrêtée avant la fin (emplacement inaccessible, nombre maximal d'éléments atteint). */
  complete: boolean;
}

export interface ScanResult {
  items: LibraryItem[];
  status: Record<string, SourceStatus>;
  subtitles: RemoteSubtitles;
}
