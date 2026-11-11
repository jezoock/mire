/**
 * Version 5 : la télé devient une liste de services ; l'ancienne playlist Freebox est conservée.
 * Le réglage « sites en plein écran » de l'interface, abandonné, est retiré.
 */
import { DEFAULT_TV } from '../catalogs/tv.ts';
import { isObjectLike } from '../normalize/common.ts';
import type { Migration } from './types.ts';

export const v5: Migration = {
  version: 5,
  up(raw) {
    if (raw.ui) delete raw.ui.webFullscreen;
    const services = structuredClone([...DEFAULT_TV]);
    if (isObjectLike(raw.freebox)) {
      const fb = services.find((t) => t.id === 'freebox')!;
      if (raw.freebox.playlist) fb.url = raw.freebox.playlist;
      if (raw.freebox.quality) fb.quality = raw.freebox.quality;
    }
    raw.tv = { services, active: 'freebox', detected: true };
    delete raw.freebox;
  },
};
