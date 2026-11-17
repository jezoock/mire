/**
 * Cibles (P2-12) : la notation vit dans le SDK des plugins (P3-01), qui la publie telle quelle ; `@mire/shared` la
 * réexporte pour le cœur et l'interface. `PAGE_ID_RE` et `LIST_PAGE_PREFIX` sont réexportés par `pages.ts` et
 * `lists.ts`.
 */
export { CORE_SCREENS, SCREEN_PREFIX, parseTarget, isTarget, formatTarget } from '../../plugin-sdk/src/targets.ts';
export type { CoreScreen, Target } from '../../plugin-sdk/src/targets.ts';
