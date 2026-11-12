/**
 * Entrées des vues web : un identifiant de vue (`netflix`, `rom:snes-…`, `bm:…`, `tv:sfr`) donne l'entrée à
 * afficher. Les résolveurs sont rangés par préfixe ; ceux de Mire s'appuient sur lib/web-entry.ts, un addon pourra
 * en ajouter d'autres. Sans préfixe connu, l'identifiant désigne un site enregistré.
 */
import type { Config, LinkSite } from '@mire/shared';
import { findConsole } from '../config/index.ts';
import { romEntry, resolveWebEntry } from '../lib/web-entry.ts';
import type { EntryResolver, EntryResult, ResolveOptions, WebEntry } from './types.ts';
import { t } from '../i18n/current.ts';

// Les fonctions de lib/web-entry.ts savent déjà distinguer les préfixes : chacun de ces résolveurs leur délègue.
export const BUILTIN_RESOLVERS: readonly EntryResolver[] = ['rom:', 'bm:', 'tv:'].map((prefix) => ({
  prefix,
  resolve: (id, config, opts) => resolveWebEntry(id, config, opts),
}));

export function createEntryRegistry(extra: readonly EntryResolver[] = []) {
  const resolvers: EntryResolver[] = [...BUILTIN_RESOLVERS, ...extra];
  return {
    /** Ajoute un résolveur ; un préfixe déjà pris est refusé. */
    register(resolver: EntryResolver) {
      if (!resolver.prefix || resolvers.some((r) => r.prefix === resolver.prefix)) {
        throw new Error(`Préfixe de vue web déjà utilisé : ${resolver.prefix}`);
      }
      resolvers.push(resolver);
    },
    resolve(id: unknown, config: Config, opts: ResolveOptions = {}): EntryResult {
      const s = String(id);
      const r = resolvers.find((x) => s.startsWith(x.prefix));
      return r ? r.resolve(s, config, opts) : resolveWebEntry(s, config, opts);
    },
    prefixes: () => resolvers.map((r) => r.prefix),
  };
}

export type EntryRegistry = ReturnType<typeof createEntryRegistry>;

export interface SiteDefaults {
  defaultRomSites: (system: string) => LinkSite[];
  guessSystem: (console: unknown) => string;
}

/** Sites de la console : sa liste à elle, ou celle proposée pour son système ; « pc » : sites des jeux PC. */
export function consoleSites(config: Config, consoleId: unknown, defaults: SiteDefaults): LinkSite[] {
  if (consoleId === 'pc') return (config.pcSites || []).filter((x) => x && x.url);
  const emu = findConsole(config, consoleId);
  if (!emu) return [];
  if (Array.isArray(emu.romSites)) return emu.romSites.filter((x) => x && x.url);
  return defaults.defaultRomSites(defaults.guessSystem(emu));
}

/** Entrée « Ajouter des jeux » d'une console, sur le site demandé. */
export function romEntryFor(config: Config, consoleId: string, siteIndex: number | undefined, defaults: SiteDefaults): WebEntry | null {
  return romEntry(config, consoleId, consoleSites(config, consoleId, defaults), siteIndex);
}

/** Nom de la console d'une vue de sites de jeux. */
export function consoleName(config: Config, consoleId: string): string {
  return consoleId === 'pc' ? t('games.pcGames') : findConsole(config, consoleId)?.name || '';
}
