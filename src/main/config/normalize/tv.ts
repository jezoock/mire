/** Télévision : les services proposés par défaut, complétés par ceux de l'utilisateur. */
import { newId, slug } from '@mire/shared';
import type { TvService, TvSettings } from '@mire/shared';
import { DEFAULT_TV } from '../catalogs/tv.ts';
import { isObjectLike, listOf } from './common.ts';

/** `src` : section `tv` d'origine (les services par défaut ne sont pas complétés clé par clé, mais par service). */
export function normalizeTv(src: unknown): TvSettings {
  const tv = isObjectLike(src) ? src : {};
  const byId = new Map<string, TvService>(DEFAULT_TV.map((t) => [t.id, structuredClone(t)]));
  for (const t of listOf(tv.services)) {
    if (!isObjectLike(t) || !t.url) continue;
    const id = String(t.id || slug(t.name) || newId());
    byId.set(id, { ...(byId.get(id) || {}), ...t, id, kind: t.kind === 'web' ? 'web' : 'playlist' } as TvService);
  }
  const out: TvSettings = { services: [...byId.values()], active: typeof tv.active === 'string' ? tv.active : '', detected: tv.detected === true };
  if (out.active && !out.services.some((t) => t.id === out.active)) out.active = '';
  return out;
}
