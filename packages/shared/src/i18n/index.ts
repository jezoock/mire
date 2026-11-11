/**
 * Localisation (`@mire/shared/i18n`) : catalogues de textes par langue, moteur de traduction, formats par `Intl`,
 * choix de la langue de l'interface. Contrat des catalogues : docs/i18n.md.
 */
export type * from './types.ts';
export { BUILTIN_CATALOGS, REFERENCE_LANGUAGE } from './catalogs.ts';
export { checkCatalog, checkCatalogs, compareCatalogs, flattenMessages, variablesOf } from './check.ts';
export { DEFAULT_FALLBACK, PLURAL_CATEGORIES, createI18n, interpolate, isPluralMessage, lookup } from './engine.ts';
export { createFormats } from './formats.ts';
export { DEFAULT_LANGUAGE, LANGUAGE_AUTO, canonicalLanguage, matchLanguage, normalizeLanguageSetting, resolveLanguage } from './language.ts';
