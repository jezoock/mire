import type { Loose } from '../normalize/common.ts';

/** Étape de migration : amène en place une configuration d'une version antérieure à `version`. */
export interface Migration {
  version: number;
  up(raw: Loose): void;
}
