/**
 * Construction de Mire dans dist/ :
 * - processus principal et preloads : bundles CommonJS (le preload sandboxé ne charge pas d'ESM) ;
 * - renderer : un script unique (IIFE) construit à partir de src/renderer/main.js, chargé par index.html sans
 *   script en ligne ni eval (CSP `script-src 'self'`) ; HTML, styles et polices copiés tels quels.
 * Les dépendances npm restent externes (chargées depuis node_modules au lancement) ; seuls les paquets
 * de l'espace de travail (@mire/*) sont intégrés aux bundles.
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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const watch = process.argv.includes('--watch');

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
};

// Interface : script classique pour la page (pas de module ES ; esbuild le place en mode strict). Aucune
// dépendance npm n'y est importée ; les paquets de l'espace de travail y seraient intégrés.
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

const targets = [
  { ...common, entryPoints: { 'main/index': 'src/main/index.js' } },
  {
    ...common,
    entryPoints: { 'preload/preload': 'src/preload/preload.js', 'preload/web-preload': 'src/preload/web-preload.js' },
  },
  renderer,
];

// Sources de l'interface, intégrées au script : seuls les autres fichiers (HTML, CSS, polices) sont copiés.
const CODE = /\.(?:js|mjs|ts)$/;
const BUNDLE = /^main\.js(?:\.map)?$/;
const hasAssets = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory() ? hasAssets(path.join(dir, e.name)) : !CODE.test(e.name)));

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
      if (!result.errors.length) copyRenderer();
    });
  },
};

const options = targets.map((t, i) => ({
  ...t,
  absWorkingDir: ROOT,
  outdir: DIST,
  plugins: i === 0 ? [...t.plugins, copyPlugin] : t.plugins,
}));

if (watch) {
  const contexts = await Promise.all(options.map((o) => esbuild.context(o)));
  // Première construction terminée avant de lancer Mire, puis reconstruction à chaque changement.
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.watch()));
  // esbuild ne suit que les fichiers importés : HTML, CSS et polices de l'interface sont surveillés à part.
  const watcher = fs.watch(RENDERER, { recursive: true }, () => copyRenderer());
  if (process.argv.includes('--electron')) {
    // Le paquet electron exporte le chemin de son exécutable (et télécharge le moteur au premier appel).
    const electron = createRequire(import.meta.url)('electron');
    // Les autres arguments vont à Electron (ex. : npm run dev -- --no-sandbox).
    const extra = process.argv.slice(2).filter((a) => a !== '--watch' && a !== '--electron');
    const child = spawn(electron, ['.', ...extra], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', async (code) => {
      watcher.close();
      await Promise.all(contexts.map((c) => c.dispose()));
      process.exit(code ?? 0);
    });
  }
} else {
  fs.rmSync(DIST, { recursive: true, force: true });
  await Promise.all(options.map((o) => esbuild.build(o)));
}
