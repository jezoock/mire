'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Constructions (dist/ de la racine et des paquets), cache de Stencil, dépendances.
// addons/ : copie temporaire des plugins de P5-03 pour mire-addons (retirée avec le dossier) ; elle y est vérifiée par sa propre chaîne.
  { ignores: ['**/dist/', '**/.stencil/', 'release/', 'node_modules/', 'vendor/', 'addons/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      'no-duplicate-case': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Interface : modules ES assemblés par esbuild en un seul script (scripts/build.mjs).
    files: ['src/renderer/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    // Les preloads tournent dans une page web mais ont accès à `require`.
    files: ['src/preload/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Scripts de construction en modules ES (esbuild).
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // Prototypes (spikes/, hors de dist/) : processus principal d'Electron, page cachée, Worker et utilityProcess.
    files: ['spikes/**/*.js', 'spikes/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.node, ...globals.browser, ...globals.worker } },
  },
  {
    // Tests de bout en bout : les fonctions passées à page.evaluate s'exécutent dans la page.
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
