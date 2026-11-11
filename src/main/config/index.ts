/** Configuration du processus principal : défauts, catalogues, migrations, normalisation, fusion et service. */
export { DEFAULT_TV } from './catalogs/tv.ts';
export { DEFAULT_WEB } from './catalogs/web.ts';
export { CONFIG_VERSION, DEFAULT_CONFIG, HOME_BARS, NESTED, THEME_BG, THEMES } from './defaults.ts';
export { mergeConfig } from './merge.ts';
export { migrate, MIGRATIONS, type MigrationResult } from './migrations/index.ts';
export { consoleIdAt } from './migrations/v6.ts';
export { findConsole } from './normalize/consoles.ts';
export { normalizeConfig } from './normalize/index.ts';
export { createConfigService, type ConfigListener, type ConfigMutator, type ConfigService, type ConfigServiceOptions } from './service.ts';
