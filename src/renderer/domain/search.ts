/** Recherche : filtre des listes et résultats locaux de la recherche globale. */
import { fold } from '@mire/shared';
import { folderText, withScrape } from './items.ts';
import type { Infos, Item } from './types.ts';

/** Teste un texte : vrai s'il contient tous les mots de la recherche (casse et accents ignorés, ordre libre). */
export function matcher(query: unknown): (text: string) => boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return (text) => {
    const h = fold(text);
    return words.every((w) => h.includes(w));
  };
}

/** Éléments dont le texte (`text`) contient tous les mots de la recherche ; la liste telle quelle sans recherche. */
export function filterQ<T>(items: T[], query: unknown, text: (it: T) => string): T[] {
  if (!fold(query)) return items;
  const match = matcher(query);
  return items.filter((it) => match(text(it)));
}

/** Ce que la recherche globale parcourt sur l'ordinateur. */
export interface LocalData {
  videos: Item[];
  tracks: Item[];
  images: Item[];
  channels: Item[] | null;
  /** Jeux PC (`pcGameEntries`). */
  games: Item[];
  /** Jeux de toutes les consoles (`allRoms`). */
  roms: Item[];
}

/** Résultats de la recherche globale sur l'ordinateur, par catégorie, chacune limitée en nombre. */
export function localResults(q: unknown, data: LocalData, infos: Infos) {
  const match = matcher(q);
  return {
    videos: data.videos
      .map((v) => withScrape(v, infos))
      .filter((v) => match(`${v.name} ${v.sTitle || ''} ${folderText(v)}`))
      .slice(0, 24),
    tracks: data.tracks.filter((t) => match(`${t.name} ${folderText(t)}`)).slice(0, 12),
    images: data.images.filter((i) => match(`${i.name} ${i.folder}`)).slice(0, 24),
    channels: (data.channels || []).filter((c) => match(`${c.number ?? ''} ${c.name}`)).slice(0, 12),
    games: data.games.filter((g) => match(`${g.name} ${g.sTitle || ''} ${g.sGenre}`)).slice(0, 12),
    roms: data.roms
      .map((r) => withScrape({ ...r, kind: 'rom' }, infos))
      .filter((r) => match(`${r.displayName} ${r.emuName}`))
      .slice(0, 24),
  };
}
