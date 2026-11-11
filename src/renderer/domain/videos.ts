/** Vidéos : séries → saisons → épisodes, sources et tris. */
import { fold } from '@mire/shared';
import { collator, labelOf } from './items.ts';
import type { Item } from './types.ts';

/** Clé de la série d'un épisode (titre replié), `null` pour une vidéo seule. */
export const seriesKeyOf = (v: Item): string | null => (v.sSeries || v.seriesTitle ? fold(v.sSeries || v.seriesTitle) : null);

/** Tuile de la liste des vidéos : une vidéo seule, ou une série qui réunit ses épisodes. */
export type VideoCard = { series: true; key: string; item: Item; count: number } | { series: false; item: Item };

/** Tuiles des vidéos : les épisodes d'une même série sont réunis en une seule tuile, à la place du premier. */
export function videoCards(items: Item[]): VideoCard[] {
  const counts = new Map<string, number>();
  for (const v of items) {
    const sk = seriesKeyOf(v);
    if (sk) counts.set(sk, (counts.get(sk) || 0) + 1);
  }
  const seen = new Set<string>();
  const cards: VideoCard[] = [];
  for (const v of items) {
    const sk = seriesKeyOf(v);
    if (!sk) cards.push({ series: false, item: v });
    else if (!seen.has(sk)) {
      seen.add(sk);
      cards.push({ series: true, key: sk, item: v, count: counts.get(sk) as number });
    }
  }
  return cards;
}

/** Épisodes d'une série, dans l'ordre de la liste. */
export const episodesOfSeries = (vids: Item[], key: string): Item[] => vids.filter((v) => seriesKeyOf(v) === key);

const seasonOf = (e: Item): number => (e.season as number) || 0;

/** Saisons présentes, dans l'ordre (0 : épisodes sans saison). */
export const seasonsOf = (eps: Item[]): number[] => [...new Set(eps.map(seasonOf))].sort((a, b) => a - b);

/** Épisodes d'une saison, par numéro d'épisode. */
export const episodesOfSeason = (eps: Item[], season: number | null | undefined): Item[] =>
  eps.filter((e) => seasonOf(e) === (season || 0)).sort((a, b) => ((a.episode as number) || 0) - ((b.episode as number) || 0));

// Racine d'un chemin : le serveur d'où vient l'élément, sinon « Dossiers ».
function sourceRoot(v: Item): string {
  const p = String(v.dir || v.path || '');
  if (/^https?:\/\//i.test(p)) {
    try {
      return new URL(p).hostname.replace(/^www\./, '');
    } catch {
      return 'En ligne';
    }
  }
  return 'Dossiers';
}

/** Source d'un élément (streaming, en ligne, jeux PC, serveur ou dossiers) : sert de filtre et de tri. */
export function sourceOf(v: Item): string {
  if (v.bookmark || v.downloadBookmark) return 'Streaming';
  if (v.remote) return 'En ligne';
  if (v.auto || v.manualIndex != null || v.kind === 'game') return 'Jeux PC';
  return v.dir ? sourceRoot(v) : 'Dossiers';
}

/** Sources présentes dans une liste, dans l'ordre d'apparition. */
export const sourcesOf = (items: Item[]): string[] => [...new Set(items.map(sourceOf))];

/** Ne garde que les éléments d'une source ; la liste telle quelle si aucune source n'est choisie. */
export const bySource = (items: Item[], source: string | null | undefined): Item[] => (source ? items.filter((it) => sourceOf(it) === source) : items);

/** Tri des vidéos : `title` (A→Z, par défaut), `year` (récentes d'abord) ou `source`. Renvoie une copie. */
export function sortVideos(items: Item[], sort: string | null | undefined): Item[] {
  const s = sort || 'title';
  const arr = [...items];
  if (s === 'title') arr.sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
  else if (s === 'year') arr.sort((a, b) => (Number(b.sYear) || 0) - (Number(a.sYear) || 0));
  else if (s === 'source') arr.sort((a, b) => collator.compare(sourceOf(a), sourceOf(b)) || collator.compare(labelOf(a), labelOf(b)));
  return arr;
}
