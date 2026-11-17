/** Éléments de la bibliothèque : libellés, clés des infos, infos fusionnées, genres, dossiers. */
import { cleanTrack, fold } from '@mire/shared';
import type { Info, Infos, Item } from './types.ts';

/** Ordre alphabétique de l'interface : chiffres comparés comme des nombres, accents et casse ignorés. */
export const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

// Titres de morceaux et groupes de dossier : déplacés dans `@mire/shared` (P2-05), utilisés ici et par les tags
// automatiques du processus principal.
export { cleanTrack, folderLabel, folderText } from '@mire/shared';

/** Libellé affiché : titre saisi ou récupéré, sinon nom lisible, sinon nom du fichier. */
export const labelOf = (it: Item): string =>
  (it.sTitle as string) || (it.displayName as string) || (it.kind === 'audio' ? cleanTrack(it.name as string) : (it.name as string));

/** Clé des infos récupérées en ligne ; chaîne vide pour un élément qui n'en a pas. */
export function scrapeKey(it: Item): string {
  if (it.kind === 'video') return `v:${it.path}`;
  if (it.kind === 'audio') return `a:${it.dir}`;
  if (it.kind === 'rom') return `r:${it.path}`;
  if (it.kind === 'game') return `g:${fold(it.name)}`;
  if (it.kind === 'gamebm') return `b:${it.bookmarkId}`;
  if (it.kind === 'image') return `i:${it.path}`;
  return '';
}

/** Clé des modifications manuelles : un morceau se modifie seul, l'album a sa propre fiche. */
export const metaKey = (it: Item, kind = it.kind): string => (kind === 'track' ? `t:${it.path}` : kind === 'album' ? `a:${it.dir}` : scrapeKey(it));

function merge(it: Item, sc: Info, um: Info, tm: Info): Item {
  const out: Item = { ...it };
  if ((it.kind === 'video' && !sc.series && sc.title) || ((it.kind === 'game' || it.kind === 'gamebm') && sc.title)) out.sTitle = sc.title;
  // Épisode d'une série : le titre de série vient du scrap (ou du nom déduit), pour l'arborescence.
  if (it.kind === 'video' && (sc.series || it.seriesTitle)) out.sSeries = sc.title || it.seriesTitle || '';
  if (it.kind !== 'audio' && um.title) out.sTitle = um.title;
  if (tm.title) out.sTitle = tm.title;
  out.sYear = um.year || sc.year || '';
  out.sGenre = tm.genre || um.genre || sc.genre || '';
  out.sOverview = um.overview || sc.overview || '';
  out.sArtist = um.artist || sc.artist || '';
  out.sImage = sc.image || null;
  out.uImage = um.image || null;
  out.sBackdrop = um.backdrop || it.fanart || sc.backdrop || null;
  return out;
}

interface Memo {
  sc: Info | undefined;
  um: Info | undefined;
  tm: Info | undefined;
  out: Item;
}

// Dernier résultat par élément. Les fiches sont remplacées (jamais modifiées sur place) quand elles changent :
// tant que l'élément et ses trois fiches sont les mêmes objets, le résultat est réutilisé.
const memo = new WeakMap<Item, Memo>();

/**
 * L'élément avec ses infos : celles que vous avez saisies passent avant celles récupérées en ligne.
 * Mémoïsé : recalculé seulement quand l'élément ou ses fiches changent. Le résultat ne doit pas être modifié.
 */
export function withScrape(it: Item, { scrape, meta }: Infos): Item {
  const key = scrapeKey(it);
  const sc = scrape[key];
  const um = meta[key];
  const tm = it.kind === 'audio' ? meta[`t:${it.path}`] : undefined;
  const hit = memo.get(it);
  if (hit && hit.sc === sc && hit.um === um && hit.tm === tm) return hit.out;
  const out = merge(it, sc || {}, um || {}, tm || {});
  memo.set(it, { sc, um, tm, out });
  return out;
}

/** Genres d'un élément (champ `sGenre`, séparés par des virgules). */
export const genresOf = (it: Item): string[] =>
  String(it.sGenre || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
