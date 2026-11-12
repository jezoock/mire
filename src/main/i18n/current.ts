/**
 * Traduction des textes produits par le processus principal (erreurs renvoyées à l'interface, boîtes de dialogue,
 * boutique…). Ces textes naissent loin des handlers IPC, dans des fonctions sans contexte : plutôt que de faire
 * descendre `t()` dans chaque dépendance, la racine de composition branche ici le service de langue
 * (`useLanguage`). Sans service branché (tests, scripts), les textes sont en français, la langue d'origine de Mire.
 */
import { BUILTIN_CATALOGS, DEFAULT_FALLBACK, REFERENCE_LANGUAGE, createI18n, type Vars } from '@mire/shared/i18n';

/** Ce dont la traduction a besoin : la langue retenue et le texte d'une clé dans cette langue. */
export interface Translator {
  language(): string;
  t(key: string, vars?: Vars): string;
}

function builtin(locale: string): Translator {
  const engine = createI18n({ locale, catalogs: { ...BUILTIN_CATALOGS }, fallback: [...DEFAULT_FALLBACK] });
  return { language: () => engine.locale, t: (key, vars) => engine.t(key, vars) };
}

const DEFAULT_TRANSLATOR = builtin(REFERENCE_LANGUAGE);
let active: Translator = DEFAULT_TRANSLATOR;

/** Branche le service de langue (racine de composition) ; `null` revient au français. Rend le précédent. */
export function useLanguage(translator: Translator | null): Translator {
  const previous = active;
  active = translator ?? DEFAULT_TRANSLATOR;
  return previous;
}

/** Traducteur des catalogues intégrés pour une langue donnée (tests). */
export function builtinTranslator(locale: string): Translator {
  return builtin(locale);
}

/** Texte d'une clé dans la langue de l'interface. */
export function t(key: string, vars?: Vars): string {
  return active.t(key, vars);
}

/** Langue de l'interface retenue (`fr`, `en`…). */
export function currentLanguage(): string {
  return active.language();
}
