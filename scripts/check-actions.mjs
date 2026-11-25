/**
 * Vérifie les actions de l'interface (P4-04, docs/adr/0001-dot-stash.md § 8) :
 * - chaque `ds-trigger` des gabarits (src/renderer, packages/ui/src) qui a une `action` vise un composant `mire-*` par
 *   sa balise (`target="mire-app"`), et son action est une méthode de ce composant : méthode `@Method()` du composant
 *   Stencil, ou action du contrôleur de la balise (src/renderer/controllers/) ;
 * - les composants d'éléments (`mire-card`, `mire-grid`, `mire-row`, `mire-group-card`, P4-05) passent à leur
 *   `ds-trigger` la cible et la méthode qu'ils reçoivent (l'argument, la clé de l'élément, est ajouté par le
 *   composant) : leurs attributs `target` et `action` sont vérifiés de la même façon là où ils sont écrits ;
 * - les boîtes de dialogue (`mire-form`, `mire-pick`, P4-06) écrivent le nom de leur action tel quel suivi d'arguments
 *   calculés (`action={`act:${…}`}`) : seul ce nom est vérifié ;
 * - plus aucun `data-action` (pont des vues historiques, retiré en P4-24a1) : toute action passe par un `ds-trigger`.
 * Usage : node scripts/check-actions.mjs — sort en erreur après avoir listé tous les problèmes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLLER_CLASSES } from '../src/renderer/controllers/index.ts';
import { actionNames } from '../src/renderer/controllers/registry.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Fichiers d'un dossier (récursif) dont l'extension est dans `exts`. */
function filesOf(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && exts.includes(path.extname(e.name)))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Méthodes publiques (`@Method()`) des composants Stencil de @mire/ui, par balise. */
export function componentMethods(root = ROOT) {
  /** @type {Record<string, string[]>} */
  const methods = {};
  for (const file of filesOf(path.join(root, 'packages', 'ui', 'src', 'components'), ['.tsx'])) {
    const text = fs.readFileSync(file, 'utf8');
    const tag = /@Component\(\s*\{[^}]*tag:\s*'([^']+)'/.exec(text)?.[1];
    if (!tag) continue;
    methods[tag] = [...text.matchAll(/@Method\(\)\s*(?:async\s+)?(\w+)\s*\(/g)].map((m) => m[1]);
  }
  return methods;
}

/** Actions de chaque balise : celles du composant Stencil et celles de son contrôleur. */
export function targetMethods(root = ROOT) {
  const methods = componentMethods(root);
  for (const [tag, Cls] of Object.entries(CONTROLLER_CLASSES)) {
    methods[tag] = [...(methods[tag] || []), ...actionNames(Object.create(Cls.prototype))];
  }
  return methods;
}

// Valeur d'un attribut dans une balise ouvrante : "…", '…' ou {'…'} (JSX) ; `null` s'il est absent, `undefined` s'il
// n'est pas une chaîne écrite telle quelle. Un gabarit dont le nom de l'action est écrit tel quel, suivi d'arguments
// calculés ({`act:${…}`}, boîtes de dialogue, P4-06), donne `act:…` : seul le nom est vérifié.
function attribute(tag, name) {
  const m = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`$]*)\`)\\s*\\}|\\{\\s*\`([A-Za-z_$][\\w$]*):\\$\\{|(\\{))`,
  ).exec(tag);
  if (!m) return null;
  if (m[7]) return undefined;
  if (m[6]) return `${m[6]}:…`;
  return m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
}

/** Composants qui transmettent `target` et `action` aux `ds-trigger` de leurs cartes (P4-05). */
export const ACTION_FORWARDERS = ['mire-card', 'mire-grid', 'mire-row', 'mire-group-card'];

/** Fichier d'un composant qui transmet l'action reçue : ses `target={…}` et `action={…}` ne sont pas écrits là. */
const isForwarderSource = (root, file) =>
  ACTION_FORWARDERS.some((tag) => file.startsWith(path.join(root, 'packages', 'ui', 'src', 'components', tag) + path.sep));

/** Les `ds-trigger` à action des gabarits, et les composants qui en transmettent une : fichier, ligne, cible et action. */
export function findTriggers(root = ROOT) {
  const files = [
    ...filesOf(path.join(root, 'src', 'renderer'), ['.js', '.ts', '.html']),
    ...filesOf(path.join(root, 'packages', 'ui', 'src'), ['.tsx', '.ts']),
  ];
  const triggers = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const tags = ['ds-trigger', ...ACTION_FORWARDERS].join('|');
    for (const m of text.matchAll(new RegExp(`<(?:${tags})\\b((?:[^>"'{]|"[^"]*"|'[^']*'|\\{[^}]*\\})*)>`, 'g'))) {
      const action = attribute(m[1], 'action');
      if (action === null) continue;
      const target = attribute(m[1], 'target');
      if (target === undefined && action === undefined && isForwarderSource(root, file)) continue;
      triggers.push({ file: rel(file), line: lineOf(text, m.index), target, action });
    }
  }
  return triggers;
}

/** Problèmes des `ds-trigger` : cible absente ou dynamique, action dynamique ou inconnue. */
export function checkTriggers(triggers, methods) {
  const errors = [];
  for (const { file, line, target, action } of triggers) {
    const where = `${file}:${line}`;
    const name = action?.split(':')[0];
    if (!target || !/^mire-[a-z-]+$/.test(target)) {
      errors.push(`${where} : la cible d'un ds-trigger doit être la balise d'un composant mire-* (target="${target ?? ''}")`);
      continue;
    }
    if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      errors.push(`${where} : le nom de l'action doit être écrit tel quel (action="${action ?? ''}")`);
      continue;
    }
    if (!Object.hasOwn(methods, target)) errors.push(`${where} : ${target} n'a ni composant ni contrôleur`);
    else if (!methods[target].includes(name)) errors.push(`${where} : ${target} n'a pas de méthode « ${name} »`);
  }
  return errors;
}

/** `data-action` encore écrits dans l'interface : il n'y en a plus (P4-24a1), chacun est une erreur. */
export function findDataActions(root = ROOT) {
  const errors = [];
  const files = [
    ...filesOf(path.join(root, 'src', 'renderer'), ['.js', '.ts', '.html']),
    ...filesOf(path.join(root, 'packages', 'ui', 'src'), ['.tsx', '.ts']),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-action=/g)) errors.push(`${rel(file)}:${lineOf(text, m.index)} : data-action n'existe plus, employez un ds-trigger`);
  }
  return errors;
}

/** Tous les problèmes, et le décompte de ce qui a été vérifié. */
export function checkActions(root = ROOT) {
  const methods = targetMethods(root);
  const triggers = findTriggers(root);
  const errors = [...checkTriggers(triggers, methods), ...findDataActions(root)];
  return { errors, triggers: triggers.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, triggers } = checkActions();
  if (errors.length) {
    console.error(`Actions : ${errors.length} problème(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Actions : ${triggers} ds-trigger vérifiés, tous reliés à une méthode existante.`);
}
