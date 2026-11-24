// Langue et pays du magasin Steam. Repris de Mire (`src/main/i18n/metadata.ts`, avant P5-16).

/** Région implicite d'une langue (`fr` → `FR`). */
const DEFAULT_REGION = { fr: 'FR', en: 'US', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL', ja: 'JP' };

/** Noms des langues de l'API Steam (paramètre `l`) ; les autres langues reçoivent l'anglais. */
const STEAM_LANGUAGES = {
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

/** Code BCP 47 canonique (`fr_be` → `fr-BE`), ou `null`. */
function canonical(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  try {
    return Intl.getCanonicalLocales(tag.trim().replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

/** Langue des fiches : le réglage `language` s'il est fixé (autre que `auto`), sinon la langue de l'interface. */
export function metadataLanguage(setting, locale) {
  const fixed = typeof setting === 'string' ? setting.trim() : '';
  if (fixed && fixed.toLowerCase() !== 'auto') return fixed;
  const tag = new Intl.Locale(canonical(locale) ?? 'fr');
  const region = tag.region ?? DEFAULT_REGION[tag.language];
  return region ? `${tag.language}-${region}` : tag.language;
}

/** Paramètres de langue de l'API Steam : `l` (langue des textes) et `cc` (pays de la boutique). */
export function steamLocale(language) {
  const tag = new Intl.Locale(canonical(language) ?? 'en');
  const region = tag.region ?? DEFAULT_REGION[tag.language] ?? 'US';
  return { l: STEAM_LANGUAGES[tag.language] ?? 'english', cc: region };
}
