/**
 * Sources d'éléments de la télévision, une par plugin prévu à l'inventaire :
 * - `tv-m3u` : chaînes de la liste M3U d'un service (`kind: 'playlist'`), ouvertes comme des flux ;
 * - `tv-web` : portail web d'un service (`kind: 'web'`), un seul élément ouvert comme un site.
 *
 * Elles posent le tag `tv`. Seul le service choisi (`tv.active`) a des éléments, comme dans l'interface historique :
 * ses chaînes entrent dans le catalogue quand l'interface les demande (`tvChannels`), et les éléments d'un service
 * qui n'est plus choisi en sortent.
 */
import type { Config, TvService } from '@mire/shared';
import { tvChannelKey } from '../catalog/keys.ts';
import { compact, type ConfigFeed } from '../catalog/sync.ts';
import type { ElementInput, ElementSource } from '../catalog/types.ts';
import type { Channel, TvProvider, TvProviderContext } from './types.ts';

/** Tags de chaque source. */
export const TV_SOURCE_TAGS = {
  'tv-m3u': ['tv'],
  'tv-web': ['tv'],
} as const;

export type TvSourceId = keyof typeof TV_SOURCE_TAGS;

/** Chaîne d'une liste : flux de la qualité choisie pour le service (sinon le premier), et toutes ses variantes. */
export function channelElement(svc: TvService, ch: Channel): ElementInput {
  const main = ch.variants.find((v) => v.q === svc.quality) ?? ch.variants[0];
  return {
    key: tvChannelKey(svc.id, { number: ch.number, urls: ch.variants.map((v) => v.url) }),
    name: ch.name,
    open: { kind: 'stream', url: main.url, variants: ch.variants.map(({ label, url }) => ({ label, url })) },
    tags: [...TV_SOURCE_TAGS['tv-m3u']],
    // Numéro de la chaîne : tri de la page Télévision (P2-07).
    infos: ch.number === null ? {} : { channel: ch.number },
    images: compact({ logo: ch.logo }),
  };
}

/** Chaînes d'une liste ; deux chaînes au même numéro (même clé) n'en font qu'une : la première. */
export function channelElements(svc: TvService, channels: readonly Channel[]): ElementInput[] {
  const out = new Map<string, ElementInput>();
  for (const ch of channels) {
    if (!ch.variants.length) continue;
    const e = channelElement(svc, ch);
    if (!out.has(e.key)) out.set(e.key, e);
  }
  return [...out.values()];
}

/** Portail web d'un service de télévision. */
export function portalElement(svc: TvService): ElementInput {
  return {
    key: tvChannelKey(svc.id, { number: null, urls: [svc.url] }),
    name: String(svc.name || svc.id),
    open: { kind: 'site', url: svc.url },
    tags: [...TV_SOURCE_TAGS['tv-web']],
    infos: {},
    images: {},
  };
}

const isWeb = (svc: TvService) => svc.kind === 'web';

/** Portail web d'un service : un emplacement par service. */
export const tvWebSource: ElementSource<TvService> = {
  id: 'tv-web',
  tags: TV_SOURCE_TAGS['tv-web'],
  handles: (svc) => isWeb(svc) && !!svc.url,
  instance: (svc) => svc.id,
  scan: async (svc) => [portalElement(svc)],
};

/** Chaînes de la liste M3U d'un service : un emplacement par service. `playlist` : le fournisseur « playlist ». */
export function tvM3uSource(playlist: TvProvider, ctx: TvProviderContext): ElementSource<TvService> {
  return {
    id: 'tv-m3u',
    tags: TV_SOURCE_TAGS['tv-m3u'],
    handles: (svc) => !isWeb(svc),
    instance: (svc) => svc.id,
    async scan(svc) {
      const r = await playlist.channels(svc, ctx);
      if (!r.ok) throw new Error(r.error);
      return 'channels' in r ? channelElements(svc, r.channels) : [];
    },
  };
}

/** Service de télévision choisi, s'il existe. */
const activeService = (config: Config): TvService | undefined => config.tv.services.find((s) => s.id === config.tv.active);

/**
 * Ce que la configuration donne au catalogue : le portail du service choisi s'il est web ; les chaînes du service
 * choisi restent (elles viennent de sa liste), celles des autres services sont retirées.
 */
export function tvConfigFeed(config: Config): ConfigFeed {
  const active = activeService(config);
  const web = active && tvWebSource.handles(active) ? active : undefined;
  return {
    owns: (plugin) => Object.hasOwn(TV_SOURCE_TAGS, plugin),
    sets: web ? [{ source: { plugin: 'tv-web', instance: tvWebSource.instance(web) }, elements: [portalElement(web)] }] : [],
    keeps: (ref) => ref.plugin === 'tv-m3u' && !!active && !isWeb(active) && ref.instance === active.id,
  };
}
