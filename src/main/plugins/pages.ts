/**
 * Pages prêtes à l'emploi des plugins actifs (contribution de données `pages`, P5-03). Le cœur garde le moteur des
 * pages (calcul, regroupements, `pages.json` de l'utilisateur) ; un plugin apporte la définition d'une page. Fichier de
 * la contribution : une `PageDefinition` (`@mire/shared`), avec un nom donné par une clé de texte du plugin :
 *
 *   { "id": "movies", "name": { "key": "pages.movies" }, "icon": "movie", "require": ["video", "movie"],
 *     "groupBy": ["genres"], "sort": [{ "by": "title" }], "display": "posters", "menu": { "pinned": true, "order": 1 } }
 *
 * - la définition est vérifiée par `validatePage` (même schéma que les pages de l'utilisateur : champs connus, tailles
 *   bornées, valeurs permises) ; un fichier qui ne convient pas ne donne aucune page ;
 * - `id` doit être celui de la contribution du manifeste ;
 * - `name` : uniquement une clé (`{ "key": "…" }`) lue sous `pluginTexts.<plugin>.<clé>` : un nom en clair, qui ne
 *   serait pas traduit, est refusé ; les textes ne sont jamais interprétés comme du HTML (l'interface les affiche
 *   comme du texte) ;
 * - deux plugins qui apportent le même identifiant : le premier (par identifiant de plugin) l'emporte.
 */
import type { PageDefinition } from '@mire/shared';
import { validatePage } from '@mire/shared';
import type { ContributionEntry } from './registry.ts';
import { pluginTextPrefix } from './service.ts';

const TEXT_KEY_RE = /^[A-Za-z0-9_-]{1,32}(?:\.[A-Za-z0-9_-]{1,32}){0,3}$/;

/** Page d'une contribution `pages`, ou `null` si ses données ne conviennent pas. */
export function readPluginPage(entry: ContributionEntry): PageDefinition | null {
  const d = entry.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const raw = d as Record<string, unknown>;
  const name = raw.name;
  const key = name && typeof name === 'object' && !Array.isArray(name) ? (name as Record<string, unknown>).key : undefined;
  if (typeof key !== 'string' || !TEXT_KEY_RE.test(key) || Object.keys(name as object).length !== 1) return null;
  if (raw.id !== entry.id) return null;
  const r = validatePage({ ...raw, name: { key: pluginTextPrefix(entry.pluginId) + key } });
  return r.ok ? r.page : null;
}

/** Pages des contributions actives, sans doublon d'identifiant, dans un ordre stable. */
export function readPluginPages(entries: readonly ContributionEntry[]): PageDefinition[] {
  const byId = new Map<string, PageDefinition>();
  const sorted = entries.filter((e) => e.kind === 'pages').sort((a, b) => (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : a.id < b.id ? -1 : 1));
  for (const e of sorted) {
    const page = readPluginPage(e);
    if (page && !byId.has(page.id)) byId.set(page.id, page);
  }
  return [...byId.values()];
}
