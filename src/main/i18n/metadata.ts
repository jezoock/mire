/**
 * Langue des métadonnées (fiches TMDB et Steam) : celle de l'interface, sauf si l'utilisateur a fixé
 * `search.language` dans la configuration. Une valeur vide (par défaut depuis la version 8 de la configuration)
 * suit l'interface. La région des disponibilités (`search.region`) reste un réglage à part.
 */
import { canonicalLanguage } from '@mire/shared/i18n';
import { currentLanguage } from './current.ts';

/** Région implicite d'une langue de l'interface, pour TMDB (`fr` → `fr-FR`). */
const DEFAULT_REGION: Readonly<Record<string, string>> = { fr: 'FR', en: 'US', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL', ja: 'JP' };

/** Noms des langues de l'API Steam (paramètre `l`) ; les autres langues reçoivent l'anglais. */
const STEAM_LANGUAGES: Readonly<Record<string, string>> = {
  fr: 'french',
  en: 'english',
  de: 'german',
  es: 'spanish',
  it: 'italian',
  pt: 'portuguese',
  nl: 'dutch',
  ja: 'japanese',
  pl: 'polish',
  ru: 'russian',
};

/** Code langue-région des fiches (`fr-FR`, `en-US`) : `search.language` s'il est fixé, sinon la langue de l'interface. */
export function metadataLanguage(searchLanguage: unknown, uiLanguage: string = currentLanguage()): string {
  const fixed = typeof searchLanguage === 'string' ? searchLanguage.trim() : '';
  if (fixed) return fixed;
  const tag = canonicalLanguage(uiLanguage) ?? 'fr';
  const locale = new Intl.Locale(tag);
  const region = locale.region ?? DEFAULT_REGION[locale.language];
  return region ? `${locale.language}-${region}` : locale.language;
}

/** Paramètres de langue de l'API Steam : `l` (langue des textes) et `cc` (pays de la boutique). */
export function steamLocale(language: string): { l: string; cc: string } {
  const locale = new Intl.Locale(canonicalLanguage(language) ?? 'en');
  const region = locale.region ?? DEFAULT_REGION[locale.language] ?? 'US';
  return { l: STEAM_LANGUAGES[locale.language] ?? 'english', cc: region };
}
