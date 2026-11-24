/**
 * Jeux PC des dossiers de jeux, depuis P5-13 : trouvés par la source d'un plugin (dossiers proposés par
 * `locations.ts`), rangés au catalogue sous l'instance `game:<chemin>`. L'interface historique (`scanGameSources`)
 * les lit ici, avec l'état de chaque dossier ; un dossier qu'aucun plugin actif ne lit n'a pas de jeux.
 */
import fsp from 'node:fs/promises';
import type { ElementSourceRef, GameSource } from '@mire/shared';
import { locationError, resolveLocation } from '../../library/location.ts';
import type { PcGame, SourceStatus } from '../types.ts';
import { t } from '../../i18n/current.ts';
import { gameLocationKey } from './locations.ts';

/** Ce que la lecture des dossiers de jeux demande au pont des sources et au catalogue. */
export interface PcFolderDeps {
  /** Analyse de nouveau les sources des plugins (bouton « Analyser »). */
  rescan(): Promise<void>;
  /** Vrai si la source d'un plugin actif lit cet emplacement. */
  claimed(key: string): boolean;
  catalog: {
    sources(): ElementSourceRef[];
    keysOf(source: ElementSourceRef): string[];
    get(key: string): { name: string; open: { kind: string; path?: string } } | undefined;
  };
}

async function isFolder(dir: string): Promise<boolean> {
  return (await fsp.stat(dir).catch(() => null))?.isDirectory() ?? false;
}

/** Jeux de tous les dossiers de jeux PC, triés par nom, et état de chaque dossier. */
export async function scanPcFolders(
  sources: readonly GameSource[],
  deps: PcFolderDeps | undefined,
  platform: NodeJS.Platform = process.platform,
): Promise<{ games: PcGame[]; status: Record<string, SourceStatus> }> {
  await deps?.rescan();
  const games: PcGame[] = [];
  const status: Record<string, SourceStatus> = {};
  for (const src of sources) {
    const loc = resolveLocation(src.location, { platform });
    if (loc.type !== 'path') {
      status[src.id] = { ok: false, error: t('games.errors.pcLocation'), count: 0 };
      continue;
    }
    const key = gameLocationKey(loc.path, platform);
    if (!deps?.claimed(key)) {
      status[src.id] = { ok: false, error: t('games.errors.pcNoPlugin'), count: 0 };
      continue;
    }
    if (!(await isFolder(loc.path))) {
      status[src.id] = { ok: false, error: locationError(src.location, loc), count: 0 };
      continue;
    }
    const found: PcGame[] = [];
    for (const ref of deps.catalog.sources().filter((r) => r.instance === key)) {
      for (const k of deps.catalog.keysOf(ref)) {
        const el = deps.catalog.get(k);
        if (el?.open.kind === 'program' && el.open.path) found.push({ name: el.name, path: el.open.path, source: src.id });
      }
    }
    games.push(...found);
    status[src.id] = { ok: true, error: null, count: found.length };
  }
  games.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  return { games, status };
}
