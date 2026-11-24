/**
 * Services de streaming des plugins actifs (contribution de données `webApps`, P5-05). Un plugin décrit un site ;
 * le cœur garde les mécanismes : la vue web (isolée, sans Node), Widevine, la session de connexion. Fichier de la
 * contribution (un site par fichier) :
 *
 *   { "name": "Netflix", "url": "https://www.netflix.com/browse", "color": "#E50914",
 *     "search": "https://www.netflix.com/search?q={query}", "providers": ["netflix"],
 *     "background": false, "category": "video" }
 *
 * - `name` : nom affiché (texte brut) ; `url` : adresse d'ouverture ; `color` : `#RRGGBB` seulement ;
 * - `search` (facultatif) : modèle de recherche ; le seul jeton accepté est `{query}`, une fois ; le cœur y met les
 *   mots cherchés, encodés ; même site que `url`. Absent : Mire l'apprend avec « Mémoriser la recherche » ;
 * - `providers` (facultatif) : noms du service chez TMDB/JustWatch, pour « Où regarder » (`=nom` : nom exact) ;
 * - `background` (facultatif) : la lecture continue quand on quitte le site (musique) ;
 * - `category` (facultatif) : rangement dans Streaming (`video` par défaut, `music`…).
 * L'identifiant du site est celui de la contribution : c'est lui que la configuration retient (réglages, historique).
 * Toutes les adresses sont en `https:` sans identifiants ; aucun texte n'est interprété comme du HTML. Un fichier mal
 * formé ne donne aucun service ; une valeur facultative mal formée est ignorée.
 *
 * `syncWebApps` met les sites de la configuration (`config.web`) d'accord avec les plugins actifs : un service
 * actif y est ajouté ou mis à jour (adresse, couleur, fournisseurs… viennent du plugin ; le mode et la recherche
 * apprise restent à l'utilisateur) ; un service dont le plugin est désactivé ou absent est marqué `inactive` (il
 * quitte Streaming et « Où regarder », sans rien effacer : il revient avec son plugin).
 */
import { siteOf } from '@mire/shared';
import type { Config, WebSite } from '@mire/shared';
import { OFFICIAL_PREFIX } from '../../../packages/plugin-sdk/src/validate.ts';
import type { ContributionEntry } from './registry.ts';
import { checkHttpsUrl, checkText } from './packs.ts';

export const MAX_PROVIDERS = 8;
export const MAX_PROVIDER_LENGTH = 40;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const CATEGORY_RE = /^[a-z][a-z-]{0,15}$/;
const QUERY = '{query}';

/** Service lu d'une contribution `webApps`. */
export interface WebApp {
  /** Identifiant du site (celui de la contribution). */
  id: string;
  plugin: string;
  name: string;
  url: string;
  color: string;
  /** Modèle d'adresse de recherche, au jeton `{q}` de la configuration (vide : à apprendre). */
  search: string;
  providers: string[];
  background: boolean;
  category: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Modèle de recherche en `{q}` (jeton de la configuration), ou `null` s'il ne convient pas. */
export function checkSearchTemplate(v: unknown, url: string): string | null {
  if (typeof v !== 'string' || v.split(QUERY).length !== 2) return null;
  // Le jeton remplacé par un mot : l'adresse doit rester une adresse valable, du même site que l'ouverture.
  const probe = checkHttpsUrl(v.replace(QUERY, 'mire'));
  if (!probe || siteOf(probe) !== siteOf(url) || /[{}]/.test(v.replace(QUERY, ''))) return null;
  return v.replace(QUERY, '{q}');
}

function readProviders(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = v.slice(0, MAX_PROVIDERS).flatMap((p) => checkText(p, MAX_PROVIDER_LENGTH) ?? []);
  return [...new Set(out)];
}

/** Service d'une contribution `webApps`, ou `null` si ses données ne conviennent pas. */
export function readWebApp(entry: ContributionEntry): WebApp | null {
  const d = entry.data;
  if (entry.kind !== 'webApps' || !isRecord(d) || !ID_RE.test(entry.id)) return null;
  const name = checkText(d.name);
  const url = checkHttpsUrl(d.url);
  if (!name || !url || typeof d.color !== 'string' || !COLOR_RE.test(d.color)) return null;
  const category = typeof d.category === 'string' && CATEGORY_RE.test(d.category) ? d.category : 'video';
  return {
    id: entry.id,
    plugin: entry.pluginId,
    name,
    url,
    color: d.color.toUpperCase(),
    search: checkSearchTemplate(d.search, url) ?? '',
    providers: readProviders(d.providers),
    background: d.background === true,
    category,
  };
}

/**
 * Services des contributions données. Un identifiant de site n'est donné qu'une fois : les plugins officiels (`mire.`)
 * passent avant les autres, qui ne peuvent donc pas prendre l'identifiant d'un service officiel ; à rang égal, le
 * premier l'emporte.
 */
export function readWebApps(entries: readonly ContributionEntry[]): WebApp[] {
  const official = (e: ContributionEntry) => e.pluginId.startsWith(OFFICIAL_PREFIX);
  const ordered = [...entries.filter(official), ...entries.filter((e) => !official(e))];
  const seen = new Set<string>();
  const out: WebApp[] = [];
  for (const e of ordered) {
    const app = readWebApp(e);
    if (!app || seen.has(app.id)) continue;
    seen.add(app.id);
    out.push(app);
  }
  return out;
}

/** Site de la configuration que ce service décrit. */
function siteOfApp(app: WebApp, previous: WebSite | undefined): WebSite {
  // La recherche apprise par l'utilisateur est à lui ; sinon celle du plugin.
  const learned = typeof previous?.search === 'string' ? previous.search : '';
  const site: WebSite = {
    ...previous,
    id: app.id,
    name: app.name,
    url: app.url,
    mode: previous?.mode === 'browser' ? 'browser' : 'integrated',
    search: learned || app.search,
    group: app.category,
    color: app.color,
    app: app.plugin,
  };
  if (app.providers.length) site.providers = [...app.providers];
  else delete site.providers;
  if (app.background) site.background = true;
  else delete site.background;
  delete site.inactive;
  return site;
}

/**
 * Sites de la configuration d'après les services des plugins actifs. Un site déjà là n'est repris par un service
 * que s'il vient du même plugin, ou s'il n'a pas de plugin et que le service est d'un plugin officiel (la
 * continuité : un service configuré avant l'extraction) ; sinon le site de l'utilisateur reste tel quel.
 */
export function syncWebApps(web: readonly WebSite[], apps: readonly WebApp[]): WebSite[] {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const out: WebSite[] = [];
  const used = new Set<string>();
  for (const site of web) {
    const app = byId.get(site.id);
    const owner = typeof site.app === 'string' ? site.app : null;
    const adopt = app && (owner ? owner === app.plugin : app.plugin.startsWith(OFFICIAL_PREFIX));
    if (app && adopt) {
      used.add(app.id);
      out.push(siteOfApp(app, site));
    } else if (owner) {
      out.push({ ...site, inactive: true });
    } else {
      out.push(site);
    }
  }
  const ids = new Set(web.map((w) => w.id));
  for (const app of apps) if (!used.has(app.id) && !ids.has(app.id)) out.push(siteOfApp(app, undefined));
  return out;
}

/** Configuration d'après les services actifs ; la même configuration si rien ne change (pas d'écriture inutile). */
export function withWebApps(config: Config, apps: readonly WebApp[]): Config {
  const web = syncWebApps(config.web, apps);
  return JSON.stringify(web) === JSON.stringify(config.web) ? config : { ...config, web };
}
