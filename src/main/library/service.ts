/**
 * Bibliothèque vue du reste de l'application : analyse des sources de la configuration, élément d'un fichier
 * ouvert, sous-titres d'une vidéo. Garde les sous-titres des vidéos en ligne trouvés par la dernière analyse.
 */
import type { Config } from '@mire/shared';
import type { AccessPolicy } from '../security/access-policy.ts';
import { itemFromPath } from './item-from-path.ts';
import { scanLibrary, type ScanOptions } from './scan.ts';
import { findSubtitles } from './subtitles.ts';
import type { RemoteSubtitles, ScanResult } from './types.ts';

export interface LibraryServiceDeps {
  config: { get(): Config };
  access: Pick<AccessPolicy, 'allowFile' | 'isAllowed'>;
  /** Analyse (tests). */
  scan?: (opts: ScanOptions) => Promise<ScanResult>;
}

export function createLibraryService({ config, access, scan = scanLibrary }: LibraryServiceDeps) {
  let remote: RemoteSubtitles = new Map();
  return {
    /** Analyse de toutes les sources ; renvoie aussi l'état de chacune (nombre d'éléments, erreur). */
    async scan() {
      const cfg = config.get();
      const { items, status, subtitles } = await scan({ sources: cfg.library.sources, bookmarks: cfg.bookmarks || [] });
      remote = subtitles;
      return { items, status };
    },
    itemFromPath: (p: unknown) => itemFromPath(p, { allowFile: access.allowFile }),
    findSubtitles: (videoPath: string) => findSubtitles(videoPath, { remote, isAllowed: access.isAllowed }),
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
