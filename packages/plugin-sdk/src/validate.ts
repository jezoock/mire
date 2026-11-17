/**
 * Validation d'un manifeste (`mire-plugin.json`), sans accès aux fichiers : champs et valeurs permises, cohérence
 * entre le niveau et les contributions, préfixe `mire.` réservé au dépôt officiel. Écrite à la main (D-03) d'après
 * les listes de `manifest.ts`, comme le schéma JSON ; un test garde les deux d'accord. La vérification des fichiers
 * déclarés et des textes est dans `validate-dir.ts`.
 */
import {
  CODE_CONTRIBUTIONS,
  CONTRIBUTION_FIELDS,
  CONTRIBUTION_KINDS,
  CONTRIBUTION_LEVEL,
  INFO_FIELDS,
  INFO_TYPES,
  MANIFEST_FIELDS,
  METADATA_KINDS,
  PERMISSIONS,
  PLUGIN_LEVELS,
  PRIVILEGED_PERMISSIONS,
  REQUIRED_FIELDS,
  SETTING_FIELDS,
  SETTING_TYPES,
  type CodeContributionKind,
  type ContributionKind,
  type PluginLevel,
  type PluginManifest,
} from './manifest.ts';
import { isVersion, isVersionRange } from './semver.ts';

/** Identifiant d'un plugin : notation inversée, au moins deux parties (`org.exemple.radios`). */
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
/** Identifiant d'une contribution ou d'un tag : minuscules, chiffres et tirets. */
export const LOCAL_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
/** Identifiant d'une info ou clé d'un réglage (celui des infos du cœur). */
export const INFO_ID_RE = /^[a-z][a-zA-Z0-9]{0,63}$/;
/** Valeur d'un réglage `choice`. */
export const OPTION_RE = /^[a-z0-9][a-zA-Z0-9-]{0,63}$/;
/** Hôte Internet, éventuellement précédé de `*.` pour ses sous-domaines. */
export const HOST_RE = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Préfixe réservé au dépôt officiel. */
export const OFFICIAL_PREFIX = 'mire.';

const LEVEL_RANK: Record<PluginLevel, number> = { data: 0, code: 1, privileged: 2 };

/** Problème trouvé : un code stable (pour les outils et les tests), l'endroit, et un message en français. */
export interface ValidationIssue {
  code: string;
  /** Endroit du manifeste ou du dossier : `contributes.sources[0].main`, `i18n/en.json`… */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** Validation pour le dépôt officiel : le préfixe `mire.` est permis, les textes français sont obligatoires. */
  official?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);
const isCodeKind = (k: string): k is CodeContributionKind => has(CODE_CONTRIBUTIONS, k);

/**
 * Chemin relatif au dossier du plugin : séparateurs `/`, sans `.` ni `..`, ni chemin absolu. `dir` : un `/` final
 * est permis (dossier).
 */
export function isPluginPath(v: unknown, dir = false): v is string {
  if (typeof v !== 'string' || !v || v.length > 256) return false;
  const p = dir && v.endsWith('/') ? v.slice(0, -1) : v;
  if (!p || /[\\:]/.test(p) || p.startsWith('/')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

class Checker {
  readonly issues: ValidationIssue[] = [];

  add(code: string, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  /** Champs inconnus d'un objet (listes fermées). */
  fields(o: Obj, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) this.add('unknown-field', path ? `${path}.${k}` : k, `Champ inconnu : « ${k} ».`);
    }
  }

  required(o: Obj, names: readonly string[], path: string): void {
    for (const k of names) {
      if (o[k] === undefined) this.add('missing-field', path ? `${path}.${k}` : k, `Champ obligatoire absent : « ${k} ».`);
    }
  }

  stringList(v: unknown, path: string, re: RegExp, what: string): string[] {
    if (!Array.isArray(v)) {
      this.add('invalid-type', path, `${what} : une liste est attendue.`);
      return [];
    }
    const seen = new Set<string>();
    v.forEach((x, i) => {
      if (typeof x !== 'string' || !re.test(x)) this.add('invalid-value', `${path}[${i}]`, `${what} : valeur invalide ${JSON.stringify(x)}.`);
      else if (seen.has(x)) this.add('duplicate-value', `${path}[${i}]`, `${what} : « ${x} » est en double.`);
      else seen.add(x);
    });
    return [...seen];
  }
}

function checkId(c: Checker, id: unknown, opts: ValidateOptions): void {
  if (typeof id !== 'string' || id.length > 128 || !PLUGIN_ID_RE.test(id)) {
    c.add('invalid-id', 'id', 'Identifiant invalide : notation inversée en minuscules attendue (org.exemple.plugin).');
  } else if (id.startsWith(OFFICIAL_PREFIX) && !opts.official) {
    c.add('reserved-prefix', 'id', `Le préfixe « ${OFFICIAL_PREFIX} » est réservé au dépôt officiel.`);
  }
}

function checkEngines(c: Checker, v: unknown): void {
  if (!isObj(v)) {
    c.add('invalid-type', 'engines', 'engines : un objet { "mire": "<plage de versions>" } est attendu.');
    return;
  }
  c.fields(v, ['mire'], 'engines');
  if (!isVersionRange(v.mire)) c.add('invalid-engine', 'engines.mire', 'engines.mire : plage de versions de Mire invalide (exemple : ^1.0.0).');
}

function checkInfos(c: Checker, v: unknown, path: string): void {
  if (!isObj(v)) {
    c.add('invalid-type', path, 'infos : un objet { identifiant: déclaration } est attendu.');
    return;
  }
  for (const [id, decl] of Object.entries(v)) {
    const p = `${path}.${id}`;
    if (!INFO_ID_RE.test(id)) c.add('invalid-info', p, `Identifiant d'info invalide : « ${id} ».`);
    if (!isObj(decl)) {
      c.add('invalid-info', p, 'Déclaration d’info invalide : { "type": … } attendu.');
      continue;
    }
    c.fields(decl, INFO_FIELDS, p);
    if (!has(INFO_TYPES, decl.type)) c.add('invalid-info', `${p}.type`, `Type d'info inconnu ; permis : ${INFO_TYPES.join(', ')}.`);
    if (decl.searchable !== undefined && typeof decl.searchable !== 'boolean') c.add('invalid-type', `${p}.searchable`, 'searchable : oui/non attendu.');
  }
}

function checkEntry(c: Checker, kind: ContributionKind, e: unknown, path: string, level: PluginLevel | undefined): void {
  if (!isObj(e)) {
    c.add('invalid-type', path, 'Une contribution est un objet.');
    return;
  }
  const code = isCodeKind(kind);
  if (!code && e.main !== undefined) c.add('code-in-data', `${path}.main`, `Une contribution « ${kind} » est faite de données : pas de « main ».`);
  // Un `main` de données est déjà signalé : pas de second message « champ inconnu ».
  const { main: _main, ...rest } = e;
  c.fields(code ? e : rest, CONTRIBUTION_FIELDS[kind], path);
  c.required(e, contributionRequired(kind), path);
  if (e.id !== undefined && (typeof e.id !== 'string' || !LOCAL_ID_RE.test(e.id))) c.add('invalid-id', `${path}.id`, 'Identifiant de contribution invalide.');
  const file = code ? 'main' : 'file';
  if (e[file] !== undefined && !isPluginPath(e[file])) c.add('invalid-path', `${path}.${file}`, 'Chemin invalide : relatif au dossier du plugin, sans « .. ».');
  if (e.tags !== undefined) c.stringList(e.tags, `${path}.tags`, LOCAL_ID_RE, 'tags');
  if (e.kinds !== undefined) c.stringList(e.kinds, `${path}.kinds`, new RegExp(`^(?:${METADATA_KINDS.join('|')})$`), 'kinds');
  if (Array.isArray(e.kinds) && e.kinds.length === 0) c.add('invalid-value', `${path}.kinds`, 'kinds : au moins une nature.');
  if (e.infos !== undefined) checkInfos(c, e.infos, `${path}.infos`);
  if (!code || !level) return;
  if (level === 'data') c.add('code-in-data', path, `Un plugin de niveau « data » ne contient pas de code (contribution « ${kind} »).`);
  else if (LEVEL_RANK[level] < LEVEL_RANK[CONTRIBUTION_LEVEL[kind]]) {
    c.add('level-too-low', path, `Une contribution « ${kind} » demande le niveau « ${CONTRIBUTION_LEVEL[kind]} ».`);
  }
}

/** Champs obligatoires d'une entrée de `contributes`. */
export function contributionRequired(kind: ContributionKind): string[] {
  const req = ['id', isCodeKind(kind) ? 'main' : 'file'];
  if (kind === 'metadata') req.push('kinds');
  return req;
}

function checkContributes(c: Checker, v: unknown, level: PluginLevel | undefined): void {
  if (!isObj(v)) {
    c.add('invalid-type', 'contributes', 'contributes : un objet est attendu.');
    return;
  }
  let count = 0;
  for (const [kind, list] of Object.entries(v)) {
    const path = `contributes.${kind}`;
    if (!has(CONTRIBUTION_KINDS, kind)) {
      c.add('unknown-contribution', path, `Contribution inconnue : « ${kind} » ; permises : ${CONTRIBUTION_KINDS.join(', ')}.`);
      continue;
    }
    if (!Array.isArray(list)) {
      c.add('invalid-type', path, `${kind} : une liste est attendue.`);
      continue;
    }
    const ids = new Set<unknown>();
    list.forEach((e, i) => {
      checkEntry(c, kind as ContributionKind, e, `${path}[${i}]`, level);
      const id = isObj(e) ? e.id : undefined;
      if (id !== undefined && ids.has(id)) c.add('duplicate-id', `${path}[${i}].id`, `Identifiant en double dans ${kind} : « ${String(id)} ».`);
      ids.add(id);
    });
    count += list.length;
  }
  if (count === 0) c.add('empty-contributions', 'contributes', 'Le plugin ne contribue rien.');
}

function checkPermissions(c: Checker, v: unknown, level: PluginLevel | undefined): void {
  if (!isObj(v)) {
    c.add('invalid-type', 'permissions', 'permissions : un objet est attendu.');
    return;
  }
  for (const [name, value] of Object.entries(v)) {
    const path = `permissions.${name}`;
    if (!has(PERMISSIONS, name)) {
      c.add('unknown-permission', path, `Permission inconnue : « ${name} » ; permises : ${PERMISSIONS.join(', ')}.`);
      continue;
    }
    if (name === 'hosts') c.stringList(value, path, HOST_RE, 'hosts');
    else if (typeof value !== 'boolean') c.add('invalid-type', path, `${name} : oui/non attendu.`);
    const asked = name === 'hosts' ? Array.isArray(value) && value.length > 0 : value === true;
    if (!asked || !level) continue;
    if (level === 'data') c.add('permission-in-data', path, 'Un plugin de niveau « data » n’exécute rien : il ne demande aucune permission.');
    else if (has(PRIVILEGED_PERMISSIONS, name) && level !== 'privileged') {
      c.add('privileged-permission', path, `La permission « ${name} » demande le niveau « privileged ».`);
    }
  }
}

function checkDependencies(c: Checker, v: unknown, self: unknown): void {
  if (!isObj(v)) {
    c.add('invalid-type', 'dependencies', 'dependencies : un objet { identifiant: plage de versions } est attendu.');
    return;
  }
  for (const [id, range] of Object.entries(v)) {
    const path = `dependencies.${id}`;
    if (!PLUGIN_ID_RE.test(id)) c.add('invalid-dependency', path, `Identifiant de plugin invalide : « ${id} ».`);
    else if (id === self) c.add('self-dependency', path, 'Un plugin ne dépend pas de lui-même.');
    if (!isVersionRange(range)) c.add('invalid-dependency', path, `Plage de versions invalide pour « ${id} ».`);
  }
}

function checkSetting(c: Checker, s: unknown, path: string): void {
  if (!isObj(s)) {
    c.add('invalid-type', path, 'Un réglage est un objet.');
    return;
  }
  c.fields(s, SETTING_FIELDS, path);
  c.required(s, ['key', 'type'], path);
  if (s.key !== undefined && (typeof s.key !== 'string' || !INFO_ID_RE.test(s.key))) c.add('invalid-setting', `${path}.key`, 'Clé de réglage invalide.');
  if (s.type !== undefined && !has(SETTING_TYPES, s.type))
    c.add('invalid-setting', `${path}.type`, `Type de réglage inconnu ; permis : ${SETTING_TYPES.join(', ')}.`);
  const options = s.type === 'choice' ? c.stringList(s.options ?? [], `${path}.options`, OPTION_RE, 'options') : [];
  if (s.type === 'choice' && options.length === 0) c.add('invalid-setting', `${path}.options`, 'Un réglage « choice » propose au moins une valeur.');
  if (s.type !== 'choice' && s.options !== undefined) c.add('invalid-setting', `${path}.options`, 'options : seulement pour un réglage « choice ».');
  if (s.default !== undefined && !defaultFits(s.type, s.default, options))
    c.add('invalid-setting', `${path}.default`, 'Valeur par défaut invalide pour ce type de réglage.');
}

function defaultFits(type: unknown, v: unknown, options: string[]): boolean {
  if (type === 'toggle') return typeof v === 'boolean';
  if (type === 'list') return Array.isArray(v) && v.every((x) => typeof x === 'string');
  // Une clé d'API par défaut serait publique : un réglage secret n'en a pas.
  if (type === 'secret') return false;
  if (type === 'choice') return options.includes(v as string);
  return typeof v === 'string';
}

function checkSettings(c: Checker, v: unknown): void {
  if (!Array.isArray(v)) {
    c.add('invalid-type', 'settings', 'settings : une liste est attendue.');
    return;
  }
  const keys = new Set<unknown>();
  v.forEach((s, i) => {
    checkSetting(c, s, `settings[${i}]`);
    const key = isObj(s) ? s.key : undefined;
    if (key !== undefined && keys.has(key)) c.add('duplicate-setting', `settings[${i}].key`, `Réglage en double : « ${String(key)} ».`);
    keys.add(key);
  });
}

/** Vérifie un manifeste déjà lu (objet JSON). */
export function validateManifest(manifest: unknown, opts: ValidateOptions = {}): ValidationResult {
  const c = new Checker();
  if (!isObj(manifest)) {
    c.add('invalid-type', '', 'Le manifeste est un objet JSON.');
    return { ok: false, issues: c.issues };
  }
  const m = manifest;
  c.fields(m, MANIFEST_FIELDS, '');
  c.required(m, REQUIRED_FIELDS, '');
  if (m.$schema !== undefined && typeof m.$schema !== 'string') c.add('invalid-type', '$schema', '$schema : une adresse est attendue.');
  if (m.id !== undefined) checkId(c, m.id, opts);
  if (m.version !== undefined && !isVersion(m.version)) c.add('invalid-version', 'version', 'Version invalide (semver attendu : 1.2.0).');
  if (m.engines !== undefined) checkEngines(c, m.engines);
  const level = has(PLUGIN_LEVELS, m.level) ? (m.level as PluginLevel) : undefined;
  if (m.level !== undefined && !level) c.add('unknown-level', 'level', `Niveau inconnu ; permis : ${PLUGIN_LEVELS.join(', ')}.`);
  if (m.contributes !== undefined) checkContributes(c, m.contributes, level);
  if (m.permissions !== undefined) checkPermissions(c, m.permissions, level);
  if (m.dependencies !== undefined) checkDependencies(c, m.dependencies, m.id);
  if (m.settings !== undefined) checkSettings(c, m.settings);
  if (m.i18n !== undefined && !isPluginPath(m.i18n, true)) c.add('invalid-path', 'i18n', 'i18n : dossier relatif au plugin attendu (i18n/).');
  return { ok: c.issues.length === 0, issues: c.issues };
}

/**
 * Textes qu'un manifeste valide demande au catalogue de chaque langue obligatoire : le nom du plugin, ceux des tags
 * et des infos déclarés, les libellés des réglages et de leurs valeurs.
 */
export function requiredTexts(m: PluginManifest): string[] {
  const keys = new Set<string>(['plugin.name']);
  for (const kind of CODE_CONTRIBUTIONS) {
    const list = (m.contributes[kind] ?? []) as { tags?: string[]; infos?: Record<string, unknown> }[];
    for (const e of list) {
      for (const t of e.tags ?? []) keys.add(`tags.${t}`);
      for (const id of Object.keys(e.infos ?? {})) keys.add(`infos.${id}`);
    }
  }
  for (const s of m.settings ?? []) {
    keys.add(`settings.${s.key}.label`);
    for (const o of s.options ?? []) keys.add(`settings.${s.key}.options.${o}`);
  }
  return [...keys];
}

/** Fichiers que le manifeste déclare (`main` et `file` des contributions), relatifs au dossier du plugin. */
export function declaredFiles(m: PluginManifest): { path: string; file: string }[] {
  const out: { path: string; file: string }[] = [];
  for (const kind of CONTRIBUTION_KINDS) {
    const list: { main?: string; file?: string }[] = m.contributes[kind] ?? [];
    list.forEach((e, i) => {
      const key = isCodeKind(kind) ? 'main' : 'file';
      const file = e[key];
      if (file) out.push({ path: `contributes.${kind}[${i}].${key}`, file });
    });
  }
  return out;
}
