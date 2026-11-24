/**
 * Sources d'éléments des jeux, une par plugin prévu à l'inventaire :
 * - `jeux-roms` : jeux de console des sources en ligne d'une console (jeux sur disque compris), jusqu'à P5-14b ; ceux
 *   des dossiers locaux viennent depuis P5-14a du plugin inclus `mire.games.roms` (`roms/locations.ts`), et les
 *   éléments que le cœur avait rangés sous cette source pour un dossier local sont retirés ;
 * - `jeux-pc` : jeux PC trouvés dans les dossiers de jeux, jusqu'à P5-13 : ils viennent désormais du plugin inclus
 *   `mire.games.pc` (`pc/locations.ts`) ; les éléments que le cœur avait rangés sous cette source sont retirés ;
 * - `jeux-pc-manuel` : jeux PC ajoutés à la main (`config.games`) ;
 * - `jeux-marque` : marque-pages de jeux à télécharger (`config.gameBookmarks`).
 *
 * Toutes posent le tag `game` et l'info `system` (système libretro de la console, `pc` pour un jeu PC). Pour un jeu
 * de console, le tag automatique « Consoles » (P2-05) pose aussi `system` ; sa valeur passe avant celle de la source
 * (priorité des origines, P2-04). Les listes de l'interface historique (`listRoms`) alimentent le
 * catalogue après chaque analyse d'une source en ligne (`index.ts`).
 */
import path from 'node:path';
import { guessSystem, isUrlTarget } from '@mire/shared';
import type { Config, Emulator, Game, GameBookmark } from '@mire/shared';
import { gameBookmarkKey, normalizeLocation, pcGameKey, romKey } from '../catalog/keys.ts';
import { compact, configSet, configSource, type ConfigFeed } from '../catalog/sync.ts';
import type { ElementInput } from '../catalog/types.ts';
import { consoleLocations, type ScannedRomLocation } from './roms/list.ts';
import type { Rom } from './types.ts';

/** Tags de chaque source. */
export const GAME_SOURCE_TAGS = {
  'jeux-roms': ['game'],
  'jeux-pc': ['game'],
  'jeux-pc-manuel': ['game'],
  'jeux-marque': ['game'],
} as const;

export type GameSourceId = keyof typeof GAME_SOURCE_TAGS;

/** Système des jeux PC (info `system`). */
export const PC_SYSTEM = 'pc';

const tagsOf = (id: GameSourceId) => [...GAME_SOURCE_TAGS[id]];

/** Instance d'un emplacement de console : identifiant de la console et emplacement normalisé. */
export const romInstance = (consoleId: string, location: string, platform: NodeJS.Platform = process.platform): string =>
  `${consoleId}|${normalizeLocation(location, platform)}`;

export function romElement(emu: Emulator, rom: Rom, platform: NodeJS.Platform = process.platform): ElementInput {
  return {
    key: romKey(emu.id, rom.path, platform),
    name: rom.displayName || rom.name,
    open: { kind: 'game', console: emu.id, path: rom.path },
    tags: tagsOf('jeux-roms'),
    infos: compact({ system: guessSystem(emu) }),
    images: compact({ poster: rom.image }),
  };
}

/** Nom d'un jeu ajouté à la main : celui de la configuration, sinon celui du fichier (comme à l'ajout). */
const manualName = (g: Game): string =>
  String(g.name || '').trim() || (isUrlTarget(g.path) ? g.path : path.basename(g.path).replace(/\.(exe|lnk|url|bat|cmd|app)$/i, ''));

export function manualGameElement(g: Game, platform: NodeJS.Platform = process.platform): ElementInput {
  const args = Array.isArray(g.args) ? g.args.map(String) : [];
  return {
    key: pcGameKey(g.path, platform),
    name: manualName(g),
    open: args.length ? { kind: 'program', path: g.path, args } : { kind: 'program', path: g.path },
    tags: tagsOf('jeux-pc-manuel'),
    infos: { system: PC_SYSTEM },
    images: compact({ poster: typeof g.image === 'string' ? g.image : undefined }),
  };
}

/**
 * Marque-page de jeu à télécharger : ouvert comme la page ou le lien d'origine. Système : celui du marque-page, sinon
 * celui de sa console, `pc` pour un jeu PC.
 */
export function gameBookmarkElement(bm: GameBookmark, emulators: readonly Emulator[]): ElementInput {
  const ref = bm.console;
  const emu = ref && ref !== 'pc' ? emulators.find((e) => e.id === ref) : undefined;
  const system = bm.system || (ref === 'pc' ? PC_SYSTEM : emu ? guessSystem(emu) : '');
  return {
    key: gameBookmarkKey(bm.id),
    name: bm.title || bm.source,
    open: { kind: 'site', url: bm.source },
    tags: tagsOf('jeux-marque'),
    infos: compact({ system }),
    images: {},
  };
}

/**
 * Catalogue d'éléments alimenté par les listes des jeux : chaque emplacement accessible et complet donne ses jeux ; un
 * emplacement inaccessible garde ceux de l'analyse précédente.
 */
export interface GameCatalogFeed {
  roms(emu: Emulator, scanned: readonly ScannedRomLocation[]): void;
}

export function gameCatalogFeed(
  catalog: { setSource(source: { plugin: string; instance: string }, elements: ElementInput[]): unknown },
  platform: NodeJS.Platform = process.platform,
): GameCatalogFeed {
  return {
    roms(emu, scanned) {
      for (const s of scanned) {
        if (!s.complete) continue;
        catalog.setSource(
          { plugin: 'jeux-roms', instance: romInstance(emu.id, s.location, platform) },
          s.roms.map((r) => romElement(emu, r, platform)),
        );
      }
    },
  };
}

/** Jeux PC ajoutés à la main (`config.games`). */
export const manualGamesSource = (platform: NodeJS.Platform = process.platform) =>
  configSource('jeux-pc-manuel', GAME_SOURCE_TAGS['jeux-pc-manuel'], (config) =>
    config.games.filter((g) => typeof g?.path === 'string' && g.path.trim()).map((g) => manualGameElement(g, platform)),
  );

/** Marque-pages de jeux en attente de téléchargement (ceux que l'interface montre). */
export const gameBookmarksSource = () =>
  configSource('jeux-marque', GAME_SOURCE_TAGS['jeux-marque'], (config) =>
    config.gameBookmarks.filter((b) => b?.id && !b.done).map((b) => gameBookmarkElement(b, config.emulators)),
  );

/**
 * Ce que la configuration donne au catalogue : jeux ajoutés à la main, marque-pages en attente de téléchargement ;
 * les sources en ligne des consoles encore configurées gardent leurs éléments ; les autres sont retirés, comme ceux des
 * dossiers de jeux que le cœur analysait avant P5-13 (`jeux-pc`) et des dossiers locaux des consoles avant P5-14a,
 * désormais trouvés par un plugin.
 */
export function gameConfigFeed(config: Config, platform: NodeJS.Platform = process.platform): ConfigFeed {
  const romInstances = new Set(
    config.emulators.flatMap((emu) => consoleLocations(emu).flatMap((l) => (l.remote ? [romInstance(emu.id, l.location, platform)] : []))),
  );
  return {
    owns: (plugin) => Object.hasOwn(GAME_SOURCE_TAGS, plugin),
    sets: [configSet(manualGamesSource(platform), config), configSet(gameBookmarksSource(), config)],
    keeps: (ref) => ref.plugin === 'jeux-roms' && romInstances.has(ref.instance),
  };
}
