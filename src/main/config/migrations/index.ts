/**
 * Migrations de la configuration : une étape par version, appliquées dans l'ordre à un fichier plus ancien.
 * Pour une nouvelle version : ajouter `vN.ts`, l'inscrire dans `MIGRATIONS` et monter `CONFIG_VERSION`.
 */
import { CONFIG_VERSION } from '../defaults.ts';
import type { Loose } from '../normalize/common.ts';
import type { Migration } from './types.ts';
import { v2 } from './v2.ts';
import { v3 } from './v3.ts';
import { v4 } from './v4.ts';
import { v5 } from './v5.ts';
import { v6 } from './v6.ts';
import { v7 } from './v7.ts';

export const MIGRATIONS: readonly Migration[] = [v2, v3, v4, v5, v6, v7];

export interface MigrationResult {
  /** Configuration migrée (le même objet, modifié sur place), ou la valeur reçue si ce n'est pas un objet. */
  config: unknown;
  /** Version lue (1 quand elle est absente) ; `null` si la valeur n'est pas un objet. */
  from: number | null;
  /** Vrai si une étape a été appliquée : la configuration est alors à réenregistrer. */
  changed: boolean;
}

export function migrate(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object') return { config: raw, from: null, changed: false };
  const config = raw as Loose;
  const from = Number(config.version) || 1;
  if (from >= CONFIG_VERSION) return { config, from, changed: false };
  for (const step of MIGRATIONS) if (from < step.version) step.up(config);
  config.version = CONFIG_VERSION;
  return { config, from, changed: true };
}
