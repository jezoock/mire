/**
 * Vérification des catalogues (`npm run i18n:check`) : comparés au catalogue de référence, mêmes clés,
 * mêmes variables d'interpolation, aucun texte vide, métadonnées complètes.
 */
import { isPluralMessage } from './engine.ts';
import type { Catalog, Messages, PluralMessage } from './types.ts';

type Leaf = string | PluralMessage;

/** Feuilles d'un arbre de textes, par clé complète ; `invalid` : clés dont la valeur n'est pas un texte. */
export function flattenMessages(messages: Messages, prefix = ''): { leaves: Map<string, Leaf>; invalid: string[] } {
  const leaves = new Map<string, Leaf>();
  const invalid: string[] = [];
  for (const [name, node] of Object.entries(messages ?? {})) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof node === 'string' || isPluralMessage(node)) leaves.set(key, node);
    else if (node && typeof node === 'object' && !Array.isArray(node)) {
      const sub = flattenMessages(node as Messages, key);
      sub.leaves.forEach((v, k) => leaves.set(k, v));
      invalid.push(...sub.invalid);
    } else invalid.push(key);
  }
  return { leaves, invalid };
}

/** Variables `{nom}` d'un texte (toutes formes confondues pour un pluriel), triées. */
export function variablesOf(leaf: Leaf): string[] {
  const texts = typeof leaf === 'string' ? [leaf] : Object.values(leaf);
  const names = texts.flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  return [...new Set(names)].sort();
}

const isEmpty = (leaf: Leaf) => (typeof leaf === 'string' ? !leaf.trim() : Object.values(leaf).some((v) => typeof v !== 'string' || !v.trim()));

/** Problèmes d'un catalogue seul : métadonnées, valeurs qui ne sont pas des textes, textes vides. */
export function checkCatalog(catalog: Catalog, code: string): string[] {
  const errors: string[] = [];
  const meta = (catalog?.meta ?? {}) as Partial<Catalog['meta']>;
  for (const field of ['code', 'name', 'app'] as const) {
    if (typeof meta[field] !== 'string' || !meta[field].trim()) errors.push(`${code} : métadonnée « ${field} » absente ou vide`);
  }
  if (typeof meta.code === 'string' && meta.code !== code) errors.push(`${code} : meta.code vaut « ${meta.code} »`);
  const { leaves, invalid } = flattenMessages(catalog?.messages ?? {});
  for (const key of invalid) errors.push(`${code} : ${key} n'est ni un texte ni un pluriel`);
  for (const [key, leaf] of leaves) if (isEmpty(leaf)) errors.push(`${code} : ${key} est vide`);
  return errors;
}

/** Compare un catalogue à celui de référence : clés manquantes ou en trop, forme et variables différentes. */
export function compareCatalogs(reference: Catalog, refCode: string, other: Catalog, code: string): string[] {
  const errors: string[] = [];
  const ref = flattenMessages(reference?.messages ?? {}).leaves;
  const own = flattenMessages(other?.messages ?? {}).leaves;
  for (const [key, leaf] of ref) {
    const mine = own.get(key);
    if (mine === undefined) {
      errors.push(`${code} : clé manquante ${key}`);
      continue;
    }
    if (typeof mine !== typeof leaf) errors.push(`${code} : ${key} doit être ${typeof leaf === 'string' ? 'un texte' : 'un pluriel'}, comme en ${refCode}`);
    const expected = variablesOf(leaf).join(', ');
    const actual = variablesOf(mine).join(', ');
    if (expected !== actual) errors.push(`${code} : ${key} a les variables [${actual}] au lieu de [${expected}]`);
  }
  for (const key of own.keys()) if (!ref.has(key)) errors.push(`${code} : clé en trop ${key} (absente en ${refCode})`);
  return errors;
}

/** Vérifie tous les catalogues : chacun seul, puis chacun contre celui de référence. */
export function checkCatalogs(catalogs: Record<string, Catalog>, refCode: string): string[] {
  const errors: string[] = [];
  if (!catalogs[refCode]) return [`catalogue de référence « ${refCode} » absent`];
  for (const [code, catalog] of Object.entries(catalogs)) {
    errors.push(...checkCatalog(catalog, code));
    if (code !== refCode) errors.push(...compareCatalogs(catalogs[refCode], refCode, catalog, code));
  }
  return errors;
}
