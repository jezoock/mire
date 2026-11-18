/**
 * Éditeurs (P4-22), sans DOM : champs du formulaire d'un élément du catalogue selon son genre (vidéo, morceau, image,
 * jeu…), changements à enregistrer (infos et tags modifiés à la main), et demande de recherche en ligne (fiches des
 * fournisseurs d'infos). Les textes viennent de la section `editors` des catalogues.
 */
import type { Element as CatalogElement, ElementImages, InfoChanges, InfoValue, TagChanges, TagSummary } from '@mire/shared';
import type { FieldSpec, FormValues } from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Genre d'élément, qui choisit les champs et le titre de l'éditeur. */
export type EditorKind = 'video' | 'track' | 'image' | 'game' | 'program' | 'other';

/** Infos que l'éditeur modifie, dans l'ordre du formulaire. */
export type InfoField = 'title' | 'year' | 'genres' | 'overview' | 'artist';
/** Images que l'éditeur modifie. */
export type ImageField = Extract<keyof ElementImages, 'poster' | 'background'>;

/** Champs de chaque genre : ceux de l'éditeur historique (`EDIT_FIELDS` d'app.js). */
export const EDITOR_FIELDS: Readonly<Record<EditorKind, { infos: readonly InfoField[]; images: readonly ImageField[] }>> = {
  video: { infos: ['title', 'year', 'genres', 'overview'], images: ['poster', 'background'] },
  track: { infos: ['title', 'genres'], images: [] },
  image: { infos: ['title', 'genres'], images: [] },
  game: { infos: ['title', 'year', 'genres', 'overview'], images: ['poster', 'background'] },
  program: { infos: ['title', 'year', 'genres', 'overview'], images: ['poster', 'background'] },
  other: { infos: ['title', 'genres'], images: ['poster'] },
};

/** Identifiant du champ des tags dans le formulaire. */
export const TAGS_FIELD = 'tags';

/** Genre d'un élément : sa façon de s'ouvrir, puis ses tags de type de fichier. */
export function editorKind(el: Pick<CatalogElement, 'open' | 'tags'>): EditorKind {
  if (el.open.kind === 'game') return 'game';
  if (el.open.kind === 'program') return 'program';
  if (el.open.kind === 'file') {
    if (el.tags.includes('video')) return 'video';
    if (el.tags.includes('audio')) return 'track';
    if (el.tags.includes('image')) return 'image';
  }
  return 'other';
}

/** Texte d'une info, tel que le champ le montre (genres séparés par des virgules). */
export function infoText(v: InfoValue | undefined): string {
  if (v === undefined) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** Valeur de départ de chaque info du formulaire : le titre est le nom affiché de l'élément. */
export function infoValues(el: Pick<CatalogElement, 'name' | 'infos'>, fields: readonly InfoField[]): Record<InfoField, string> {
  const out = {} as Record<InfoField, string>;
  for (const f of fields) out[f] = f === 'title' ? el.name : infoText(el.infos[f]);
  return out;
}

/** Noms affichés des tags d'un élément, dans l'ordre de ses tags (un tag inconnu garde son identifiant). */
export function tagNames(tags: readonly string[], known: readonly TagSummary[]): string[] {
  const byId = new Map(known.map((x) => [x.id, x.name]));
  return tags.map((id) => byId.get(id) ?? id);
}

/** Champs du formulaire d'un élément : infos, tags, puis images. */
export function editorFields(el: CatalogElement, known: readonly TagSummary[], t: Translate): FieldSpec[] {
  const { infos, images } = EDITOR_FIELDS[editorKind(el)];
  const values = infoValues(el, infos);
  const fields: FieldSpec[] = infos.map((f) => {
    const label = t(`editors.fields.${f}`);
    if (f === 'overview') return { id: f, type: 'textarea', label, value: values[f] };
    if (f === 'genres') return { id: f, label, value: values[f], placeholder: t('editors.fields.genresHint'), full: true };
    return { id: f, label, value: values[f], full: f === 'title' };
  });
  fields.push({ id: TAGS_FIELD, type: 'list', label: t('editors.fields.tags'), value: tagNames(el.tags, known), placeholder: t('editors.fields.tagsHint') });
  for (const f of images) fields.push({ id: f, type: 'image', label: t(`editors.fields.${f}`), value: el.images[f] ?? '', wide: f === 'background' });
  return fields;
}

const genreList = (s: string): string[] =>
  s
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Infos à enregistrer : seulement les champs changés depuis l'ouverture. Un champ vidé revient à l'automatique
 * (`null`), comme dans l'éditeur historique. Rend aussi les champs dont la valeur ne convient pas (année).
 */
export function infoChanges(
  initial: Readonly<Record<string, string>>,
  values: FormValues,
  fields: readonly InfoField[],
): { changes: InfoChanges; invalid: InfoField[] } {
  const changes: InfoChanges = {};
  const invalid: InfoField[] = [];
  for (const f of fields) {
    const before = initial[f] ?? '';
    const now = String(values[f] ?? '').trim();
    if (f === 'genres') {
      const list = genreList(now);
      if (!sameList(list, genreList(before))) changes.genres = list.length ? list : null;
      continue;
    }
    if (now === before.trim()) continue;
    if (!now) changes[f] = null;
    else if (f === 'year') {
      if (/^\d{1,4}$/.test(now)) changes.year = Number(now);
      else invalid.push(f);
    } else changes[f] = now;
  }
  return { changes, invalid };
}

/**
 * Tags à enregistrer : un tag retiré de la liste est retiré à la main (`false`), un tag ajouté l'est à la main
 * (`true`). Un nom connu désigne son tag ; un nouveau nom crée un tag de l'utilisateur (le catalogue le simplifie).
 */
export function tagChanges(initialIds: readonly string[], names: readonly string[], known: readonly TagSummary[]): TagChanges {
  const idOf = new Map<string, string>();
  for (const x of known) idOf.set(x.name.toLocaleLowerCase(), x.id);
  for (const id of initialIds) idOf.set(id.toLocaleLowerCase(), id);
  // Les noms de départ désignent toujours les tags de l'élément, même quand deux tags ont le même nom affiché.
  for (const [i, name] of tagNames(initialIds, known).entries()) idOf.set(name.toLocaleLowerCase(), initialIds[i]);
  const wanted = new Map<string, string>();
  for (const name of names) {
    const n = name.trim();
    if (n) wanted.set(idOf.get(n.toLocaleLowerCase()) ?? n, n);
  }
  const changes: TagChanges = {};
  for (const id of initialIds) if (!wanted.has(id)) changes[id] = false;
  for (const id of wanted.keys()) if (!initialIds.includes(id)) changes[id] = true;
  return changes;
}

/** Demande de fiches au moteur de récupération (`scrapeCandidates`, `scrapeOne`), au format de ses fournisseurs. */
export interface ScrapeJob {
  kind: 'video' | 'rom' | 'pc';
  item: Record<string, string>;
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const dirName = (p: string): string => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : '';
};
const stem = (name: string): string => name.replace(/\.[^.]+$/, '');

/**
 * Demande de fiches pour un élément : vidéos (TMDB), jeux de console (libretro) et programmes (Steam), comme l'éditeur
 * historique ; `null` pour les autres (morceaux, images, sites, chaînes : pas de recherche en ligne).
 */
export function scrapeJob(el: Pick<CatalogElement, 'open' | 'tags' | 'name'>): ScrapeJob | null {
  const kind = editorKind(el);
  const open = el.open;
  if (kind === 'video' && open.kind === 'file') return { kind: 'video', item: { path: open.path, name: baseName(open.path), dir: dirName(open.path) } };
  if (kind === 'game' && open.kind === 'game')
    return { kind: 'rom', item: { path: open.path, name: stem(baseName(open.path)), displayName: el.name, emu: open.console } };
  if (kind === 'program' && open.kind === 'program') return { kind: 'pc', item: { name: el.name, path: open.path } };
  return null;
}

/** Infos qu'une fiche trouvée en ligne remplit : les valeurs saisies à la main sont retirées pour qu'elles se voient. */
export const SCRAPED_INFOS: readonly InfoField[] = ['title', 'year', 'genres', 'overview'];

/** Fiche proposée par un fournisseur (`scrapeCandidates`), telle que la reçoit le choix de la bonne fiche. */
export interface Candidate {
  title: string;
  [k: string]: unknown;
}

/** Titre de l'éditeur, selon le genre d'élément. */
export const editorTitle = (kind: EditorKind, t: Translate): string => t(`editors.title.${kind}`);

/** Chemin ou adresse montré sous le titre (décodé pour une adresse). */
export function editorHelp(el: Pick<CatalogElement, 'open'>): string {
  const o = el.open;
  const p = o.kind === 'file' || o.kind === 'game' || o.kind === 'program' ? o.path : o.url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p;
  try {
    return decodeURI(p);
  } catch {
    return p;
  }
}
