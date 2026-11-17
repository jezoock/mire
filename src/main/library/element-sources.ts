/**
 * Sources d'éléments de la bibliothèque : les fichiers trouvés par les fournisseurs (`providers/`) deviennent des
 * éléments du catalogue. Une source par plugin prévu à l'inventaire : dossier de cet ordinateur (`src-local`),
 * partage réseau (`src-smb`), serveur web (`src-http`), liste M3U (`src-m3u`).
 *
 * L'analyse de la bibliothèque (`scanLibrary`) ne parcourt chaque emplacement qu'une fois : elle rend ses
 * `LibraryItem` à l'interface historique, et la source en tire les éléments (`elementsOf`). `scan` analyse un
 * emplacement seul, comme le fera l'hôte des plugins.
 *
 * Seuls les tags et les infos que la source connaît sont posés ici (tags de source, dossier, serveur, sous-titres,
 * images trouvées à côté du fichier, type de média d'une entrée M3U sans extension) ; le type de fichier est posé
 * par le moteur de tags (P2-04), les épisodes viendront des tags automatiques (P2-05).
 */
import { KIND, type MediaKind } from '@mire/shared';
import type { ElementImages, InfoValue } from '@mire/shared';
import { localFileKey, m3uEntryKey, normalizePath, normalizeUrl, remoteFileKey } from '../catalog/keys.ts';
import type { ElementInput, ElementSource } from '../catalog/types.ts';
import { httpIndexProvider } from './providers/http-index.ts';
import { localProvider } from './providers/local.ts';
import { m3uProvider } from './providers/m3u.ts';
import { MAX_ITEMS } from './scan.ts';
import type { LibraryItem, ScanContext, ScannedLocation, SourceProvider, SourceTarget } from './types.ts';

/** Emplacement de la bibliothèque, tel qu'une source le reçoit : où chercher, et quels types de fichiers. */
export interface LibraryLocation {
  target: SourceTarget;
  kinds: ReadonlySet<MediaKind>;
}

export interface LibraryElementSource extends ElementSource<LibraryLocation> {
  /** Éléments d'un emplacement déjà analysé par `scanLibrary`. */
  elementsOf(scanned: ScannedLocation): ElementInput[];
}

/** Tags de chaque source. */
export const LIBRARY_SOURCE_TAGS = {
  'src-local': ['local'],
  'src-smb': ['network'],
  'src-http': ['remote'],
  'src-m3u': ['remote'],
} as const;

export type LibrarySourceId = keyof typeof LIBRARY_SOURCE_TAGS;

type ElementOf = (item: LibraryItem, subtitles: string[]) => Omit<ElementInput, 'tags'>;

/** Objet sans les valeurs absentes ou vides : un élément ne garde que ce qu'on sait de lui. */
function compact<T>(o: Record<string, T | null | undefined>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  return out;
}

const imagesOf = (item: LibraryItem): ElementImages => compact({ poster: item.cover, background: item.fanart });

function fileElement(key: string, item: LibraryItem, infos: Record<string, InfoValue | undefined>): Omit<ElementInput, 'tags'> {
  return { key, name: item.name, open: { kind: 'file', path: item.path }, infos: compact(infos), images: imagesOf(item) };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

function librarySource(
  id: LibrarySourceId,
  provider: SourceProvider,
  accepts: (target: SourceTarget) => boolean,
  toElement: ElementOf,
  platform: NodeJS.Platform,
): LibraryElementSource {
  const tags = LIBRARY_SOURCE_TAGS[id];
  const elementsOf = (scanned: ScannedLocation): ElementInput[] =>
    scanned.items.map((item) => ({ ...toElement(item, scanned.subtitles(item.path)), tags: [...tags] }));
  return {
    id,
    tags,
    handles: ({ target }) => provider.canHandle(target) && accepts(target),
    instance: ({ target: { resolved } }) => (resolved.type === 'url' ? normalizeUrl(resolved.url) : normalizePath(resolved.path, platform)),
    elementsOf,
    async scan(location) {
      const ctx: ScanContext = { out: [], maxItems: MAX_ITEMS, subtitles: new Map(), localSubtitles: new Map(), platform };
      await provider.scan(location.target, location.kinds, ctx);
      const subtitles = (p: string) => ctx.localSubtitles?.get(p) ?? ctx.subtitles.get(p)?.map((s) => s.url) ?? [];
      return elementsOf({ ...location, items: ctx.out, subtitles, complete: ctx.out.length < MAX_ITEMS });
    },
  };
}

const isNetwork = (target: SourceTarget) => target.resolved.type === 'path' && target.resolved.network;

/** Sources d'éléments de la bibliothèque, dans l'ordre où elles sont essayées. */
export function librarySources(platform: NodeJS.Platform = process.platform): LibraryElementSource[] {
  const local: ElementOf = (item, subtitles) => fileElement(localFileKey(item.path, platform), item, { folder: item.folder, subtitles });
  return [
    librarySource(
      'src-m3u',
      m3uProvider,
      () => true,
      (item) => ({
        key: m3uEntryKey(item.dir, item.path, platform),
        name: item.name,
        open: { kind: 'stream', url: item.path },
        // Sans extension reconnue, le type de média vient de celui de la source configurée : le moteur de tags
        // en tire `video`, `audio` ou `image` (P2-04).
        infos: compact({ playlist: item.folder, mediaType: KIND[item.ext] ? undefined : item.kind }),
        images: compact({ logo: item.cover }),
      }),
      platform,
    ),
    librarySource(
      'src-http',
      httpIndexProvider,
      () => true,
      (item, subtitles) => fileElement(remoteFileKey(item.path), item, { folder: item.folder, server: hostOf(item.path), subtitles }),
      platform,
    ),
    librarySource('src-smb', localProvider, isNetwork, local, platform),
    librarySource('src-local', localProvider, (target) => !isNetwork(target), local, platform),
  ];
}

/** Vrai si la source d'un élément est une source de la bibliothèque. */
export const isLibrarySource = (plugin: string): plugin is LibrarySourceId => Object.hasOwn(LIBRARY_SOURCE_TAGS, plugin);
