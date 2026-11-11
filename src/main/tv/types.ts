/** Types de la télévision : entrées M3U, chaînes, fournisseurs (playlist, portail web) et dépendances du service. */
import type { TvService } from '@mire/shared';
import type { ConfigService } from '../config/service.ts';

/** Ligne d'une liste M3U : titre et attributs de `#EXTINF`, puis l'adresse du flux. */
export interface M3uEntry {
  title: string;
  url: string;
  logo: string;
  group: string;
  chno: string;
}

/** Qualité d'un flux, déduite de son libellé ou de son adresse (`flavour=` des Freebox). */
export type Quality = 'hd' | 'sd' | 'ld' | 'other';

export interface ChannelVariant {
  label: string;
  url: string;
  q: Quality;
}

/** Chaîne : ses variantes (HD, SD, bas débit) regroupées sous un même numéro et un même nom. */
export interface Channel {
  number: number | null;
  name: string;
  logo: string;
  group: string;
  variants: ChannelVariant[];
}

/** Réponse de `tvChannels` : les chaînes d'une playlist, le portail d'un service web, ou une erreur à afficher. */
export type ChannelsResult =
  { ok: true; channels: Channel[] } | { ok: true; web: { id: string; url: string; name: string | undefined } } | { ok: false; error: string };

/** Client HTTP du service (celui de `net/http.ts`, simulable dans les tests). */
export interface TvHttp {
  request(url: string, opts?: { timeout?: number }): Promise<unknown>;
  getText(url: string, opts?: { timeout?: number }): Promise<string>;
}

/** Ce que le service donne à un fournisseur pour lire les chaînes. */
export interface TvProviderContext {
  http: TvHttp;
  readFile(file: string): Promise<string>;
}

/**
 * Fournisseur de télévision, choisi par le `kind` du service : « playlist » (liste M3U lue dans Mire) ou « web »
 * (portail du fournisseur, ouvert dans la vue intégrée par l'entrée `tv:` de `web/entries.ts`). Un addon pourra
 * en ajouter d'autres.
 */
export interface TvProvider {
  readonly kind: 'playlist' | 'web';
  channels(service: TvService, ctx: TvProviderContext): Promise<ChannelsResult>;
}

export interface TvDeps {
  config: Pick<ConfigService, 'get' | 'update'>;
  /** Par défaut : `net/http.ts`. */
  http?: TvHttp;
  /** Par défaut : lecture UTF-8 du fichier. */
  readFile?: (file: string) => Promise<string>;
  /** Message à l'interface (`tv-detected`). */
  toUi: (channel: string, payload: unknown) => void;
  providers?: readonly TvProvider[];
}
