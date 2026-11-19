/**
 * Administration des tags et des listes (P4-21, partie 2), sans DOM : les lignes des panneaux « Tags » et « Listes »
 * des Réglages, le formulaire d'un tag, les règles par type de fichier (`catalog.fileTags` de la configuration) et
 * l'ordre des listes. Le processus principal vérifie de nouveau chaque valeur.
 */
import { TAG_COLORS, TAG_ICONS, TAG_NAME_MAX } from '@mire/shared';
import type { ListSummary, TagColor, TagIcon, TagLookChanges, TagOverview, TagSummary } from '@mire/shared';
import type { FieldOption, FieldSpec, FormValues, OrderListView, SettingsEntryGroup } from '@mire/ui/utils';
import { tagIdOf } from './pages.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Clés des listes de l'écran Réglages (`createEntry`, `editEntry`, `removeEntry`, `addEntry`, `setOrder`). */
export const TAGS_LIST = 'tags';
export const FILE_RULES_LIST = 'fileTags';
export const LISTS_LIST = 'lists';

const COLOR_IDS = Object.keys(TAG_COLORS) as TagColor[];

/** Qui pose un tag, en texte : Mire, vous, ou le nom de chaque plugin (son identifiant s'il n'est pas connu). */
export function setByText(tag: Pick<TagOverview, 'setBy'>, pluginNames: Readonly<Record<string, string>>, t: Translate): string {
  const who = tag.setBy.map((s) => (s === 'core' ? t('settingsView.tags.by.core') : s === 'user' ? t('settingsView.tags.by.user') : (pluginNames[s] ?? s)));
  return who.length ? t('settingsView.tags.setBy', { who: who.join(', ') }) : t('settingsView.tags.by.none');
}

/** Lignes du panneau « Tags » : nom, nombre d'éléments, qui le pose, couleur et icône ; Retirer pour vos tags. */
export function tagsGroup(tags: readonly TagOverview[], pluginNames: Readonly<Record<string, string>>, t: Translate): SettingsEntryGroup {
  return {
    key: TAGS_LIST,
    entries: tags.map((tag) => {
      const look = [
        ...(tag.look.color ? [t(`settingsView.tags.colors.${tag.look.color}`)] : []),
        ...(tag.look.icon ? [t(`settingsView.tags.icons.${tag.look.icon}`)] : []),
      ];
      return {
        id: tag.id,
        label: tag.name,
        sub: [t('settingsView.pages.count', { count: tag.count }), setByText(tag, pluginNames, t), ...look].join(' · '),
        ...(tag.origin === 'user' ? {} : { keep: true }),
      };
    }),
    empty: t('settingsView.tags.none'),
    edit: true,
    remove: true,
  };
}

/** Champs du formulaire d'un tag : nom et fusion pour vos tags seulement ; couleur et icône pour tous. */
export function tagFormFields(tag: TagOverview, all: readonly TagSummary[], t: Translate): FieldSpec[] {
  const k = (key: string) => t(`settingsView.tags.form.${key}`);
  const fields: FieldSpec[] = [];
  if (tag.origin === 'user') fields.push({ id: 'name', label: k('name'), value: tag.name, required: true, full: true });
  fields.push(
    {
      id: 'color',
      type: 'select',
      label: k('color'),
      value: tag.look.color ?? '',
      options: [['', k('noColor')], ...COLOR_IDS.map((c): FieldOption => [c, t(`settingsView.tags.colors.${c}`)])],
    },
    {
      id: 'icon',
      type: 'select',
      label: k('icon'),
      value: tag.look.icon ?? '',
      options: [['', k('noIcon')], ...TAG_ICONS.map((i): FieldOption => [i, t(`settingsView.tags.icons.${i}`)])],
    },
  );
  if (tag.origin === 'user') {
    const others = all.filter((x) => x.id !== tag.id && x.origin !== 'other');
    fields.push({
      id: 'merge',
      type: 'select',
      label: k('merge'),
      value: '',
      options: [['', k('noMerge')], ...others.map((x): FieldOption => [x.id, x.name])],
      full: true,
    });
  }
  return fields;
}

/** Ce que le formulaire d'un tag demande : nouveau nom, apparence changée, fusion dans un autre tag. */
export interface TagFormChanges {
  rename?: string;
  look?: TagLookChanges;
  merge?: string;
}

/** Changements tirés du formulaire d'un tag ; `error` : clé du texte qui dit ce qui ne convient pas. */
export function tagChangesFromForm(values: FormValues, tag: TagOverview): { ok: true; changes: TagFormChanges } | { ok: false; error: string } {
  const changes: TagFormChanges = {};
  if (tag.origin === 'user') {
    const name = typeof values.name === 'string' ? values.name.trim() : '';
    if (!name || name.length > TAG_NAME_MAX) return { ok: false, error: 'settingsView.tags.errors.name' };
    if (name !== tag.name) changes.rename = name;
    if (typeof values.merge === 'string' && values.merge) changes.merge = values.merge;
  }
  const color = typeof values.color === 'string' && values.color ? (values.color as TagColor) : null;
  const icon = typeof values.icon === 'string' && values.icon ? (values.icon as TagIcon) : null;
  const look: TagLookChanges = {};
  if (color !== (tag.look.color ?? null)) look.color = color;
  if (icon !== (tag.look.icon ?? null)) look.icon = icon;
  if (Object.keys(look).length) changes.look = look;
  return { ok: true, changes };
}

/** Règles par type de fichier changées (`catalog.fileTags`), lues dans la configuration. */
export function fileRules(config: unknown): Record<string, string[]> {
  const raw = (config as { catalog?: { fileTags?: unknown } } | null)?.catalog?.fileTags;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [ext, tags] of Object.entries(raw)) if (Array.isArray(tags)) out[ext] = tags.filter((x): x is string => typeof x === 'string');
  return out;
}

/** Lignes des règles changées : extension, tags posés (leurs noms) ; champs et bouton pour en ajouter une. */
export function fileRulesGroup(config: unknown, known: readonly TagSummary[], t: Translate): SettingsEntryGroup {
  const name = (id: string) => known.find((x) => x.id === id)?.name ?? id;
  return {
    key: FILE_RULES_LIST,
    label: t('settingsView.tags.rules.label'),
    entries: Object.entries(fileRules(config))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ext, tags]) => ({ id: ext, label: ext, sub: tags.length ? tags.map(name).join(', ') : t('settingsView.tags.rules.noTag') })),
    empty: t('settingsView.tags.rules.none'),
    remove: true,
    inputs: [
      { id: 'ext', label: t('settingsView.tags.rules.ext'), placeholder: '.mkv' },
      { id: 'tags', label: t('settingsView.tags.rules.tags'), placeholder: t('settingsView.tags.rules.tagsPlaceholder') },
    ],
    buttons: [{ label: t('settingsView.add'), action: 'addEntry' }],
  };
}

/** Extension écrite à la main (« MKV », « .mkv ») → `.mkv`, ou `null` (même règle que le processus principal). */
export function normalizeExt(ext: string): string | null {
  const e = ext.trim().toLowerCase().replace(/^\.?/, '.');
  return /^\.[a-z0-9]{1,16}$/.test(e) ? e : null;
}

/**
 * Règles après l'ajout d'une règle : `ext` pose les tags nommés dans `tagsText` (séparés par des virgules ; aucun :
 * l'extension ne pose plus de tag). `null` si l'extension ne convient pas.
 */
export function withFileRule(config: unknown, ext: string, tagsText: string, known: readonly TagSummary[]): Record<string, string[]> | null {
  const e = normalizeExt(ext);
  if (!e) return null;
  const tags = [
    ...new Set(
      tagsText
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => tagIdOf(n, known))
        .filter(Boolean),
    ),
  ];
  return { ...fileRules(config), [e]: tags };
}

/** Règles sans celle d'une extension (elle revient à la règle par défaut). */
export function withoutFileRule(config: unknown, ext: string): Record<string, string[]> {
  const rules = fileRules(config);
  delete rules[ext];
  return rules;
}

const listName = (l: ListSummary, t: Translate): string => (typeof l.name === 'string' ? l.name : t(l.name.key));

/** Lignes du panneau « Listes » : nom et nombre d'éléments ; Modifier (renommer), Retirer, Créer une liste. */
export function listsGroup(lists: readonly ListSummary[], t: Translate): SettingsEntryGroup {
  return {
    key: LISTS_LIST,
    entries: lists.map((l) => ({ id: l.id, label: listName(l, t), sub: t('settingsView.pages.count', { count: l.count }) })),
    empty: t('settingsView.lists.none'),
    edit: true,
    remove: true,
    buttons: [{ label: t('settingsView.lists.create'), action: 'createEntry' }],
  };
}

/** Ordre des listes (`ds-sortable`) : toutes les listes, dans l'ordre enregistré. */
export function listsOrder(lists: readonly ListSummary[], t: Translate): OrderListView {
  return {
    kind: LISTS_LIST,
    label: t('settingsView.lists.order'),
    items: lists.map((l) => ({ id: l.id, label: listName(l, t), color: 'var(--muted)', on: true })),
    toggle: false,
  };
}

/** Nom affiché d'une liste (pour les boîtes de dialogue). */
export { listName };
