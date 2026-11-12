/** Jeux : jeux PC, jeux de console présents sur l'ordinateur, systèmes. */
import { SYSTEMS } from '@mire/shared';
import { collator, labelOf, withScrape } from './items.ts';
import type { Console, Infos, Item } from './types.ts';

/** Systèmes proposés pour une console (pour les jaquettes et les genres) : identifiants libretro du référentiel. */
export const SYSTEM_IDS: readonly string[] = SYSTEMS.map((s) => s.id);

/** Jeu PC ajouté à la main (`config.games`). */
export interface ManualGame {
  name: string;
  path: string;
  image?: string | null;
  args?: string[];
}

/** Marque-page de jeu à télécharger (`config.gameBookmarks`). */
export interface GameBookmark {
  id: string;
  title: string;
  source?: unknown;
  /** Console visée : identifiant, `pc`, ou rien (pas encore choisie). */
  console?: string | null;
  done?: boolean;
}

/** Jeux PC seuls (ajoutés à la main, puis trouvés dans les dossiers), par ordre alphabétique. */
export function pcGameEntries(games: ManualGame[], autoGames: Item[], infos: Infos): Item[] {
  const manual: Item[] = games.map((g, i) => ({ name: g.name, path: g.path, image: g.image || null, args: g.args, manualIndex: i, dir: g.path, kind: 'game' }));
  const known = new Set(manual.map((g) => g.path));
  const auto: Item[] = autoGames.filter((g) => !known.has(g.path)).map((g) => ({ ...g, image: null, dir: g.path, kind: 'game', auto: true }));
  return [...manual, ...auto].map((g) => withScrape(g, infos)).sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
}

export interface LocalGamesSource {
  games: ManualGame[];
  autoGames: Item[];
  emulators: Console[];
  /** Jeux présents sur l'ordinateur, par identifiant de console. */
  localRoms: Record<string, Item[] | undefined>;
  gameBookmarks?: GameBookmark[];
}

/**
 * Jeux PC, jeux de console présents sur l'ordinateur et marque-pages de jeux à télécharger, dans une seule liste
 * alphabétique. Chaque jeu porte son système (`systemKey` : `pc`, `emu:<console>` ou `pending`, et `systemName`).
 */
export function allLocalGames(src: LocalGamesSource, infos: Infos): Item[] {
  const pc = pcGameEntries(src.games, src.autoGames, infos).map((g) => ({ ...g, systemKey: 'pc', systemName: 'Jeux PC' }));
  const roms: Item[] = [];
  for (const emu of src.emulators) {
    for (const r of src.localRoms[emu.id] || [])
      roms.push(withScrape({ ...r, kind: 'rom', consoleId: emu.id, systemKey: `emu:${emu.id}`, systemName: emu.name }, infos));
  }
  const consoleName = (id: string) => src.emulators.find((e) => e.id === id)?.name;
  // Marque-pages de jeux en attente de téléchargement : des cartes avec un bouton Télécharger.
  const pending = (src.gameBookmarks || [])
    .filter((b) => !b.done)
    .map((b) => {
      const consoleId = b.console != null && b.console !== 'pc' ? b.console : null;
      const systemKey = b.console === 'pc' ? 'pc' : consoleId != null ? `emu:${consoleId}` : 'pending';
      const systemName = b.console === 'pc' ? 'Jeux PC' : consoleId != null ? consoleName(consoleId) || 'Console' : 'À télécharger';
      return withScrape(
        { kind: 'gamebm', name: b.title, path: `gbm:${b.id}`, bookmarkId: b.id, dlSource: b.source, systemKey, systemName, pending: true },
        infos,
      );
    });
  return [...pc, ...roms, ...pending].sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
}

/** Système de la liste des jeux, pour le filtre. */
export interface GameSystemEntry {
  key: string;
  name: string;
  count: number;
  consoleId?: string;
}

/** Systèmes de la liste (pour le filtre) : jeux PC d'abord s'il y en a, puis chaque console, même vide. */
export function gameSystems(all: Item[], emulators: Console[]): GameSystemEntry[] {
  const out: GameSystemEntry[] = [];
  const pc = all.filter((g) => g.systemKey === 'pc').length;
  if (pc) out.push({ key: 'pc', name: 'Jeux PC', count: pc });
  for (const emu of emulators) {
    const n = all.filter((g) => g.systemKey === `emu:${emu.id}`).length;
    out.push({ key: `emu:${emu.id}`, name: emu.name, count: n, consoleId: emu.id });
  }
  return out;
}

/** Jeux connus de toutes les consoles (cache de la recherche globale), avec leur console (`emu`, `emuName`). */
export function allRoms(emulators: Console[], romsCache: Record<string, Item[] | undefined>): Item[] {
  const out: Item[] = [];
  for (const e of emulators) for (const r of romsCache[e.id] || []) out.push({ ...r, emu: e.id, emuName: e.name });
  return out;
}
