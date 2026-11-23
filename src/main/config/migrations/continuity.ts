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
 *    déclaré par le manifeste du plugin (`token`), `secret: true` pour un réglage `secret` ;
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
  /** Réglage `secret` du manifeste : rangé comme un secret (chiffré au prochain changement, voir plus bas). */
  secret?: boolean;
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
}

/** Toute installation existante : la fonction faisait partie de Mire pour tout le monde. */
const always = (): boolean => true;

/** Table des règles (P5-02 à P5-20 ajoutent la leur, voir plus haut). */
export const CONTINUITY_RULES: readonly ContinuityRule[] = [
  // P5-04 : profils de manettes, plugins inclus ; tout le monde avait ces profils, aucun réglage à déplacer.
  { id: 'P5-04-xbox', plugin: 'mire.gamepad.xbox', mode: 'bundled', applies: always },
  { id: 'P5-04-playstation', plugin: 'mire.gamepad.playstation', mode: 'bundled', applies: always },
  { id: 'P5-04-nintendo', plugin: 'mire.gamepad.nintendo', mode: 'bundled', applies: always },
  // P5-20 : lecteurs externes mpv et VLC, plugin inclus ; tout le monde pouvait s'en servir (formats non lus,
  // télévision). Le programme choisi (`externalPlayer`) reste un réglage du cœur : rien à déplacer.
  { id: 'P5-20', plugin: 'mire.players.external', mode: 'bundled', applies: always },
];

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
  const value = parent[last];
  if (!isRecord(raw.plugins)) raw.plugins = {};
  if (!isRecord(raw.plugins[plugin])) raw.plugins[plugin] = {};
  const target: Loose = raw.plugins[plugin];
  // Un réglage déjà là (fichier modifié à la main, import) l'emporte sur l'ancien emplacement.
  if (!Object.hasOwn(target, move.to)) {
    // Pas de `safeStorage` pendant la migration : le secret est rangé en clair, comme quand le système ne chiffre pas.
    target[move.to] = move.secret ? { $secret: String(value), encrypted: false } : structuredClone(value);
  }
  delete parent[last];
}

/** Applique les règles à une configuration lue (modifiée sur place) ; rend les identifiants des règles appliquées. */
export function applyContinuity(raw: Loose, rules: readonly ContinuityRule[] = CONTINUITY_RULES): string[] {
  const applied: string[] = [];
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
