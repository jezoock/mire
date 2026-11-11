/**
 * Normalisation : rend une configuration complète et valide à partir de n'importe quelle valeur (fichier lu,
 * configuration envoyée par l'interface, import). Ce qui est inconnu est gardé ; ce qui est invalide est corrigé
 * ou retiré. Une fonction par section, appliquées dans l'ordre d'origine (l'accueil dépend des sites).
 */
import type { Config } from '@mire/shared';
import { CONFIG_VERSION, DEFAULT_CONFIG, LISTS, NESTED } from '../defaults.ts';
import { normalizeBookmarks, normalizeGameBookmarks } from './bookmarks.ts';
import { isObjectLike, type Loose } from './common.ts';
import { normalizeEmulators } from './consoles.ts';
import { normalizeGames, normalizeGamesOptions, normalizeLinkSites } from './games.ts';
import { normalizeGameSources, normalizeLibrary } from './library.ts';
import { normalizeTv } from './tv.ts';
import { normalizeUi } from './ui.ts';
import { normalizeWeb } from './web.ts';

export function normalizeConfig(raw: unknown): Config {
  const src: Loose = isObjectLike(raw) ? raw : {};
  const defaults: Loose = structuredClone(DEFAULT_CONFIG);
  // Les clés du fichier gardent leur place après celles par défaut : le JSON écrit reste le même qu'avant.
  const c: Loose = { ...structuredClone(DEFAULT_CONFIG), ...src };
  for (const k of NESTED) c[k] = { ...defaults[k], ...(isObjectLike(src[k]) ? src[k] : {}) };
  for (const k of LISTS) if (!Array.isArray(c[k])) c[k] = defaults[k];
  c.library = normalizeLibrary(c.library);
  c.gameSources = normalizeGameSources(c.gameSources);
  c.web = normalizeWeb(c.web);
  c.version = CONFIG_VERSION;
  c.ui = normalizeUi(c.ui, src.ui, c.web);
  c.games = normalizeGames(c.games);
  c.gameBookmarks = normalizeGameBookmarks(c.gameBookmarks);
  c.bookmarks = normalizeBookmarks(c.bookmarks);
  c.pcSites = normalizeLinkSites(Array.isArray(c.pcSites) ? c.pcSites : []);
  c.gamesOpts = normalizeGamesOptions(c.gamesOpts);
  c.emulators = normalizeEmulators(c.emulators);
  c.tv = normalizeTv(src.tv);
  // Ancien réglage de la télévision (avant la v5), repris par la migration.
  delete c.freebox;
  return c as Config;
}
