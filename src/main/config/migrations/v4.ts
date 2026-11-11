/** Version 4 : chaque dossier de la bibliothèque devient une source par type de média. */
import { MEDIA_KINDS, newId } from '@mire/shared';
import { isObjectLike } from '../normalize/common.ts';
import type { Migration } from './types.ts';

export const v4: Migration = {
  version: 4,
  up(raw) {
    if (!isObjectLike(raw.library) || !Array.isArray(raw.library.folders)) return;
    raw.library.sources = raw.library.folders
      .filter((f) => typeof f === 'string' && f.trim())
      .flatMap((f) => MEDIA_KINDS.map((kind: string) => ({ id: newId(), kind, location: f })));
    delete raw.library.folders;
  },
};
