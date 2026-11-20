#!/usr/bin/env node
/**
 * Plugins inclus (P5-04) : copie un plugin de `mire-addons` (source de vérité, `plugins/<id>/`) dans `plugins/<id>/`
 * de Mire, la copie versionnée des plugins inclus ; `npm run build` la reporte dans `resources/plugins/` (non versionné),
 * que lisent `npm start`, le test de fumée et l'installateur (P3-05). Seuls le manifeste et les fichiers listés dans
 * `files` du `package.json` du plugin sont copiés (comme son paquet publié) ; le dossier cible est vidé avant la copie.
 *
 *   node scripts/bundle-plugin.mjs <clone de mire-addons> <id…>
 *
 * Refusés : un identifiant hors du dépôt officiel (préfixe `mire.`), un chemin de `files` qui sort du dossier du
 * plugin, un lien symbolique (fichier ou dossier).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_PREFIX, PLUGIN_ID_RE } from '../packages/plugin-sdk/src/validate.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'plugins');
const MANIFEST = 'mire-plugin.json';

function fail(message) {
  console.error(`bundle-plugin : ${message}`);
  process.exit(1);
}

/** Copie un fichier ou un dossier, en refusant tout lien symbolique. */
function copy(from, to, where) {
  const st = fs.lstatSync(from);
  if (st.isSymbolicLink()) fail(`lien symbolique refusé : ${where}`);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name), `${where}/${name}`);
  } else if (st.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  } else fail(`ni fichier ni dossier : ${where}`);
}

/** Entrées à copier : le manifeste, puis celles de `files`, vérifiées sous le dossier du plugin. */
function entries(src, id) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  } catch {
    fail(`${id} : package.json illisible.`);
  }
  if (!Array.isArray(pkg.files) || !pkg.files.every((f) => typeof f === 'string' && f)) fail(`${id} : « files » attendu dans package.json.`);
  const list = new Set([MANIFEST, ...pkg.files.map((f) => f.replace(/\/+$/, ''))]);
  for (const rel of list) {
    const full = path.resolve(src, rel);
    if (path.isAbsolute(rel) || !full.startsWith(src + path.sep)) fail(`${id} : chemin refusé dans « files » : ${rel}`);
    if (!fs.existsSync(full)) fail(`${id} : fichier absent : ${rel}`);
  }
  return [...list];
}

function bundle(clone, id) {
  if (!PLUGIN_ID_RE.test(id) || !id.startsWith(OFFICIAL_PREFIX)) fail(`identifiant refusé : ${id} (dépôt officiel seulement, préfixe ${OFFICIAL_PREFIX}).`);
  const plugins = path.join(clone, 'plugins');
  const src = path.join(plugins, id);
  if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink() || !fs.statSync(src).isDirectory()) fail(`${id} : dossier absent ou lien symbolique.`);
  const list = entries(src, id);
  const dest = path.join(TARGET, id);
  // Copie dans un dossier temporaire : un refus en cours de route laisse la version précédente en place.
  const tmp = path.join(TARGET, `.${id}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const rel of list) copy(path.join(src, rel), path.join(tmp, rel), `${id}/${rel}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  console.log(`${id} → plugins/${id}/ (${list.join(', ')})`);
}

const [clone, ...ids] = process.argv.slice(2);
if (!clone || !ids.length) fail('usage : node scripts/bundle-plugin.mjs <clone de mire-addons> <id…>');
const cloneDir = path.resolve(clone);
if (!fs.existsSync(path.join(cloneDir, 'plugins'))) fail(`pas de dossier plugins/ dans ${cloneDir}.`);
for (const id of new Set(ids)) bundle(cloneDir, id);
