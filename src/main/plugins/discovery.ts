/**
 * Découverte et vérification des plugins (architecture cible, « Plugins inclus, plugins à installer ») :
 * - inclus : `resources/plugins/<id>/` ; installés : `userData/plugins/<id>/<version>/` ;
 * - chemins vérifiés après résolution des liens symboliques : le dossier du plugin, et chaque fichier qu'il contient,
 *   restent sous leur racine ;
 * - manifeste vérifié par `validatePluginDir` du SDK, identifiant et version d'accord avec le dossier,
 *   compatibilité `engines.mire`, niveau vérifié d'après ce que le dossier contient (jamais supposé) ;
 * - un plugin `privileged` n'est accepté que parmi les plugins inclus, tant que la signature et la confiance des
 *   dépôts n'existent pas (P3-07, P3-08) ;
 * - textes (`i18n`) et fichiers des contributions de données lus ici, par le cœur.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Messages } from '@mire/shared/i18n';
import type { ContributionKind, PluginManifest } from '@mire/plugin-sdk';
// Sources du SDK plutôt que son paquet : son dist/ n'est construit que pour son archive (les tests lisent les sources).
import { CODE_CONTRIBUTIONS, CONTRIBUTION_KINDS, DATA_CONTRIBUTIONS, MANIFEST_FILE } from '../../../packages/plugin-sdk/src/manifest.ts';
import { PLUGIN_ID_RE } from '../../../packages/plugin-sdk/src/validate.ts';
import { validatePluginDir } from '../../../packages/plugin-sdk/src/validate-dir.ts';
import { compareVersions, parseVersion, satisfies } from './semver.ts';

export type PluginOrigin = 'bundled' | 'installed';

/** Raison d'un refus, stable : le message affiché est `plugins.refused.<code>` dans les catalogues. */
export type RefusalCode = 'invalid' | 'mismatch' | 'engine' | 'level' | 'privileged' | 'outside' | 'data' | 'texts' | 'too-big';

export interface Refusal {
  code: RefusalCode;
  /** Détails pour le journal et les variables du message (`{details}`, `{range}`…). */
  vars: Record<string, string>;
}

/** Dossier trouvé, avant vérification. */
export interface PluginCandidate {
  /** Identifiant d'après le dossier. */
  id: string;
  /** Version d'après le dossier (installés), ou `null` (inclus : celle du manifeste). */
  version: string | null;
  origin: PluginOrigin;
  /** Chemin réel du dossier (liens résolus). */
  dir: string;
}

/** Plugin vérifié : manifeste, textes, données des contributions de données. */
export interface CheckedPlugin {
  id: string;
  version: string;
  origin: PluginOrigin;
  dir: string;
  manifest: PluginManifest;
  /** Textes du plugin par langue de Mire (`fr`, `en`) : arbre `messages` de son catalogue. */
  texts: Record<string, Messages>;
  /** Contenu des fichiers JSON des contributions de données, par `<nature>/<id>` (autres fichiers : `null`). */
  data: Map<string, unknown>;
}

export type CheckResult = { ok: true; plugin: CheckedPlugin } | { ok: false; refusal: Refusal };

export interface DiscoveryRoots {
  /** `resources/plugins/` (plugins inclus), s'il existe. */
  bundled: string | null;
  /** `userData/plugins/` (plugins installés). */
  installed: string;
}

/** Ce qui a été trouvé : candidats et dossiers écartés avant toute lecture (nom ou chemin refusé). */
export interface Discovery {
  candidates: PluginCandidate[];
  skipped: { where: string; refusal: Refusal }[];
}

// Bornes : un plugin est un petit dossier ; au-delà, il est refusé plutôt que parcouru indéfiniment.
const MAX_FILES = 5000;
const MAX_DEPTH = 16;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const CODE_FILE = /\.(?:m?js|cjs|wasm|node)$/i;

const realpath = (p: string): string | null => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};
const inside = (root: string, p: string): boolean => p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const dirs = (root: string): string[] => {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
};
const refusal = (code: RefusalCode, vars: Record<string, string> = {}): Refusal => ({ code, vars });

/** Dossier d'un plugin, liens résolus, s'il reste sous sa racine (elle-même résolue). */
function resolveUnder(realRoot: string, dir: string): string | null {
  const real = realpath(dir);
  return real && inside(realRoot, real) && fs.statSync(real).isDirectory() ? real : null;
}

/** Plugins inclus et installés. Pour un même identifiant installé en plusieurs versions, la plus haute. */
export function discoverPlugins(roots: DiscoveryRoots): Discovery {
  const found = new Map<string, PluginCandidate>();
  const skipped: Discovery['skipped'] = [];

  const consider = (c: PluginCandidate) => {
    const prev = found.get(c.id);
    // Même plugin inclus et installé : la version la plus haute (mise à jour par le dépôt, P3-05), l'inclus à égalité.
    if (!prev || (c.version && (!prev.version || compareVersions(parseVersion(c.version)!, parseVersion(prev.version)!) > 0))) found.set(c.id, c);
  };

  const bundledRoot = roots.bundled && realpath(roots.bundled);
  if (bundledRoot) {
    for (const name of dirs(bundledRoot)) {
      const where = path.join(bundledRoot, name);
      if (!PLUGIN_ID_RE.test(name)) continue;
      const dir = resolveUnder(bundledRoot, where);
      if (!dir) skipped.push({ where, refusal: refusal('outside') });
      else consider({ id: name, version: null, origin: 'bundled', dir });
    }
  }

  const installedRoot = realpath(roots.installed);
  if (installedRoot) {
    for (const name of dirs(installedRoot)) {
      // Autres dossiers éventuels (journaux, état) : seuls les identifiants de plugin sont lus.
      if (!PLUGIN_ID_RE.test(name)) continue;
      const versions = dirs(path.join(installedRoot, name))
        .filter((v) => parseVersion(v))
        .sort((a, b) => compareVersions(parseVersion(b)!, parseVersion(a)!));
      if (!versions.length) continue;
      const where = path.join(installedRoot, name, versions[0]);
      const dir = resolveUnder(installedRoot, where);
      if (!dir) skipped.push({ where, refusal: refusal('outside') });
      else consider({ id: name, version: versions[0], origin: 'installed', dir });
    }
  }
  return { candidates: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), skipped };
}

/** Fichiers du dossier (chemins relatifs) ; refuse un lien qui sort du dossier, un dossier trop gros ou trop profond. */
async function listFiles(dir: string): Promise<{ ok: true; files: string[] } | { ok: false; refusal: Refusal }> {
  const files: string[] = [];
  const walk = async (rel: string, depth: number): Promise<Refusal | null> => {
    if (depth > MAX_DEPTH) return refusal('too-big');
    const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, relPath);
      if (e.isSymbolicLink()) {
        const real = realpath(full);
        if (!real || !inside(dir, real)) return refusal('outside', { details: relPath });
        // Un lien vers un dossier du plugin n'est pas suivi : son contenu est déjà parcouru.
        if (fs.statSync(real).isFile()) files.push(relPath);
      } else if (e.isDirectory()) {
        const r = await walk(relPath, depth + 1);
        if (r) return r;
      } else if (e.isFile()) files.push(relPath);
      if (files.length > MAX_FILES) return refusal('too-big');
    }
    return null;
  };
  const r = await walk('', 0);
  return r ? { ok: false, refusal: r } : { ok: true, files };
}

/** Le niveau déclaré correspond-il à ce que le dossier contient ? */
function levelMatches(m: PluginManifest, files: string[]): Refusal | null {
  const hasCodeContribution = CODE_CONTRIBUTIONS.some((k) => (m.contributes[k] ?? []).length > 0);
  if (m.level === 'data') {
    const code = files.find((f) => CODE_FILE.test(f));
    return code ? refusal('level', { level: m.level, details: code }) : null;
  }
  // `code` ou `privileged` sans aucune contribution de code : niveau plus haut que nécessaire, refusé (D-18).
  return hasCodeContribution ? null : refusal('level', { level: m.level, details: '' });
}

async function readJson(file: string): Promise<unknown> {
  const stat = await fsp.stat(file);
  if (stat.size > MAX_JSON_BYTES) throw new Error(`${path.basename(file)} : plus de ${MAX_JSON_BYTES / 1024 / 1024} Mo`);
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/** Textes du plugin pour les langues de Mire ; l'anglais est obligatoire (vérifié par le SDK). */
async function readTexts(dir: string, m: PluginManifest, languages: readonly string[]): Promise<Record<string, Messages>> {
  const texts: Record<string, Messages> = {};
  for (const lang of languages) {
    const file = path.join(dir, m.i18n.replace(/\/$/, ''), `${lang}.json`);
    if (!fs.existsSync(file)) continue;
    const cat = (await readJson(file)) as { meta?: { code?: unknown }; messages?: unknown };
    if (cat?.meta?.code !== lang || !cat.messages || typeof cat.messages !== 'object' || Array.isArray(cat.messages)) throw new Error(`${lang}.json`);
    texts[lang] = cat.messages as Messages;
  }
  return texts;
}

/** Fichiers des contributions de données : JSON lu et vérifié lisible ; les autres fichiers (images, polices) sont seulement présents. */
async function readData(dir: string, m: PluginManifest): Promise<Map<string, unknown>> {
  const data = new Map<string, unknown>();
  for (const kind of DATA_CONTRIBUTIONS) {
    for (const c of m.contributes[kind] ?? []) {
      const file = path.join(dir, c.file);
      data.set(`${kind}/${c.id}`, /\.json$/i.test(c.file) ? await readJson(file) : null);
    }
  }
  return data;
}

export interface CheckOptions {
  /** Version de Mire (`app.getVersion()`). */
  appVersion: string;
  /** Langues de Mire dont on charge les textes du plugin. */
  languages: readonly string[];
}

/** Vérifie un candidat : rend le plugin lu, ou la raison du refus. */
export async function checkPlugin(c: PluginCandidate, { appVersion, languages }: CheckOptions): Promise<CheckResult> {
  const fail = (code: RefusalCode, vars: Record<string, string> = {}): CheckResult => ({ ok: false, refusal: refusal(code, vars) });
  const listed = await listFiles(c.dir).catch((err: Error) => ({ ok: false as const, refusal: refusal('invalid', { details: err.message }) }));
  if (!listed.ok) return { ok: false, refusal: listed.refusal };
  if (!listed.files.includes(MANIFEST_FILE)) return fail('invalid', { details: `${MANIFEST_FILE} absent` });

  const result = await validatePluginDir(c.dir, { official: c.origin === 'bundled' });
  if (!result.ok)
    return fail('invalid', {
      details: result.issues
        .slice(0, 5)
        .map((i) => `${i.path} : ${i.message}`)
        .join(' ; '),
    });
  const m = (await readJson(path.join(c.dir, MANIFEST_FILE))) as PluginManifest;
  if (m.id !== c.id || (c.version && m.version !== c.version)) return fail('mismatch', { details: `${m.id} ${m.version}` });
  if (!satisfies(appVersion, m.engines.mire)) return fail('engine', { range: m.engines.mire, version: appVersion });
  const level = levelMatches(m, listed.files);
  if (level) return { ok: false, refusal: level };
  if (m.level === 'privileged' && c.origin !== 'bundled') return fail('privileged');

  let texts: Record<string, Messages>;
  try {
    texts = await readTexts(c.dir, m, languages);
  } catch (err) {
    return fail('texts', { details: (err as Error).message });
  }
  let data: Map<string, unknown>;
  try {
    data = await readData(c.dir, m);
  } catch (err) {
    return fail('data', { details: (err as Error).message });
  }
  return { ok: true, plugin: { id: m.id, version: m.version, origin: c.origin, dir: c.dir, manifest: m, texts, data } };
}

/** Natures déclarées par le manifeste, dans l'ordre de la liste fermée. */
export const declaredKinds = (m: PluginManifest): ContributionKind[] => CONTRIBUTION_KINDS.filter((k) => (m.contributes[k] ?? []).length > 0);
