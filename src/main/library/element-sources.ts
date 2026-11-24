/**
 * Sources d'éléments de la bibliothèque : les fichiers trouvés par les fournisseurs (`providers/`) deviennent des
 * éléments du catalogue. Une source par plugin prévu à l'inventaire : serveur web (`src-http`), liste M3U
 * (`src-m3u`). Les dossiers de cet ordinateur (`src-local`) et les partages réseau (`src-smb`) sont lus par les
 * plugins inclus `mire.source.local` (P5-11c) et `mire.source.network` (P5-11d) : les éléments que le cœur avait
 * rangés sous ces sources quittent le catalogue à la première analyse (`isLibrarySource`), les plugins les y remettent
 * sous les mêmes clés.
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
import { m3uEntryKey, normalizePath, normalizeUrl, remoteFileKey } from '../catalog/keys.ts';
import type { ElementInput, ElementSource } from '../catalog/types.ts';
import { httpIndexProvider } from './providers/http-index.ts';
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

/**
 * Tags de chaque source (`src-local`, `src-smb` : sources d'avant P5-11c et P5-11d, gardées pour retirer leurs
 * éléments du catalogue).
 */
export const LIBRARY_SOURCE_TAGS = {
  'src-local': ['local'],
  'src-smb': ['network'],
  'src-http': ['remote'],
  'src-m3u': ['remote'],
} as const;

export type LibrarySourceId = keyof typeof LIBRARY_SOURCE_TAGS;

export type ElementOf = (item: LibraryItem, subtitles: string[]) => Omit<ElementInput, 'tags'>;

/** Objet sans les valeurs absentes ou vides : un élément ne garde que ce qu'on sait de lui. */
function compact<T>(o: Record<string, T | null | undefined>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v;
  return out;
}

const imagesOf = (item: LibraryItem): ElementImages => compact({ poster: item.cover, background: item.fanart });

export function fileElement(key: string, item: LibraryItem, infos: Record<string, InfoValue | undefined>): Omit<ElementInput, 'tags'> {
  return { key, name: item.name, open: { kind: 'file', path: item.path }, infos: compact(infos), images: imagesOf(item) };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

/** Source d'éléments d'un fournisseur (exportée pour les tests du cœur, avec une source factice). */
export function librarySource(
  id: string,
  tags: readonly string[],
  provider: SourceProvider,
  accepts: (target: SourceTarget) => boolean,
  toElement: ElementOf,
  platform: NodeJS.Platform,
): LibraryElementSource {
  const elementsOf = (scanned: ScannedLocation): ElementInput[] =>
    scanned.items.map((item) => ({ ...toElement(item, scanned.subtitles(item.path)), tags: [...tags] }));
  return {
    id,
    tags,
    handles: ({ target }) => provider.canHandle(target) && accepts(target),
    instance: ({ target }) => locationInstance(target, platform),
    elementsOf,
    async scan(location) {
      const ctx: ScanContext = { out: [], maxItems: MAX_ITEMS, subtitles: new Map(), localSubtitles: new Map(), platform };
      await provider.scan(location.target, location.kinds, ctx);
      const subtitles = (p: string) => ctx.localSubtitles?.get(p) ?? ctx.subtitles.get(p)?.map((s) => s.url) ?? [];
      return elementsOf({ ...location, items: ctx.out, subtitles, complete: ctx.out.length < MAX_ITEMS });
    },
  };
}

/** Instance d'un emplacement (chemin ou adresse normalisés) : la même pour le cœur et pour un plugin qui le lit. */
export const locationInstance = ({ resolved }: SourceTarget, platform: NodeJS.Platform = process.platform): string =>
  resolved.type === 'url' ? normalizeUrl(resolved.url) : normalizePath(resolved.path, platform);

/** Sources d'éléments de la bibliothèque, dans l'ordre où elles sont essayées. */
export function librarySources(platform: NodeJS.Platform = process.platform): LibraryElementSource[] {
  return [
    librarySource(
      'src-m3u',
      LIBRARY_SOURCE_TAGS['src-m3u'],
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
      LIBRARY_SOURCE_TAGS['src-http'],
      httpIndexProvider,
      () => true,
      (item, subtitles) => fileElement(remoteFileKey(item.path), item, { folder: item.folder, server: hostOf(item.path), subtitles }),
      platform,
    ),
  ];
}

/** Vrai si la source d'un élément est une source de la bibliothèque. */
export const isLibrarySource = (plugin: string): plugin is LibrarySourceId => Object.hasOwn(LIBRARY_SOURCE_TAGS, plugin);
