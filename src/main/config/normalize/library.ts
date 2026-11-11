/** Bibliothèque (sources de médias) et dossiers de jeux PC. */
import { newId } from '@mire/shared';
import type { Config, GameSource, LibrarySource } from '@mire/shared';
import { MEDIA_KINDS } from '../../lib/formats.js';
import { isObjectLike, listOf, type Loose } from './common.ts';

const validLocation = (x: unknown): x is { location: string } & Loose => isObjectLike(x) && typeof x.location === 'string' && !!x.location.trim();

export function normalizeLibrary(library: Loose): Config['library'] {
  const out: Loose = {
    ...library,
    sources: listOf(library.sources)
      .filter((x) => validLocation(x) && MEDIA_KINDS.includes(x.kind))
      .map((x): LibrarySource => ({ id: String(x.id || newId()), kind: x.kind, location: x.location.trim() })),
  };
  // Ancien format (avant la v4) : dossiers sans type de média.
  delete out.folders;
  return out as Config['library'];
}

export function normalizeGameSources(list: unknown[]): GameSource[] {
  return list.filter(validLocation).map((x) => ({ id: String(x.id || newId()), location: x.location.trim() }));
}
