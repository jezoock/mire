/**
 * Service de télévision : service actif, détection au premier lancement, chaînes du service choisi. Les dépendances
 * (configuration, client HTTP, messages à l'interface) sont injectées : le service ne connaît ni Electron ni la fenêtre.
 */
import fsp from 'node:fs/promises';
import { isHttpUrl, type TvService } from '@mire/shared';
import * as netHttp from '../net/http.ts';
import { groupChannels, parseM3U, pickVariant } from './channels.ts';
import { detectTvService } from './detect.ts';
import { tvChannelKey } from '../catalog/keys.ts';
import { channelElements } from './element-sources.ts';
import type { Channel, ChannelsResult, ChannelStream, TvDeps, TvProvider, TvProviderContext } from './types.ts';
import { t } from '../i18n/current.ts';

/** Playlist M3U lue dans Mire : adresse sur le réseau de la box, ou fichier local. */
export const playlistProvider: TvProvider = {
  kind: 'playlist',
  async channels(svc, ctx) {
    const src = (svc.url || '').trim();
    if (!src) return { ok: false, error: t('tv.errors.noPlaylistUrl', { service: String(svc.name) }) };
    let text: string;
    if (isHttpUrl(src)) {
      try {
        text = await ctx.http.getText(src, { timeout: 8000 });
      } catch (err) {
        const e = err as { kind?: string; status?: number };
        if (e.kind === 'status') return { ok: false, error: t('tv.errors.playlistStatus', { service: String(svc.name), status: String(e.status) }) };
        return {
          ok: false,
          error: t('tv.errors.playlistUnreachable', { service: String(svc.name) }),
        };
      }
    } else {
      try {
        text = await ctx.readFile(src);
      } catch {
        return { ok: false, error: t('tv.errors.playlistFileNotFound', { path: src }) };
      }
    }
    const channels = groupChannels(parseM3U(text));
    if (!channels.length) return { ok: false, error: t('tv.errors.noChannels') };
    return { ok: true, channels };
  },
};

/** Portail du fournisseur : l'interface l'ouvre dans la vue intégrée (entrée `tv:<id>` de `web/entries.ts`). */
export const webProvider: TvProvider = {
  kind: 'web',
  channels: async (svc) => ({ ok: true, web: { id: svc.id, url: svc.url, name: svc.name } }),
};

export const DEFAULT_TV_PROVIDERS: readonly TvProvider[] = [playlistProvider, webProvider];

export function createTv(deps: TvDeps) {
  const providers = deps.providers || DEFAULT_TV_PROVIDERS;
  const ctx: TvProviderContext = {
    http: deps.http || netHttp,
    readFile: deps.readFile || ((file) => fsp.readFile(file, 'utf8')),
  };
  const serviceName = (id: string) => deps.config.get().tv.services.find((t) => t.id === id)?.name || '';

  const detect = () => detectTvService(deps.config.get().tv.services, ctx.http);

  /** Premier lancement : repère le service en place, le choisit et prévient l'interface. Une seule fois. */
  async function detectOnce(): Promise<void> {
    if (deps.config.get().tv.detected) return;
    const found = await detect();
    deps.config.update((c) => ({ ...c, tv: { ...c.tv, active: found || c.tv.active, detected: true } }));
    if (found) deps.toUi('tv-detected', { id: found, name: serviceName(found) });
  }

  function active(): TvService | null {
    const { services, active: id } = deps.config.get().tv;
    return services.find((t) => t.id === id) || null;
  }

  const keyOf = (service: string, c: Channel) => tvChannelKey(service, { number: c.number, urls: c.variants.map((v) => v.url) });

  // Dernières chaînes lues, et leur service : `watch` y retrouve une chaîne par sa clé sans relire la liste.
  let last: { service: string; channels: Channel[] } | null = null;

  async function channels(): Promise<ChannelsResult> {
    const svc = active();
    if (!svc) return { ok: false, error: t('tv.errors.noService') };
    // Un service d'un autre genre que « web » est lu comme une playlist, comme avant l'introduction des fournisseurs.
    const provider = providers.find((p) => p.kind === svc.kind) || playlistProvider;
    const r = await provider.channels(svc, ctx);
    if (!r.ok || !('channels' in r)) return r;
    last = { service: svc.id, channels: r.channels };
    if (deps.catalog) feed(deps.catalog, svc, r.channels);
    // Chaque chaîne porte sa clé d'élément : l'interface la donne à `watch` pour la regarder.
    return { ok: true, channels: r.channels.map((c) => (c.variants.length ? { ...c, key: keyOf(svc.id, c) } : c)) };
  }

  /**
   * Flux à regarder pour une chaîne du service choisi, désignée par sa clé d'élément (`tv:<service>|<numéro>`) : la
   * variante de la qualité préférée du service (`pickVariant`). L'interface ne donne que la clé : l'adresse vient de
   * la liste lue ici, jamais de l'interface.
   */
  async function watch(key: unknown): Promise<ChannelStream> {
    const svc = active();
    if (!svc) return { ok: false, error: t('tv.errors.noService') };
    if (last?.service !== svc.id) {
      const r = await channels();
      if (!r.ok) return r;
    }
    const ch = last?.service === svc.id ? last.channels.find((c) => c.variants.length && keyOf(svc.id, c) === key) : undefined;
    const v = ch && pickVariant(ch.variants, svc.quality);
    if (!ch || !v) return { ok: false, error: t('tv.errors.channelGone') };
    return { ok: true, url: v.url, title: ch.number != null ? `${ch.number}. ${ch.name}` : ch.name };
  }

  /** Chaînes lues → catalogue d'éléments (`element-sources.ts`) ; une erreur du catalogue ne gêne jamais la réponse. */
  function feed(catalog: NonNullable<TvDeps['catalog']>, svc: TvService, list: Channel[]): void {
    try {
      catalog.setSource({ plugin: 'tv-m3u', instance: svc.id }, channelElements(svc, list));
    } catch (err) {
      console.error('Catalogue (télévision) :', (err as Error).message);
    }
  }

  return { detect, detectOnce, active, channels, watch };
}

export type Tv = ReturnType<typeof createTv>;
