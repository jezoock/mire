/**
 * Continuité pour les installations existantes (P5-01) : quand une fonction de Mire devient un plugin (phase 5), une
 * installation qui s'en servait doit le retrouver, avec ses réglages. La migration v10 (`v10.ts`) applique la table
 * `CONTINUITY_RULES` à la configuration lue (avant normalisation) :
 * - les réglages de la règle sont déplacés sous `plugins.<id>` (là où le plugin les lit, P3-04) ;
 * - l'identifiant de la règle est noté dans `continuity` : le service de continuité (`src/main/plugins/continuity.ts`)
 *   le reprend au démarrage, active le plugin inclus ou met en attente l'installation du plugin à installer, puis
 *   l'efface de la configuration.
 * La configuration ne porte que des identifiants de règles, jamais un identifiant de plugin : un fichier modifié à
 * la main ou importé ne peut désigner qu'un plugin choisi ici, dans le code.
 *
 * AJOUTER UNE RÈGLE (chaque tâche P5-xx qui extrait une fonction) :
 * 1. une entrée dans `CONTINUITY_RULES`, identifiée par la tâche (`id: 'P5-15'`) ;
 * 2. `plugin` : identifiant du plugin, publié dans le dépôt officiel (préfixe `mire.`, vérifié par `checkRules`) ;
 * 3. `mode` : `bundled` pour un plugin inclus (`resources/plugins/`), `install` pour un plugin à installer ;
 * 4. `applies(config)` : vrai si la configuration (d'avant la v10, non normalisée : tout peut y manquer ou y être mal
 *    formé) se sert de la fonction ; faux sinon (rien n'est alors activé, installé ni déplacé) ;
 * 5. `settings` (facultatif) : réglages à déplacer, chemin dans la configuration (`search.tmdbToken`) → clé du réglage
 *    déclaré par le manifeste du plugin (`token`), `secret: true` pour un réglage `secret`, `convert` pour une valeur
 *    à traduire (option d'un `choice`), `keep: true` pour un réglage que le cœur lit encore (copié, pas déplacé) ;
 * 6. un test dans `test/config/continuity.test.ts` (une configuration qui s'en sert, une qui ne s'en sert pas).
 * Exemple :
 *   { id: 'P5-15', plugin: 'mire.tmdb', mode: 'install',
 *     applies: (c) => typeof c.search?.tmdbToken === 'string' && c.search.tmdbToken !== '',
 *     settings: [{ from: 'search.tmdbToken', to: 'token', secret: true }] },
 */
import { OFFICIAL_PREFIX, PLUGIN_ID_RE } from '../../../../packages/plugin-sdk/src/validate.ts';
import { isObjectLike, type Loose } from '../normalize/common.ts';

export interface SettingMove {
  /** Chemin du réglage dans la configuration, clés séparées par des points (`search.tmdbToken`). */
  from: string;
  /** Clé du réglage dans `plugins.<id>` (déclarée par le manifeste du plugin). */
  to: string;
  /** Réglage `secret` du manifeste : rangé comme un secret (chiffré dès que le plugin est installé, voir plus bas). */
  secret?: boolean;
  /** Valeur du plugin d'après l'ancienne (`'FR'` → `'fr'`) ; `undefined` : rien n'est déplacé. */
  convert?(value: unknown): unknown;
  /** Le cœur se sert encore du réglage : il est copié, et reste à sa place. */
  keep?: boolean;
}

export interface ContinuityRule {
  /** Identifiant stable de la règle : la tâche qui l'ajoute (`P5-15`), suivi au besoin d'un suffixe (`P5-17-adblock`). */
  id: string;
  /** Plugin du dépôt officiel qui reprend la fonction. */
  plugin: string;
  /** `bundled` : livré avec Mire, activé tout de suite ; `install` : installé depuis le dépôt officiel dès que possible. */
  mode: 'bundled' | 'install';
  /** La configuration se sert-elle de la fonction ? */
  applies(config: Loose): boolean;
  settings?: readonly SettingMove[];
  /**
   * Fournisseurs d'infos en ligne repris par le plugin : ancien identifiant (`tmdb`) → celui du plugin
   * (`<plugin>/<contribution>`). Appliqué à toute configuration (ordre `catalog.metadataProviders`) et aux fiches déjà
   * enregistrées (`providerRenames`), même quand la règle ne s'applique pas : ce ne sont que des noms.
   */
  providers?: Readonly<Record<string, string>>;
}

/** Toute installation existante : la fonction faisait partie de Mire pour tout le monde. */
const always = (): boolean => true;

const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** Une console sans liste de sites à elle : elle prenait ceux que Mire proposait pour son système. */
const usesDefaultRomSites = (config: Loose): boolean =>
  Array.isArray(config.emulators) && config.emulators.some((e) => isRecord(e) && !Array.isArray(e.romSites));

/** Palette choisie (`ui.theme`), parmi celles données ; P5-02. */
const paletteIn =
  (...ids: string[]) =>
  (c: Loose): boolean =>
    isObjectLike(c.ui) && ids.includes((c.ui as Loose).theme);

/** Le site de streaming `id` est dans la liste des sites (`web`) de la configuration (P5-05). */
const hasSite =
  (id: string) =>
  (c: Loose): boolean =>
    Array.isArray(c.web) && c.web.some((w) => isRecord(w) && w.id === id);

/** Table des règles (P5-02 à P5-20 ajoutent la leur, voir plus haut). */
export const CONTINUITY_RULES: readonly ContinuityRule[] = [
  // P5-04 : profils de manettes, plugins inclus ; tout le monde avait ces profils, aucun réglage à déplacer.
  { id: 'P5-04-xbox', plugin: 'mire.gamepad.xbox', mode: 'bundled', applies: always },
  { id: 'P5-04-playstation', plugin: 'mire.gamepad.playstation', mode: 'bundled', applies: always },
  { id: 'P5-04-nintendo', plugin: 'mire.gamepad.nintendo', mode: 'bundled', applies: always },

  // P5-03 : les sept pages prêtes à l'emploi, plugins inclus ; tout le monde les avait. Les pages modifiées ou supprimées
  // par l'utilisateur restent dans `userData/catalog/pages.json`, que le moteur des pages relit tel quel.
  { id: 'P5-03-movies', plugin: 'mire.page.movies', mode: 'bundled', applies: always },
  { id: 'P5-03-series', plugin: 'mire.page.series', mode: 'bundled', applies: always },
  { id: 'P5-03-music', plugin: 'mire.page.music', mode: 'bundled', applies: always },
  { id: 'P5-03-images', plugin: 'mire.page.images', mode: 'bundled', applies: always },
  { id: 'P5-03-streaming', plugin: 'mire.page.streaming', mode: 'bundled', applies: always },
  { id: 'P5-03-tv', plugin: 'mire.page.tv', mode: 'bundled', applies: always },
  { id: 'P5-03-games', plugin: 'mire.page.games', mode: 'bundled', applies: always },
  // P5-20 : lecteurs externes mpv et VLC, plugin inclus ; tout le monde pouvait s'en servir (formats non lus,
  // télévision). Le programme choisi (`externalPlayer`) reste un réglage du cœur : rien à déplacer.
  { id: 'P5-20', plugin: 'mire.players.external', mode: 'bundled', applies: always },
  // P5-07 : sites de jeux légaux, plugin à installer ; la configuration dit si une console utilisait les sites proposés.
  { id: 'P5-07-sites', plugin: 'mire.game-sites', mode: 'install', applies: usesDefaultRomSites },
  // P5-07 : jeux libres de la boutique, plugin à installer ; la configuration ne dit pas si la liste servait : toute installation existante.
  { id: 'P5-07-libres', plugin: 'mire.free-games', mode: 'install', applies: always },
  // P5-02 : palettes devenues des plugins à installer (une par plugin). Le réglage `ui.theme` reste en place : la
  // palette revient dès que son plugin est installé. « Automatique » prenait Plein jour en mode clair.
  { id: 'P5-02-jour', plugin: 'mire.palette.jour', mode: 'install', applies: paletteIn('jour', 'auto') },
  { id: 'P5-02-minuit', plugin: 'mire.palette.minuit', mode: 'install', applies: paletteIn('minuit') },
  { id: 'P5-02-velours', plugin: 'mire.palette.velours', mode: 'install', applies: paletteIn('velours') },
  // Infos en ligne TMDB et « Où regarder » : ne servaient qu'avec une clé TMDB.
  {
    id: 'P5-15',
    plugin: 'mire.tmdb',
    mode: 'install',
    applies: (c) => nonEmpty(c.search?.tmdbToken),
    settings: [
      { from: 'search.tmdbToken', to: 'token', secret: true, convert: (v) => String(v).trim() },
      { from: 'search.region', to: 'region', convert: (v) => (nonEmpty(v) ? String(v).trim().toLowerCase() : undefined) },
      // La langue des fiches sert aussi à Steam (cœur jusqu'à P5-16).
      { from: 'search.language', to: 'language', keep: true, convert: (v) => (nonEmpty(v) ? String(v).trim() : 'auto') },
    ],
    providers: { tmdb: 'mire.tmdb/tmdb' },
  },
  // P5-05 : services de streaming, un plugin à installer par service ; la configuration dit lesquels étaient en place.
  // Le site reste dans `web` (même identifiant : sa connexion et ses réglages sont retrouvés), le plugin le reprend.
  { id: 'P5-05-netflix', plugin: 'mire.web.netflix', mode: 'install', applies: hasSite('netflix') },
  { id: 'P5-05-prime', plugin: 'mire.web.prime', mode: 'install', applies: hasSite('prime') },
  { id: 'P5-05-disney', plugin: 'mire.web.disney', mode: 'install', applies: hasSite('disney') },
  { id: 'P5-05-canal', plugin: 'mire.web.canal', mode: 'install', applies: hasSite('canal') },
  { id: 'P5-05-hbomax', plugin: 'mire.web.hbomax', mode: 'install', applies: hasSite('hbomax') },
  { id: 'P5-05-appletv', plugin: 'mire.web.appletv', mode: 'install', applies: hasSite('appletv') },
  { id: 'P5-05-paramount', plugin: 'mire.web.paramount', mode: 'install', applies: hasSite('paramount') },
  { id: 'P5-05-crunchyroll', plugin: 'mire.web.crunchyroll', mode: 'install', applies: hasSite('crunchyroll') },
  { id: 'P5-05-youtube', plugin: 'mire.web.youtube', mode: 'install', applies: hasSite('youtube') },
  { id: 'P5-05-francetv', plugin: 'mire.web.francetv', mode: 'install', applies: hasSite('francetv') },
  { id: 'P5-05-amazon-music', plugin: 'mire.web.amazon-music', mode: 'install', applies: hasSite('amazon-music') },
  { id: 'P5-05-spotify', plugin: 'mire.web.spotify', mode: 'install', applies: hasSite('spotify') },
  { id: 'P5-05-deezer', plugin: 'mire.web.deezer', mode: 'install', applies: hasSite('deezer') },
  // P5-09 : tags automatiques (séries, films, musique, consoles, photos), plugins inclus ; tout le monde les avait.
  // Aucun réglage : les tags et infos saisis à la main restent dans `userData/catalog/overrides.json`.
  { id: 'P5-09-series', plugin: 'mire.tags.series', mode: 'bundled', applies: always },
  { id: 'P5-09-movies', plugin: 'mire.tags.movies', mode: 'bundled', applies: always },
  { id: 'P5-09-music', plugin: 'mire.tags.music', mode: 'bundled', applies: always },
  { id: 'P5-09-consoles', plugin: 'mire.tags.consoles', mode: 'bundled', applies: always },
  { id: 'P5-09-photos', plugin: 'mire.tags.photos', mode: 'bundled', applies: always },
];

/**
 * Messages à l'utilisateur sans plugin à la clé : une fonction qui disparaît du catalogue de Mire mais que la
 * configuration garde (P5-05 : JustStream et Voir-Anime, restés comme sites ajoutés à la main, D-21). La note entre
 * dans la même file `continuity` ; le service de continuité la montre une fois (`key` : texte de `continuity.notes`).
 */
export interface ContinuityNote {
  id: string;
  key: string;
  applies(config: Loose): boolean;
}

export const CONTINUITY_NOTES: readonly ContinuityNote[] = [
  { id: 'P5-05-juststream', key: 'juststream', applies: hasSite('juststream') },
  { id: 'P5-05-voir-anime', key: 'voir-anime', applies: hasSite('voir-anime') },
];

/** Fournisseurs d'infos renommés par les règles : ancien identifiant → celui du plugin qui le reprend. */
export function providerRenames(rules: readonly ContinuityRule[] = CONTINUITY_RULES): Record<string, string> {
  return Object.assign({}, ...rules.map((r) => r.providers ?? {}));
}

/** Ordre des fournisseurs (`catalog.metadataProviders`) avec les nouveaux identifiants, sans doublon. */
function renameProviders(raw: Loose, renames: Record<string, string>): void {
  const list = isRecord(raw.catalog) ? raw.catalog.metadataProviders : undefined;
  if (!Array.isArray(list) || !list.some((x) => typeof x === 'string' && Object.hasOwn(renames, x))) return;
  raw.catalog.metadataProviders = [...new Set(list.map((x) => (typeof x === 'string' && Object.hasOwn(renames, x) ? renames[x] : x)))];
}

export const RULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/** Problèmes d'une table de règles, en anglais pour le développeur (vide : elle convient). Vérifiée par les tests et au démarrage du service. */
export function checkRules(rules: readonly ContinuityRule[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of rules) {
    if (!RULE_ID_RE.test(r.id)) problems.push(`${r.id}: invalid rule id.`);
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate rule.`);
    ids.add(r.id);
    if (!PLUGIN_ID_RE.test(r.plugin) || !r.plugin.startsWith(OFFICIAL_PREFIX))
      problems.push(`${r.id}: ${r.plugin} is not a plugin of the official repository.`);
    if (r.mode !== 'bundled' && r.mode !== 'install') problems.push(`${r.id}: unknown mode.`);
    for (const s of r.settings ?? []) if (!s.from || !s.to) problems.push(`${r.id}: incomplete setting move.`);
    for (const [from, to] of Object.entries(r.providers ?? {}))
      if (!from || !to.startsWith(`${r.plugin}/`)) problems.push(`${r.id}: provider ${from} must be renamed to one of ${r.plugin}.`);
  }
  return problems;
}

const isRecord = (v: unknown): v is Loose => isObjectLike(v) && !Array.isArray(v);

/** Valeur qu'un réglage de plugin peut garder (comme `normalizePluginSettings`). */
const isSettingValue = (v: unknown): boolean =>
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/** Déplace un réglage s'il a une valeur reconnue ; sinon il reste où il est (rien n'est perdu). */
function moveSetting(raw: Loose, plugin: string, move: SettingMove): void {
  const keys = move.from.split('.');
  const last = keys.pop()!;
  let parent: unknown = raw;
  for (const k of keys) parent = isRecord(parent) ? parent[k] : undefined;
  if (!isRecord(parent) || !Object.hasOwn(parent, last) || !isSettingValue(parent[last])) return;
  let value: unknown = parent[last];
  try {
    value = move.convert ? move.convert(value) : value;
  } catch {
    value = undefined;
  }
  if (value === undefined || !isSettingValue(value)) return;
  if (!isRecord(raw.plugins)) raw.plugins = {};
  if (!isRecord(raw.plugins[plugin])) raw.plugins[plugin] = {};
  const target: Loose = raw.plugins[plugin];
  // Un réglage déjà là (fichier modifié à la main, import) l'emporte sur l'ancien emplacement.
  if (!Object.hasOwn(target, move.to)) {
    // Pas de `safeStorage` pendant la migration : le secret est rangé en clair, comme quand le système ne chiffre pas,
    // puis chiffré par le service de continuité dès que le plugin est installé (`seal`).
    target[move.to] = move.secret ? { $secret: String(value), encrypted: false } : structuredClone(value);
  }
  if (!move.keep) delete parent[last];
}

/** Applique les règles à une configuration lue (modifiée sur place) ; rend les identifiants des règles appliquées. */
export function applyContinuity(
  raw: Loose,
  rules: readonly ContinuityRule[] = CONTINUITY_RULES,
  notes: readonly ContinuityNote[] = CONTINUITY_NOTES,
): string[] {
  renameProviders(raw, providerRenames(rules));
  const applied: string[] = [];
  for (const note of notes) {
    try {
      if (note.applies(raw) === true) applied.push(note.id);
    } catch {
      // Configuration mal formée : pas de message.
    }
  }
  for (const rule of rules) {
    let applies = false;
    try {
      applies = rule.applies(raw) === true;
    } catch {
      // Configuration mal formée que la règle n'a pas prévue : la fonction n'était pas utilisable.
    }
    if (!applies) continue;
    for (const move of rule.settings ?? []) moveSetting(raw, rule.plugin, move);
    applied.push(rule.id);
  }
  if (applied.length) raw.continuity = [...new Set([...normalizeContinuityQueue(raw.continuity), ...applied])];
  return applied;
}

/** File `continuity` de la configuration : identifiants de règles bien formés, sans doublon. */
export function normalizeContinuityQueue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && RULE_ID_RE.test(x)))];
}
