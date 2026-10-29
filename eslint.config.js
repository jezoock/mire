'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/', 'node_modules/', 'vendor/'] },
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
    files: ['renderer/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    // Les preloads tournent dans une page web mais ont accès à `require`.
    files: ['preload.js', 'web-preload.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // `api` est exposé par preload.js (contextBridge).
    files: ['renderer/app.js'],
    languageOptions: { globals: { api: 'readonly' } },
  },
];
