/**
 * Validation d'un dossier de plugin : le manifeste (`validate.ts`), puis les fichiers qu'il déclare et ses textes.
 * Lit le disque (Node) : c'est ce que fait `mire-plugin validate <dossier>`.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MANIFEST_FILE, type PluginManifest } from './manifest.ts';
import { declaredFiles, requiredTexts, validateManifest, type ValidateOptions, type ValidationIssue, type ValidationResult } from './validate.ts';

const isFile = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isFile() ?? false;

async function readJson(file: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(file, 'utf8')) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, error: e.code === 'ENOENT' ? 'absent' : e.message };
  }
}

/** Texte d'une clé hiérarchique (`plugin.name`) dans un arbre de messages ; une forme au pluriel compte. */
function textAt(messages: unknown, key: string): boolean {
  let node = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node.trim() !== '';
  return typeof node === 'object' && node !== null && typeof (node as { other?: unknown }).other === 'string';
}

async function checkCatalog(dir: string, m: PluginManifest, lang: string, issues: ValidationIssue[]): Promise<void> {
  const rel = `${m.i18n.replace(/\/$/, '')}/${lang}.json`;
  const read = await readJson(path.join(dir, rel));
  if (!read.ok) {
    issues.push({ code: 'missing-catalog', path: rel, message: `Textes ${lang === 'en' ? 'anglais' : 'français'} illisibles (${read.error}).` });
    return;
  }
  const cat = read.value as { meta?: { code?: unknown }; messages?: unknown };
  if (cat?.meta?.code !== lang) issues.push({ code: 'invalid-catalog', path: `${rel}#meta.code`, message: `meta.code doit valoir « ${lang} ».` });
  for (const key of requiredTexts(m)) {
    if (!textAt(cat?.messages, key)) issues.push({ code: 'missing-text', path: `${rel}#messages.${key}`, message: `Texte absent : « ${key} ».` });
  }
}

/**
 * Vérifie un dossier de plugin : manifeste, cohérence entre niveau et contributions, fichiers déclarés présents,
 * textes anglais (et français pour le dépôt officiel) présents.
 */
export async function validatePluginDir(dir: string, opts: ValidateOptions = {}): Promise<ValidationResult> {
  const read = await readJson(path.join(dir, MANIFEST_FILE));
  if (!read.ok) {
    const code = read.error === 'absent' ? 'missing-manifest' : 'invalid-json';
    return { ok: false, issues: [{ code, path: MANIFEST_FILE, message: `Manifeste illisible (${read.error}).` }] };
  }
  const result = validateManifest(read.value, opts);
  // Les fichiers et les textes ne se vérifient que sur un manifeste valide : ses chemins sont alors sûrs.
  if (!result.ok) return result;
  const m = read.value as PluginManifest;
  const issues: ValidationIssue[] = [];
  for (const { path: where, file } of declaredFiles(m)) {
    if (!(await isFile(path.join(dir, file)))) issues.push({ code: 'missing-file', path: where, message: `Fichier déclaré absent : ${file}.` });
  }
  await checkCatalog(dir, m, 'en', issues);
  if (opts.official) await checkCatalog(dir, m, 'fr', issues);
  return { ok: issues.length === 0, issues };
}
