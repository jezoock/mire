/**
 * Éditeurs des regroupements (P4-22), sans DOM : champs du formulaire d'un album, d'une série ou d'un autre
 * regroupement, valeurs communes à tous ses éléments, changements à enregistrer (nom, infos, tags) et demande de
 * fiches en ligne (MusicBrainz pour un album, TMDB pour une série).
 */
import type { CatalogGroup, Element as CatalogElement, GroupEdit, PagePath, TagSummary } from '@mire/shared';
import type { FieldSpec, FormValues } from '@mire/ui/utils';
import { TAGS_FIELD, infoChanges, infoText, tagChanges, tagNames, type ImageField, type InfoField } from './model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Regroupement désigné par sa page et son chemin (jamais par son rang). */
export interface GroupRef {
  page: string;
  path: PagePath;
}

/** Genre de regroupement, d'après l'info qui le forme. */
export type GroupKind = 'album' | 'series' | 'other';

/** Identifiant du champ du nom (la valeur de l'info qui sert à regrouper). */
export const NAME_FIELD = 'name';

/** Champs de chaque genre : les infos communes, puis les images. */
export const GROUP_FIELDS: Readonly<Record<GroupKind, { infos: readonly InfoField[]; images: readonly ImageField[] }>> = {
  album: { infos: ['artist', 'year', 'genres'], images: ['poster'] },
  series: { infos: ['year', 'genres', 'overview'], images: ['poster', 'background'] },
  other: { infos: [], images: ['poster'] },
};

export const groupKind = (info: string): GroupKind => (info === 'album' || info === 'series' ? info : 'other');

/** Valeur commune à tous les éléments (texte du champ), ou `''` si elles diffèrent. */
export function commonInfo(elements: readonly Pick<CatalogElement, 'infos'>[], field: string): { value: string; mixed: boolean } {
  const values = new Set(elements.map((e) => infoText(e.infos[field])));
  if (values.size === 1) return { value: [...values][0], mixed: false };
  return { value: '', mixed: values.size > 1 };
}

/** Tags portés par tous les éléments, dans l'ordre du premier. */
export function commonTags(elements: readonly Pick<CatalogElement, 'tags'>[]): string[] {
  const [first, ...rest] = elements;
  return (first?.tags ?? []).filter((id) => rest.every((e) => e.tags.includes(id)));
}

/** Image montrée : celle de tous les éléments, sinon celle du premier qui en a une. */
export function commonImage(elements: readonly Pick<CatalogElement, 'images'>[], field: ImageField): string {
  return elements.map((e) => e.images[field]).find((v) => !!v) ?? '';
}

/** Nom du regroupement tel que le champ le montre (vide pour « Autres »). */
export const groupName = (g: Pick<CatalogGroup, 'value'>): string => (g.value === null ? '' : String(g.value));

/** Valeurs de départ des champs d'infos (le nom compris). */
export function groupValues(g: CatalogGroup): Record<string, string> {
  const out: Record<string, string> = { [NAME_FIELD]: groupName(g) };
  for (const f of GROUP_FIELDS[groupKind(g.info)].infos) out[f] = commonInfo(g.elements, f).value;
  return out;
}

/** Champs du formulaire : nom, infos communes (« Plusieurs valeurs » si elles diffèrent), tags communs, images. */
export function groupFields(g: CatalogGroup, known: readonly TagSummary[], t: Translate): FieldSpec[] {
  const { infos, images } = GROUP_FIELDS[groupKind(g.info)];
  const fields: FieldSpec[] = [{ id: NAME_FIELD, label: t('editors.fields.title'), value: groupName(g), full: true }];
  for (const f of infos) {
    const { value, mixed } = commonInfo(g.elements, f);
    const label = t(`editors.fields.${f}`);
    const placeholder = mixed ? t('editors.group.mixed') : f === 'genres' ? t('editors.fields.genresHint') : undefined;
    const spec: FieldSpec = f === 'overview' ? { id: f, type: 'textarea', label, value } : { id: f, label, value, full: f === 'genres' };
    fields.push(placeholder ? { ...spec, placeholder } : spec);
  }
  fields.push({
    id: TAGS_FIELD,
    type: 'list',
    label: t('editors.fields.tags'),
    value: tagNames(commonTags(g.elements), known),
    placeholder: t('editors.fields.tagsHint'),
  });
  for (const f of images) fields.push({ id: f, type: 'image', label: t(`editors.fields.${f}`), value: commonImage(g.elements, f), wide: f === 'background' });
  return fields;
}

/**
 * Modification à enregistrer : le nom changé (`rename`), les infos changées (un champ « Plusieurs valeurs » laissé
 * vide ne change rien), les tags communs ajoutés ou retirés. `invalid` : `name` vidé, ou année qui ne convient pas.
 */
export function groupEdit(
  g: CatalogGroup,
  initial: Readonly<Record<string, string>>,
  values: FormValues,
  known: readonly TagSummary[],
): { edit: GroupEdit; invalid: string[] } {
  const edit: GroupEdit = {};
  const invalid: string[] = [];
  const name = String(values[NAME_FIELD] ?? '').trim();
  if (!name && initial[NAME_FIELD]) invalid.push(NAME_FIELD);
  else if (name && name !== initial[NAME_FIELD]) edit.rename = name;
  const r = infoChanges(initial, values, GROUP_FIELDS[groupKind(g.info)].infos);
  invalid.push(...r.invalid);
  if (Object.keys(r.changes).length) edit.infos = r.changes;
  const tags = tagChanges(commonTags(g.elements), (values[TAGS_FIELD] as string[] | undefined) ?? [], known);
  if (Object.keys(tags).length) edit.tags = tags;
  return { edit, invalid };
}

/** Modification vide (rien à enregistrer). */
export const isEmptyEdit = (e: GroupEdit): boolean => !Object.keys(e).length;

/** Demande de fiches au moteur de récupération : un album (MusicBrainz), une série (TMDB) ; `null` sinon. */
export function groupScrapeJob(kind: GroupKind): { kind: 'album' | 'video'; item: Record<string, unknown> } | null {
  if (kind === 'album') return { kind: 'album', item: {} };
  if (kind === 'series') return { kind: 'video', item: { tv: true } };
  return null;
}

/** Valeurs d'une fiche trouvée en ligne, champ par champ (le nom de la fiche est proposé comme nom). */
export function factValues(
  facts: { title: string; year?: string; genre?: string; overview?: string; artist?: string },
  kind: GroupKind,
): Record<string, string> {
  const all: Record<string, string> = {
    [NAME_FIELD]: facts.title,
    artist: facts.artist ?? '',
    year: facts.year ?? '',
    genres: facts.genre ?? '',
    overview: facts.overview ?? '',
  };
  const keep = [NAME_FIELD, ...GROUP_FIELDS[kind].infos];
  return Object.fromEntries(keep.filter((f) => all[f]).map((f) => [f, all[f]]));
}

/** Titre de l'éditeur, et texte d'aide (nombre d'éléments touchés). */
export const groupTitle = (kind: GroupKind, t: Translate): string => t(`editors.group.title.${kind}`);
export const groupHelp = (g: CatalogGroup, t: Translate): string => t('editors.group.help', { count: g.elements.length });

/** Regroupement désigné par l'action `openGroup` d'une carte : celle d'une page (`route`), ou de l'accueil (`target`). */
export function groupRefOfAction(action: string | null, target: string | null, route: GroupRef | null): GroupRef | null {
  const m = /^openGroup:(.*)$/s.exec(action ?? '');
  if (!m) return null;
  let args: unknown;
  try {
    args = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const a = (Array.isArray(args) ? args[0] : null) as { value?: unknown; target?: unknown } | null;
  if (!a || !('value' in a)) return null;
  const value = a.value as PagePath[number];
  if (typeof a.target === 'string' && a.target) return { page: a.target, path: [value] };
  if (target === 'mire-page' && route) return { page: route.page, path: [...route.path, value] };
  return null;
}
