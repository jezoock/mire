/**
 * Moteur de traduction : recherche d'une clé dans la langue choisie puis dans les langues de repli,
 * pluriels par `Intl.PluralRules`, insertion des variables `{nom}`.
 */
import { createFormats } from './formats.ts';
import type { Catalog, I18n, I18nOptions, Messages, PluralCategory, PluralMessage, Vars } from './types.ts';

/** Langues de repli : l'anglais, puis le français (décision D-11). */
export const DEFAULT_FALLBACK: readonly string[] = ['en', 'fr'];

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Un objet dont toutes les clés sont des catégories de pluriel, `other` comprise. */
export function isPluralMessage(node: unknown): node is PluralMessage {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  return keys.includes('other') && keys.every((k) => (PLURAL_CATEGORIES as readonly string[]).includes(k));
}

/** Nœud d'un arbre de textes au chemin `a.b.c`, ou `undefined`. */
export function lookup(messages: Messages, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined;
    node = (node as Messages)[part];
  }
  return node;
}

// Texte utilisable : une chaîne non vide, ou un pluriel.
function usable(node: unknown): node is string | PluralMessage {
  return (typeof node === 'string' && node !== '') || isPluralMessage(node);
}

/** Remplace chaque `{nom}` connu ; un nom inconnu reste tel quel, pour qu'il se voie. */
export function interpolate(text: string, vars: Vars | undefined, formatNumber: (n: number) => string): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(vars, name)) return whole;
    const value = vars[name];
    return typeof value === 'number' ? formatNumber(value) : String(value);
  });
}

// Langue choisie puis repli, sans doublon, en ne gardant que les langues qui ont un catalogue.
function fallbackChain(locale: string, catalogs: Record<string, Catalog>, fallback: readonly string[]): string[] {
  return [...new Set([locale, ...fallback])].filter((code) => Object.hasOwn(catalogs, code));
}

export function createI18n({ locale, catalogs, fallback = [...DEFAULT_FALLBACK], onMissing }: I18nOptions): I18n {
  const chain = fallbackChain(locale, catalogs, fallback);
  const formats = createFormats(locale);
  const plurals = new Map<string, Intl.PluralRules>();
  const reported = new Set<string>();

  // Les règles de pluriel sont celles de la langue qui fournit le texte (repli compris).
  function pluralRules(code: string): Intl.PluralRules {
    if (!plurals.has(code)) plurals.set(code, new Intl.PluralRules(code));
    return plurals.get(code)!;
  }

  function find(key: string): { code: string; node: string | PluralMessage } | null {
    for (const code of chain) {
      const node = lookup(catalogs[code].messages, key);
      if (usable(node)) return { code, node };
    }
    return null;
  }

  function t(key: string, vars?: Vars): string {
    const found = find(key);
    if (!found) {
      if (onMissing && !reported.has(key)) {
        reported.add(key);
        onMissing(key, locale);
      }
      return key;
    }
    const { code, node } = found;
    let text: string;
    if (typeof node === 'string') text = node;
    else {
      const count = Number(vars?.count ?? 0);
      text = node[pluralRules(code).select(count)] || node.other;
    }
    return interpolate(text, vars, formats.formatNumber);
  }

  return { locale, chain, t, has: (key) => find(key) !== null, ...formats };
}
