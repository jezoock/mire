/**
 * Construction de Mire dans dist/ :
 * - processus principal et preloads : bundles CommonJS (le preload sandboxé ne charge pas d'ESM) ;
 * - renderer : un script unique (IIFE) construit à partir de src/renderer/main.js, chargé par index.html sans
 *   script en ligne ni eval (CSP `script-src 'self'`) ; HTML, styles et polices copiés tels quels.
 * Les dépendances npm restent externes (chargées depuis node_modules au lancement) ; seuls les paquets
 * de l'espace de travail (@mire/*) sont intégrés aux bundles.
 * - interface (P4-01, docs/adr/0001-dot-stash.md) : les composants mire-* (@mire/ui) sont construits par Stencil
 *   (packages/ui/dist/components/) puis intégrés au script de l'interface ; leur feuille de style est compilée avec
 *   le moteur SCSS de dot-stash (dist/renderer/ui/) ; le chargeur paresseux des composants ds-* est copié depuis
 *   l'archive de dot-stash (dist/renderer/vendor/dot-stash/).
 * - hôte isolé des plugins (P3-03, docs/adr/0002-hote-isole.md) : sa page et le Worker de chaque plugin (modules ES
 *   pour le navigateur, sans carte de source : seuls trois fichiers nommés sont servis par mire-plugin://host/), son
 *   preload (CommonJS) et sa page HTML, dans dist/plugin-host/, à part du processus principal.
 * Usage : node scripts/build.mjs [--watch [--electron]]
 * --electron (avec --watch) : lance Mire une fois la première construction faite ; fermer Mire arrête la
 * surveillance. Les changements du processus principal demandent de relancer Mire, ceux du renderer
 * d'actualiser la fenêtre (Ctrl+R).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import * as sass from 'sass';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const UI = path.join(ROOT, 'packages', 'ui');
const DOT_STASH = path.join(ROOT, 'node_modules', 'dot-stash');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

// Tout import de paquet reste externe, sauf ceux de l'espace de travail. Liste plus large que les
// « dependencies » : le code charge aussi des dépendances indirectes (parse-torrent, tldts-experimental).
const externalPackages = {
  name: 'paquets-externes',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@mire/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Node d'Electron 44 ; les import() dynamiques (webtorrent, ESM uniquement) sont conservés tels quels.
  target: 'node24',
  sourcemap: 'linked',
  logLevel: 'info',
  plugins: [externalPackages],
  // @mire/plugin-sdk : ses sources plutôt que son dist/ (construit seulement pour son archive).
  conditions: ['mire-source'],
};

// Interface : script classique pour la page (pas de module ES ; esbuild le place en mode strict). Les paquets de
// l'espace de travail y sont intégrés (@mire/ui compris, avec la part du moteur de Stencil que ses composants utilisent).
const renderer = {
  entryPoints: { 'renderer/main': 'src/renderer/main.js' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  // Chromium d'Electron 44 (au moins) : la syntaxe moderne est conservée telle quelle.
  target: 'chrome140',
  sourcemap: 'linked',
  logLevel: 'info',
};

// Hôte isolé des plugins : page et Worker (modules ES du navigateur, sans Node ni dépendance externe).
const pluginHost = {
  entryPoints: { 'plugin-host/page': 'src/main/plugins/host/page.ts', 'plugin-host/worker': 'src/main/plugins/host/worker.ts' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome140',
  sourcemap: false,
  logLevel: 'info',
};

const targets = [
  { ...common, entryPoints: { 'main/index': 'src/main/index.ts' } },
  { ...common, sourcemap: false, entryPoints: { 'plugin-host/preload': 'src/main/plugins/host/preload.ts' } },
  pluginHost,
  {
    ...common,
    entryPoints: { 'preload/preload': 'src/preload/preload.js', 'preload/web-preload': 'src/preload/web-preload.js' },
  },
  renderer,
];

// Sources de l'interface, intégrées au script : seuls les autres fichiers (HTML, CSS, polices) sont copiés.
const CODE = /\.(?:js|mjs|ts)$/;
// Produits par d'autres étapes que la copie : le script d'esbuild, la feuille de @mire/ui, dot-stash.
const BUNDLE = /^(?:main\.js(?:\.map)?|ui|vendor)$/;
const hasAssets = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasAssets(path.join(dir, e.name)) : !CODE.test(e.name)));

// Page HTML de l'hôte isolé des plugins (le reste est construit par esbuild).
function copyPluginHost() {
  fs.mkdirSync(path.join(DIST, 'plugin-host'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'main', 'plugins', 'host', 'index.html'), path.join(DIST, 'plugin-host', 'index.html'));
}

function copyRenderer() {
  const out = path.join(DIST, 'renderer');
  fs.mkdirSync(out, { recursive: true });
  // Le script construit par esbuild reste en place ; le reste est recopié depuis src/renderer.
  for (const e of fs.readdirSync(out)) if (!BUNDLE.test(e)) fs.rmSync(path.join(out, e), { recursive: true, force: true });
  fs.cpSync(RENDERER, out, {
    recursive: true,
    filter: (src) => (fs.statSync(src).isDirectory() ? hasAssets(src) : !CODE.test(src)),
  });
}

// Recopie le renderer à chaque construction des bundles (mode --watch compris).
const copyPlugin = {
  name: 'copie-renderer',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      copyRenderer();
      copyPluginHost();
    });
  },
};

// Composants mire-* : Stencil écrit packages/ui/dist/components/, que le script de l'interface importe (@mire/ui).
// En mode --watch, Stencil reste lancé et réécrit ces fichiers, qu'esbuild surveille comme toute importation.
function stencil(args) {
  const bin = path.join(ROOT, 'node_modules', '@stencil', 'core', 'bin', 'stencil');
  return spawn(process.execPath, [bin, 'build', '--config', path.join(UI, 'stencil.config.ts'), ...args], { cwd: UI, stdio: ['ignore', 'pipe', 'inherit'] });
}

function buildComponents() {
  return new Promise((resolve, reject) => {
    const child = stencil([]);
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Stencil (@mire/ui) a échoué :\n${log}`))));
  });
}

// Mode --watch : Stencil surveille packages/ui/src ; la première construction est faite avant esbuild.
function watchComponents() {
  return new Promise((resolve) => {
    const child = stencil(['--watch']);
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      if (/build finished/.test(d)) resolve(child);
    });
  });
}

// Feuille de style de @mire/ui, compilée avec le moteur SCSS de dot-stash (`pkg:dot-stash/scss/…`). Les icônes
// du moteur y sont intégrées : leur licence l'accompagne, comme le demande dot-stash.
function buildStyles() {
  const out = path.join(DIST, 'renderer', 'ui');
  fs.mkdirSync(out, { recursive: true });
  const { css } = sass.compile(path.join(UI, 'src', 'styles', 'index.scss'), {
    importers: [new sass.NodePackageImporter(ROOT)],
    style: 'compressed',
    sourceMap: false,
  });
  fs.writeFileSync(path.join(out, 'mire-ui.css'), css);
  fs.copyFileSync(path.join(DOT_STASH, 'dist', 'css', 'LICENSE-icons.txt'), path.join(out, 'LICENSE-icons.txt'));
}

// Chargeur paresseux des composants ds-* (dot-stash.esm.js et un fichier par composant), chargé par index.html en
// module : le code d'un composant n'est lu qu'à sa première apparition dans la page.
function copyDotStash() {
  const out = path.join(DIST, 'renderer', 'vendor', 'dot-stash');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(DOT_STASH, 'dist', 'dot-stash'), out, { recursive: true });
  fs.copyFileSync(path.join(DOT_STASH, 'LICENSE'), path.join(out, 'LICENSE'));
}

const options = targets.map((t, i) => ({
  ...t,
  absWorkingDir: ROOT,
  outdir: DIST,
  plugins: i === 0 ? [...t.plugins, copyPlugin] : t.plugins,
}));

function buildUiAssets() {
  buildStyles();
  copyDotStash();
}

if (watch) {
  const components = await watchComponents();
  buildUiAssets();
  const contexts = await Promise.all(options.map((o) => esbuild.context(o)));
  // Première construction terminée avant de lancer Mire, puis reconstruction à chaque changement.
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.watch()));
  // esbuild ne suit que les fichiers importés : HTML, CSS et polices de l'interface sont surveillés à part.
  const watcher = fs.watch(RENDERER, { recursive: true }, () => copyRenderer());
  // Styles de @mire/ui : recompilés à chaque changement d'un fichier .scss du paquet.
  const styleWatcher = fs.watch(path.join(UI, 'src'), { recursive: true }, (_event, file) => {
    if (!file?.endsWith('.scss')) return;
    try {
      buildStyles();
    } catch (err) {
      console.error(err.message);
    }
  });
  if (process.argv.includes('--electron')) {
    // Le paquet electron exporte le chemin de son exécutable (et télécharge le moteur au premier appel).
    const electron = require('electron');
    // Les autres arguments vont à Electron (ex. : npm run dev -- --no-sandbox).
    const extra = process.argv.slice(2).filter((a) => a !== '--watch' && a !== '--electron');
    const child = spawn(electron, ['.', ...extra], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', async (code) => {
      watcher.close();
      styleWatcher.close();
      components.kill();
      await Promise.all(contexts.map((c) => c.dispose()));
      process.exit(code ?? 0);
    });
  }
} else {
  fs.rmSync(DIST, { recursive: true, force: true });
  await buildComponents();
  buildUiAssets();
  await Promise.all(options.map((o) => esbuild.build(o)));
}
