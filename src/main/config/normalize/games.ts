/** Jeux PC ajoutés à la main, options des jeux et sites de téléchargement de jeux. */
import { isHttpUrl } from '@mire/shared';
import type { Config, Game, LinkSite } from '@mire/shared';
import { isObjectLike } from './common.ts';

export function normalizeGames(list: unknown[]): Game[] {
  return list.filter((g): g is Game => isObjectLike(g) && !!g.path);
}

export function normalizeGamesOptions(opts: unknown): Config['gamesOpts'] {
  return { autoOnline: (isObjectLike(opts) && opts.autoOnline) === true };
}

/** Sites de téléchargement (jeux PC ou d'une console) : adresse web obligatoire. */
export function normalizeLinkSites(list: unknown[]): LinkSite[] {
  return list
    .filter((x: any) => x && typeof x.url === 'string' && isHttpUrl(x.url))
    .map((x: any) => ({ name: String(x.name || x.url), url: x.url, search: typeof x.search === 'string' ? x.search : '' }));
}
