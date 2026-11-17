/**
 * Sources d'éléments des jeux, une par plugin prévu à l'inventaire :
 * - `jeux-roms` : jeux de console (dossiers et sources en ligne d'une console, jeux sur disque compris) ;
 * - `jeux-pc` : jeux PC trouvés dans les dossiers de jeux ;
 * - `jeux-pc-manuel` : jeux PC ajoutés à la main (`config.games`) ;
 * - `jeux-marque` : marque-pages de jeux à télécharger (`config.gameBookmarks`).
 *
 * Toutes posent le tag `game` et l'info `system` (système libretro de la console, `pc` pour un jeu PC). Pour un jeu
 * de console, le tag automatique « Consoles » (P2-05) pose aussi `system` ; sa valeur passe avant celle de la source
 * (priorité des origines, P2-04). Les listes de l'interface historique (`listRoms`, `scanGameSources`) alimentent le
 * catalogue après chaque analyse (`index.ts`) ; `scan` analyse un emplacement seul, comme le fera l'hôte des plugins.
 */
import path from 'node:path';
import { guessSystem, isUrlTarget } from '@mire/shared';
import type { Config, Emulator, Game, GameBookmark, GameSource } from '@mire/shared';
import { gameBookmarkKey, normalizeLocation, pcGameKey, romKey } from '../catalog/keys.ts';
import { compact, configSet, configSource, type ConfigFeed } from '../catalog/sync.ts';
import type { ElementInput, ElementSource } from '../catalog/types.ts';
import { resolveLocation } from '../library/location.ts';
import { consoleLocations, listIn, type ScannedRomLocation } from './roms/list.ts';
import { localPcProvider } from './pc/scanner.ts';
import type { GameSourceProvider, PcGame, Rom } from './types.ts';

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

/** Emplacement d'une console : la console et l'un de ses dossiers ou sources en ligne. */
export interface RomLocation {
  console: Emulator;
  location: string;
}

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

export function pcElement(game: PcGame, platform: NodeJS.Platform = process.platform): ElementInput {
  return {
    key: pcGameKey(game.path, platform),
    name: game.name,
    open: { kind: 'program', path: game.path },
    tags: tagsOf('jeux-pc'),
    infos: { system: PC_SYSTEM },
    images: {},
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

/** Jeux de console : un emplacement par dossier ou source en ligne de chaque console. */
export function romSource(fetchText: (url: string) => Promise<string>, platform: NodeJS.Platform = process.platform): ElementSource<RomLocation> {
  return {
    id: 'jeux-roms',
    tags: GAME_SOURCE_TAGS['jeux-roms'],
    handles: ({ console: emu, location }) => consoleLocations(emu).some((l) => l.location === location),
    instance: ({ console: emu, location }) => romInstance(emu.id, location, platform),
    async scan({ console: emu, location }) {
      const { errors, scanned } = await listIn(emu, [location], fetchText);
      if (!scanned.length) throw new Error(errors.join(' '));
      return scanned[0].roms.map((r) => romElement(emu, r, platform));
    },
  };
}

/** Jeux PC des dossiers de jeux : un emplacement par dossier. */
export function pcSource(providers: readonly GameSourceProvider[], platform: NodeJS.Platform = process.platform): ElementSource<GameSource> {
  const provider = (src: GameSource) => providers.find((p) => p.canHandle(resolveLocation(src.location)));
  return {
    id: 'jeux-pc',
    tags: GAME_SOURCE_TAGS['jeux-pc'],
    handles: (src) => !!provider(src),
    instance: (src) => normalizeLocation(src.location, platform),
    async scan(src) {
      const p = provider(src) ?? localPcProvider(platform);
      return (await p.scan(resolveLocation(src.location), src)).map((g) => pcElement(g, platform));
    },
  };
}

/**
 * Catalogue d'éléments alimenté par les listes des jeux : chaque emplacement accessible et complet donne ses jeux ; un
 * emplacement inaccessible garde ceux de l'analyse précédente.
 */
export interface GameCatalogFeed {
  roms(emu: Emulator, scanned: readonly ScannedRomLocation[]): void;
  pc(sources: readonly GameSource[], result: { games: PcGame[]; status: Record<string, { ok: boolean }> }): void;
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
    pc(sources, { games, status }) {
      for (const src of sources) {
        if (!status[src.id]?.ok) continue;
        const found = games.filter((g) => g.source === src.id).map((g) => pcElement(g, platform));
        catalog.setSource({ plugin: 'jeux-pc', instance: normalizeLocation(src.location, platform) }, found);
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
 * les consoles et les dossiers de jeux encore configurés gardent leurs éléments (les autres sont retirés).
 */
export function gameConfigFeed(config: Config, platform: NodeJS.Platform = process.platform): ConfigFeed {
  const romInstances = new Set(config.emulators.flatMap((emu) => consoleLocations(emu).map((l) => romInstance(emu.id, l.location, platform))));
  const pcInstances = new Set(config.gameSources.map((src) => normalizeLocation(src.location, platform)));
  return {
    owns: (plugin) => Object.hasOwn(GAME_SOURCE_TAGS, plugin),
    sets: [configSet(manualGamesSource(platform), config), configSet(gameBookmarksSource(), config)],
    keeps: (ref) => (ref.plugin === 'jeux-roms' ? romInstances.has(ref.instance) : ref.plugin === 'jeux-pc' && pcInstances.has(ref.instance)),
  };
}
