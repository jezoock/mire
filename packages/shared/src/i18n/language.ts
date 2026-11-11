/**
 * Langue de l'interface : réglage `ui.language` (`auto` ou un code BCP 47) et choix d'une langue disponible.
 */

/** Valeur du réglage qui suit la langue du système. */
export const LANGUAGE_AUTO = 'auto';

/** Langue retenue quand rien ne correspond (décision D-11 : l'anglais, puis le français). */
export const DEFAULT_LANGUAGE = 'en';

/** Code BCP 47 canonique (`en-us` → `en-US`), ou `null` s'il est invalide. */
export function canonicalLanguage(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  try {
    return Intl.getCanonicalLocales(tag.trim().replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

/** Réglage `ui.language` normalisé : `auto`, ou un code BCP 47 canonique ; toute autre valeur devient `auto`. */
export function normalizeLanguageSetting(value: unknown): string {
  if (typeof value === 'string' && value.trim().toLowerCase() === LANGUAGE_AUTO) return LANGUAGE_AUTO;
  return canonicalLanguage(value) ?? LANGUAGE_AUTO;
}

const baseOf = (tag: string) => new Intl.Locale(tag).language;

/**
 * Première langue disponible qui convient, dans l'ordre des langues préférées : le code exact, sinon la même
 * langue sans région (`fr-CA` → `fr`), sinon une variante régionale disponible (`pt` → `pt-BR`).
 * Rien ne convient : `fallback` s'il est disponible, sinon la première langue disponible.
 */
export function matchLanguage(preferred: readonly string[], available: readonly string[], fallback = DEFAULT_LANGUAGE): string {
  const codes = available.map((c) => canonicalLanguage(c)).filter((c): c is string => !!c);
  for (const raw of preferred) {
    const tag = canonicalLanguage(raw);
    if (!tag) continue;
    const exact = codes.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const base = baseOf(tag);
    const same = codes.find((c) => c.toLowerCase() === base) ?? codes.find((c) => baseOf(c) === base);
    if (same) return same;
  }
  return codes.includes(fallback) ? fallback : (codes[0] ?? fallback);
}

/** Langue de l'interface pour un réglage donné : celle du système si `auto`, toujours une langue disponible. */
export function resolveLanguage(setting: string, systemLanguages: readonly string[], available: readonly string[]): string {
  const value = normalizeLanguageSetting(setting);
  return matchLanguage(value === LANGUAGE_AUTO ? systemLanguages : [value], available);
}
