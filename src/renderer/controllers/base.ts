import type { ControllerContext, Data } from './types.ts';

/**
 * Base des contrôleurs : garde le contexte. Seules les méthodes déclarées par un contrôleur sont des actions (voir
 * `actionNames` du registre) ; l'accesseur `ctx` n'en est pas une.
 */
export abstract class Controller {
  readonly #ctx: ControllerContext;

  constructor(ctx: ControllerContext) {
    this.#ctx = ctx;
  }

  protected get ctx(): ControllerContext {
    return this.#ctx;
  }
}

/** Premier élément d'une liste dont le champ `key` vaut `value` (clé stable : chemin, identifiant…). */
export function findBy(list: readonly Data[] | null | undefined, key: string, value: unknown): Data | undefined {
  return value == null ? undefined : (list || []).find((x) => x?.[key] === value);
}

/** Position d'un élément dans une liste, par sa clé ; -1 s'il n'y est pas. */
export function indexBy(list: readonly Data[] | null | undefined, key: string, value: unknown): number {
  return value == null ? -1 : (list || []).findIndex((x) => x?.[key] === value);
}
