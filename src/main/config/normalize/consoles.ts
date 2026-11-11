/** Consoles (émulateurs). */
import { newId, slug } from '@mire/shared';
import type { Emulator } from '@mire/shared';
import { isObjectLike, type Loose } from './common.ts';
import { normalizeLinkSites } from './games.ts';

// « pc » désigne les jeux PC partout où l'on attend une console : aucune console ne le reçoit.
const RESERVED = new Set(['pc']);

/**
 * Identifiant d'une nouvelle console : `store` pour une console de la boutique (unique par construction),
 * sinon le nom simplifié suivi d'un suffixe aléatoire, pour qu'une console recréée sous le même nom
 * n'hérite pas des marque-pages restés sur l'ancienne.
 */
export function newConsoleId(emu: Loose, taken: ReadonlySet<string>): string {
  const store = typeof emu.store === 'string' ? emu.store.trim() : '';
  if (store && !taken.has(store) && !RESERVED.has(store)) return store;
  const base = slug(emu.name) || 'console';
  let id;
  do id = `${base}-${newId(3)}`;
  while (taken.has(id));
  return id;
}

/** Donne un identifiant à chaque console qui n'en a pas, ou dont l'identifiant est déjà pris (sur place). */
export function assignConsoleIds(list: Loose[]): void {
  const taken = new Set<string>();
  for (const e of list) {
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    e.id = id && !taken.has(id) && !RESERVED.has(id) ? id : newConsoleId(e, taken);
    taken.add(e.id);
  }
}

/** Console désignée par son identifiant ; `null` si elle n'existe pas (ou plus). */
export function findConsole<T extends { id?: unknown }>(config: { emulators: readonly T[] }, id: unknown): T | null {
  return id == null ? null : config.emulators.find((e) => e.id === id) || null;
}

export function normalizeEmulators(list: unknown[]): Emulator[] {
  const out = list
    .filter((e): e is Loose => isObjectLike(e) && !!e.path)
    .map((e) => {
      const out: Loose = { ...e, sources: Array.isArray(e.sources) ? e.sources.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [] };
      if (Array.isArray(e.romSites)) out.romSites = normalizeLinkSites(e.romSites);
      else delete out.romSites;
      return out;
    });
  assignConsoleIds(out);
  return out as Emulator[];
}
