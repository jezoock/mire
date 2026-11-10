'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/', 'release/', 'node_modules/', 'vendor/'] },
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
    files: ['src/renderer/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
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
    // Tests de bout en bout : les fonctions passées à page.evaluate s'exécutent dans la page.
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // `api` est exposé par src/preload/preload.js (contextBridge).
    files: ['src/renderer/app.js'],
    languageOptions: { globals: { api: 'readonly' } },
  },
];
