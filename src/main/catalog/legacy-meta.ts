/**
 * Correspondance avec l'ancien `meta/meta.json` (infos modifiées à la main par l'interface historique) :
 * - ses clés (`v:<chemin>`, `t:<chemin>`, `i:<chemin>`, `r:<chemin>`, `b:<id>`, `a:<dossier>`, `g:<nom>`, `c:<console>`)
 *   ne sont pas celles des éléments : `legacyTarget` dit à quel élément chacune correspond ;
 * - ses champs (`title`, `year`, `genre`, `overview`, `artist`, `image`, `backdrop`) deviennent des infos et des
 *   images (`metaToOverride`), et inversement pour la façade (`overrideToMeta`).
 */
import type { ElementImages, ElementKey, InfoValue, OpenKind } from '@mire/shared';
import type { UserMeta } from '@mire/shared/ipc';
import { gameBookmarkKey, localFileKey } from './keys.ts';
import { INFO_ID_RE, isInfoValue } from './tags/registry.ts';

/** Champ de l'ancien format → info. */
const INFO_OF: Readonly<Record<string, string>> = { title: 'title', year: 'year', genre: 'genres', overview: 'overview', artist: 'artist' };
/** Champ de l'ancien format → image. */
const IMAGE_OF: Readonly<Record<string, keyof ElementImages>> = { image: 'poster', backdrop: 'background' };

/** Infos et images que la façade montre (et que « Réinitialiser » efface). */
export const FACADE_INFOS: readonly string[] = Object.values(INFO_OF);
export const FACADE_IMAGES: readonly (keyof ElementImages)[] = Object.values(IMAGE_OF);

/** Élément visé par une ancienne clé : clé déduite, et/ou fichier ou adresse à retrouver dans le catalogue. */
export interface LegacyTarget {
  /** Clé de l'élément quand elle se déduit de l'ancienne clé (chemin local, marque-page de jeu). */
  key?: ElementKey;
  /** Chemin ou adresse à chercher parmi les éléments qui s'ouvrent ainsi (`open.kind`). */
  find?: { target: string; kinds: readonly OpenKind[] };
}

const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

/** Élément visé par une ancienne clé ; `{}` pour un dossier, un jeu PC (nom), une console : aucun élément. */
export function legacyTarget(legacyKey: string, platform: NodeJS.Platform = process.platform): LegacyTarget {
  const m = /^([a-z]):(.+)$/s.exec(legacyKey);
  if (!m) return {};
  const [, prefix, rest] = m;
  // Vidéo, morceau, image : fichier local (clé déduite), fichier d'un serveur web ou entrée M3U (à retrouver).
  if (prefix === 'v' || prefix === 't' || prefix === 'i') {
    if (isUrl(rest)) return { find: { target: rest, kinds: ['file', 'stream'] } };
    return { key: localFileKey(rest, platform) };
  }
  // ROM : la console n'est pas dans la clé, l'élément se retrouve par son fichier.
  if (prefix === 'r') return { find: { target: rest, kinds: ['game'] } };
  if (prefix === 'b' && rest.trim()) return { key: gameBookmarkKey(rest) };
  return {};
}

/** Nombre écrit sans zéro en tête (« 1999 ») : relu à l'identique par la façade. */
const NUMBER_RE = /^(0|-?[1-9]\d{0,15})$/;

/** Infos et images d'une fiche de l'ancien format. Un champ inconnu est gardé comme info, s'il peut l'être. */
export function metaToOverride(meta: UserMeta): { infos: Record<string, InfoValue>; images: ElementImages } {
  const infos: Record<string, InfoValue> = {};
  const images: ElementImages = {};
  for (const [field, v] of Object.entries(meta)) {
    if (Object.hasOwn(IMAGE_OF, field)) {
      if (typeof v === 'string' && v) images[IMAGE_OF[field]] = v;
    } else if (field === 'year' && typeof v === 'string' && NUMBER_RE.test(v)) {
      infos.year = Number(v);
    } else if (field === 'genre' && typeof v === 'string') {
      const list = v
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      if (list.length) infos.genres = list;
    } else if (isInfoValue(v) && v !== '') {
      const id = Object.hasOwn(INFO_OF, field) ? INFO_OF[field] : field;
      if (INFO_ID_RE.test(id)) infos[id] = v;
    }
  }
  return { infos, images };
}

/** Fiche de l'ancien format, d'après les infos et les images saisies à la main ; `null` s'il n'y en a pas. */
export function overrideToMeta(o: { infos?: Record<string, InfoValue>; images?: ElementImages } | undefined): UserMeta | null {
  if (!o) return null;
  const meta: UserMeta = {};
  for (const [field, id] of Object.entries(INFO_OF)) {
    const v = o.infos?.[id];
    if (v === undefined) continue;
    if (field === 'year' && typeof v === 'number') meta.year = String(v);
    else if (field === 'genre' && Array.isArray(v)) meta.genre = v.join(', ');
    else meta[field] = v;
  }
  for (const [field, id] of Object.entries(IMAGE_OF)) if (o.images?.[id]) meta[field] = o.images[id];
  return Object.keys(meta).length ? meta : null;
}
