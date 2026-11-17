/**
 * Cibles : ce qu'une rangée de l'accueil (`HomeRow`), et plus tard un plugin ou un thème, peut ouvrir. Une cible
 * s'écrit en un texte :
 * - une page : son identifiant (`movies`) ; il n'a jamais de `:` (`PAGE_ID_RE`), ce qui le distingue des autres ;
 * - une liste : `list:<id>` (`LIST_PAGE_PREFIX`, la même notation que `catalog.page`) ;
 * - un écran du cœur : `screen:<nom>`, parmi `CORE_SCREENS` (« Écrans » de docs/architecture-cible.md).
 * Tout autre texte n'est pas une cible.
 */
import { LIST_PAGE_PREFIX } from './lists.ts';
import { PAGE_ID_RE } from './pages.ts';

export const SCREEN_PREFIX = 'screen:';

/**
 * Écrans du cœur qu'on peut ouvrir directement : l'accueil, la recherche, le Centre, les réglages et l'explorateur.
 * La coquille (toujours là) et les lecteurs (ouverts avec un élément) n'en sont pas. Liste fermée : un écran ajouté
 * au cœur s'y ajoute ici.
 */
export const CORE_SCREENS = ['home', 'search', 'center', 'settings', 'explorer'] as const;
export type CoreScreen = (typeof CORE_SCREENS)[number];

export type Target = { kind: 'page'; id: string } | { kind: 'list'; id: string } | { kind: 'screen'; screen: CoreScreen };

const isCoreScreen = (v: string): v is CoreScreen => (CORE_SCREENS as readonly string[]).includes(v);

/** Lit une cible écrite en texte ; `null` si le texte n'en désigne aucune. */
export function parseTarget(v: unknown): Target | null {
  if (typeof v !== 'string') return null;
  if (v.startsWith(LIST_PAGE_PREFIX)) {
    const id = v.slice(LIST_PAGE_PREFIX.length);
    return PAGE_ID_RE.test(id) ? { kind: 'list', id } : null;
  }
  if (v.startsWith(SCREEN_PREFIX)) {
    const screen = v.slice(SCREEN_PREFIX.length);
    return isCoreScreen(screen) ? { kind: 'screen', screen } : null;
  }
  return PAGE_ID_RE.test(v) ? { kind: 'page', id: v } : null;
}

/** Reconnaît une cible écrite en texte. */
export const isTarget = (v: unknown): v is string => parseTarget(v) !== null;

/** Écrit une cible en texte ; une cible invalide (identifiant, écran inconnu) est refusée (`RangeError`). */
export function formatTarget(t: Target): string {
  const text = t.kind === 'page' ? t.id : t.kind === 'list' ? `${LIST_PAGE_PREFIX}${t.id}` : `${SCREEN_PREFIX}${t.screen}`;
  // Relire le texte garde la garantie : une page `list:x` ou `screen:search` n'existe pas.
  if (parseTarget(text)?.kind !== t.kind) throw new RangeError(`Cible invalide : ${JSON.stringify(t)}`);
  return text;
}
