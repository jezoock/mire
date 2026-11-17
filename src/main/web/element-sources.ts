/**
 * Sources d'éléments des sites, une par plugin prévu à l'inventaire :
 * - `svc-<id>` : site du catalogue intégré (`svc-netflix`…), chacun deviendra une app ;
 * - `web-perso` : sites ajoutés par l'utilisateur ;
 * - `web-bm` : marque-pages de pages de streaming (`config.bookmarks`).
 *
 * Toutes posent le tag `stream` et l'info `category` (rangement du site dans Streaming : `video`, `music`…). Leurs
 * éléments se déduisent de la configuration (`config.web`, `config.bookmarks`) : ils suivent ses changements.
 */
import { siteOf } from '@mire/shared';
import type { Bookmark, Config, WebSite } from '@mire/shared';
import { DEFAULT_WEB } from '../config/catalogs/web.ts';
import { bookmarkKey, siteKey } from '../catalog/keys.ts';
import { compact, configSet, configSource, type ConfigFeed, type ConfigSource } from '../catalog/sync.ts';
import type { ElementInput } from '../catalog/types.ts';

/** Tags des sources des sites. */
export const SITE_TAGS = ['stream'] as const;

const BUILTIN = new Set(DEFAULT_WEB.map((w) => w.id));

/** Source d'un site : son app (`svc-<id>`) s'il vient du catalogue intégré, sinon `web-perso`. */
export const siteSourceId = (site: Pick<WebSite, 'id'>): string => (BUILTIN.has(site.id) ? `svc-${site.id}` : 'web-perso');

/** Vrai pour les sources des sites et de leurs marque-pages. */
export const isSiteSource = (plugin: string): boolean => plugin.startsWith('svc-') || plugin === 'web-perso' || plugin === 'web-bm';

export function siteElement(site: WebSite): ElementInput {
  return {
    key: siteKey(site.id),
    name: String(site.name || site.id),
    open: { kind: 'site', url: site.url, site: site.id },
    tags: [...SITE_TAGS],
    infos: compact({ category: site.group }),
    images: {},
  };
}

/** Site de la configuration qui ouvre un marque-page (`Bookmark.site` : le domaine de la page). */
function siteOfBookmark(bm: Bookmark, sites: readonly WebSite[]): WebSite | undefined {
  const domain = siteOf(`https://${bm.site}`);
  return domain ? sites.find((s) => siteOf(s.url) === domain) : undefined;
}

/** Marque-page d'une page : catégorie de son site ; saison et épisode d'une série. */
export function bookmarkElement(bm: Bookmark, sites: readonly WebSite[]): ElementInput {
  const site = siteOfBookmark(bm, sites);
  const tv = bm.type === 'tv';
  return {
    key: bookmarkKey(bm.id),
    name: bm.title || bm.url,
    open: site ? { kind: 'site', url: bm.url, site: site.id } : { kind: 'site', url: bm.url },
    tags: [...SITE_TAGS],
    infos: compact<string | number>({ category: site?.group, season: tv ? bm.season : null, episode: tv ? bm.episode : null }),
    images: {},
  };
}

const validSites = (config: Config) => config.web.filter((site) => site?.id && site.url);

/**
 * Sources des sites de cette configuration : une par app de site du catalogue intégré présente, puis les sites
 * ajoutés et les marque-pages.
 */
export function siteSources(config: Config): ConfigSource[] {
  const apps = [...new Set(validSites(config).map(siteSourceId))].filter((id) => id !== 'web-perso');
  const sitesOf = (id: string) => (c: Config) =>
    validSites(c)
      .filter((site) => siteSourceId(site) === id)
      .map(siteElement);
  return [
    ...apps.map((id) => configSource(id, SITE_TAGS, sitesOf(id))),
    configSource('web-perso', SITE_TAGS, sitesOf('web-perso')),
    configSource('web-bm', SITE_TAGS, (c) => c.bookmarks.filter((b) => b?.id && b.url).map((b) => bookmarkElement(b, c.web))),
  ];
}

/** Ce que la configuration donne au catalogue : sites et marque-pages ; une app de site retirée sort du catalogue. */
export function siteConfigFeed(config: Config): ConfigFeed {
  return { owns: isSiteSource, sets: siteSources(config).map((src) => configSet(src, config)) };
}
