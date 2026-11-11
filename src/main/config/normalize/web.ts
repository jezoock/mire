/** Sites de streaming. */
import { slug } from '@mire/shared';
import type { WebSite } from '@mire/shared';
import { isObjectLike } from './common.ts';

export function normalizeWeb(list: unknown[]): WebSite[] {
  return list
    .filter((w) => isObjectLike(w) && w.url)
    .map((w: any, i) => ({
      ...w,
      id: String(w.id || slug(w.name) || `site-${i}`),
      mode: w.mode === 'browser' ? 'browser' : 'integrated',
      search: typeof w.search === 'string' ? w.search : '',
    }));
}
