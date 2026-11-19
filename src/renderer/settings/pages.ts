/**
 * Administration des pages (P4-21), sans DOM : la liste des pages du panneau « Pages » des Réglages, le formulaire
 * d'une page (onglets Général, Éléments, Rangement) et la définition tirée de ses valeurs. Le processus principal
 * vérifie de nouveau la définition (`validatePage`) ; ici, on évite seulement d'envoyer ce qui ne peut pas convenir.
 */
import { PAGE_DISPLAYS, PAGE_ID_RE, slug } from '@mire/shared';
import type { InfoScalar, PageCondition, PageDefinition, PageOverview, PageSort, TagSummary } from '@mire/shared';
import type { FieldOption, FieldSpec, FormValues, SettingsEntryGroup, TabSpec } from '@mire/ui/utils';
import { pageName } from '../pages/model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Clé de la liste des pages dans l'écran Réglages (`createEntry`, `editEntry`, `removeEntry`, `restoreEntry`). */
export const PAGES_LIST = 'pages';

/** Infos proposées pour les conditions, les regroupements et le tri (noms : `catalog.infos.<id>`). */
export const PAGE_INFOS = [
  'title',
  'year',
  'genres',
  'artist',
  'album',
  'series',
  'season',
  'episode',
  'track',
  'system',
  'category',
  'channel',
  'folder',
  'playlist',
  'extension',
] as const;

/** Infos dont les valeurs sont des nombres : une valeur tapée y devient un nombre. */
const NUMBER_INFOS: readonly string[] = ['year', 'season', 'episode', 'track', 'channel'];

/** Nombre de lignes du formulaire : conditions, niveaux de regroupement, critères de tri. */
export const FORM_ROWS = { where: 3, groupBy: 3, sort: 2 } as const;

/** Tris propres aux éléments (en plus des infos) : le nom et la date d'ajout. */
const SORT_EXTRA = ['name', 'added'] as const;

const OPERATORS = ['between', 'equals', 'contains'] as const;
type Operator = (typeof OPERATORS)[number];

/** Liste des pages du panneau : nom, nombre d'éléments et origine ; « Revenir à l'origine » pour une page modifiée. */
export function pagesGroup(overview: readonly PageOverview[], t: Translate): SettingsEntryGroup {
  return {
    key: PAGES_LIST,
    entries: overview.map(({ page, origin, count }) => ({
      id: page.id,
      label: pageName(page, t),
      sub: [
        t('settingsView.pages.count', { count }),
        t(`settingsView.pages.origin.${origin}`),
        ...(page.menu?.pinned ? [t('settingsView.pages.inMenu')] : []),
      ].join(' · '),
      ...(origin === 'modified' ? { restore: true } : {}),
    })),
    empty: t('settingsView.pages.none'),
    edit: true,
    remove: true,
    buttons: [{ label: t('settingsView.pages.create'), action: 'createEntry' }],
  };
}

const infoOptions = (t: Translate, none: string): FieldOption[] => [['', none], ...PAGE_INFOS.map((id): FieldOption => [id, t(`catalog.infos.${id}`)])];

/** Nom affiché d'un tag (un tag inconnu garde son identifiant). */
const tagName = (id: string, known: readonly TagSummary[]): string => known.find((x) => x.id === id)?.name ?? id;

/** Identifiant d'un tag désigné par son nom : un tag connu (nom ou identifiant, sans la casse), sinon le nom simplifié. */
export function tagIdOf(name: string, known: readonly TagSummary[]): string {
  const n = name.trim().toLocaleLowerCase();
  const hit = known.find((x) => x.name.toLocaleLowerCase() === n) ?? known.find((x) => x.id.toLocaleLowerCase() === n);
  return hit ? hit.id : slug(name).slice(0, 64);
}

const scalarText = (v: InfoScalar | undefined): string => (v === undefined ? '' : String(v));

function conditionValues(c: PageCondition | undefined): { info: string; op: Operator; value: string; to: string } {
  if (!c) return { info: '', op: 'between', value: '', to: '' };
  if ('equals' in c) return { info: c.info, op: 'equals', value: scalarText(c.equals), to: '' };
  if ('contains' in c) return { info: c.info, op: 'contains', value: c.contains, to: '' };
  return { info: c.info, op: 'between', value: String(c.between[0]), to: String(c.between[1]) };
}

/** Onglets du formulaire d'une page (`page` : celle qu'on modifie, ou rien pour une nouvelle page). */
export function pageFormTabs(page: PageDefinition | null, known: readonly TagSummary[], t: Translate): TabSpec[] {
  const k = (key: string) => t(`settingsView.pages.form.${key}`);
  const general: FieldSpec[] = [
    { id: 'name', label: k('name'), value: page ? pageName(page, t) : '', required: true, full: true, placeholder: k('namePlaceholder') },
    { id: 'display', type: 'select', label: k('display'), value: page?.display ?? 'posters', options: PAGE_DISPLAYS.map((d) => [d, k(`displays.${d}`)]) },
    { id: 'pinned', type: 'toggle', label: k('pinned'), value: page ? !!page.menu?.pinned : true },
    { id: 'order', label: k('order'), value: page?.menu?.order === undefined ? '' : String(page.menu.order), placeholder: k('orderPlaceholder') },
  ];
  const content: FieldSpec[] = [
    {
      id: 'require',
      type: 'list',
      label: k('require'),
      value: (page?.require ?? []).map((id) => tagName(id, known)),
      placeholder: k('tagsPlaceholder'),
      folders: false,
    },
    {
      id: 'exclude',
      type: 'list',
      label: k('exclude'),
      value: (page?.exclude ?? []).map((id) => tagName(id, known)),
      placeholder: k('tagsPlaceholder'),
      folders: false,
    },
  ];
  for (let i = 0; i < FORM_ROWS.where; i++) {
    const c = conditionValues(page?.where?.[i]);
    content.push(
      {
        id: `where${i}.info`,
        type: 'select',
        label: t('settingsView.pages.form.condition', { n: i + 1 }),
        value: c.info,
        options: infoOptions(t, k('noCondition')),
      },
      { id: `where${i}.op`, type: 'select', label: k('operator'), value: c.op, options: OPERATORS.map((o) => [o, k(`operators.${o}`)]) },
      { id: `where${i}.value`, label: k('value'), value: c.value },
      { id: `where${i}.to`, label: k('to'), value: c.to, placeholder: k('toPlaceholder') },
    );
  }
  const arrange: FieldSpec[] = [];
  const levels = Math.max(FORM_ROWS.groupBy, page?.groupBy?.length ?? 0);
  for (let i = 0; i < levels; i++) {
    arrange.push({
      id: `groupBy${i}`,
      type: 'select',
      label: t('settingsView.pages.form.level', { n: i + 1 }),
      value: page?.groupBy?.[i] ?? '',
      options: infoOptions(t, k('noGroup')),
    });
  }
  const sortOptions: FieldOption[] = [['', k('noSort')], ...SORT_EXTRA.map((id): FieldOption => [id, k(`sortBy.${id}`)]), ...infoOptions(t, '').slice(1)];
  const sorts = Math.max(FORM_ROWS.sort, page?.sort?.length ?? 0);
  for (let i = 0; i < sorts; i++) {
    const s = page?.sort?.[i];
    arrange.push(
      { id: `sort${i}.by`, type: 'select', label: t('settingsView.pages.form.sort', { n: i + 1 }), value: s?.by ?? '', options: sortOptions },
      {
        id: `sort${i}.order`,
        type: 'select',
        label: k('sortOrder'),
        value: s?.order ?? 'asc',
        options: (['asc', 'desc'] as const).map((o) => [o, k(`orders.${o}`)]),
      },
    );
  }
  return [
    { id: 'general', label: k('tabs.general'), fields: general },
    { id: 'content', label: k('tabs.content'), fields: content },
    { id: 'arrange', label: k('tabs.arrange'), fields: arrange },
  ];
}

/** Identifiant d'une nouvelle page : son nom simplifié, rendu unique (`films-des-annees-90`, `films-des-annees-90-2`). */
export function newPageId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(name).slice(0, 56) || 'page';
  const ok = PAGE_ID_RE.test(base) ? base : `page-${base}`.slice(0, 56);
  let id = ok;
  for (let n = 2; used.has(id); n++) id = `${ok}-${n}`;
  return id;
}

const str = (v: FormValues[string] | undefined): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: FormValues[string] | undefined): string[] => (Array.isArray(v) ? v.map((x) => x.trim()).filter(Boolean) : []);
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const toNumber = (s: string): number => Number(s.replace(',', '.'));

function condition(values: FormValues, i: number): PageCondition | 'invalid' | null {
  const info = str(values[`where${i}.info`]);
  if (!info) return null;
  const op = str(values[`where${i}.op`]) as Operator;
  const value = str(values[`where${i}.value`]);
  const to = str(values[`where${i}.to`]);
  if (!value) return 'invalid';
  if (op === 'contains') return { info, contains: value };
  if (op === 'equals') return { info, equals: NUMBER_INFOS.includes(info) && NUMBER_RE.test(value) ? toNumber(value) : value };
  // « entre » : sans seconde valeur, la première sert aux deux bornes ; deux nombres, ou deux textes.
  const end = to || value;
  if (NUMBER_RE.test(value) && NUMBER_RE.test(end)) {
    const [a, b] = [toNumber(value), toNumber(end)];
    return { info, between: a <= b ? [a, b] : [b, a] };
  }
  if (NUMBER_INFOS.includes(info)) return 'invalid';
  return { info, between: [value, end] };
}

/** Résultat de `pageFromForm` : la définition à enregistrer, ou la clé du texte qui dit ce qui ne convient pas. */
export type PageFormResult = { ok: true; page: PageDefinition } | { ok: false; error: string };

/**
 * Définition d'une page d'après les valeurs du formulaire. `base` : la page modifiée (son identifiant, son icône et,
 * si le nom n'a pas changé, son nom traduit restent), ou `null` pour une nouvelle page (identifiant tiré du nom,
 * différent de `taken`).
 */
export function pageFromForm(
  values: FormValues,
  base: PageDefinition | null,
  known: readonly TagSummary[],
  taken: Iterable<string>,
  t: Translate,
): PageFormResult {
  const name = str(values.name);
  if (!name) return { ok: false, error: 'settingsView.pages.errors.name' };
  const where: PageCondition[] = [];
  for (let i = 0; i < FORM_ROWS.where; i++) {
    const c = condition(values, i);
    if (c === 'invalid') return { ok: false, error: 'settingsView.pages.errors.condition' };
    if (c) where.push(c);
  }
  // Conditions au-delà des lignes du formulaire (page écrite à la main) : gardées telles quelles.
  if (base?.where && base.where.length > FORM_ROWS.where) where.push(...base.where.slice(FORM_ROWS.where));
  const groupBy: string[] = [];
  for (let i = 0; values[`groupBy${i}`] !== undefined; i++) {
    const info = str(values[`groupBy${i}`]);
    if (info && !groupBy.includes(info)) groupBy.push(info);
  }
  const sort: PageSort[] = [];
  for (let i = 0; values[`sort${i}.by`] !== undefined; i++) {
    const by = str(values[`sort${i}.by`]);
    if (by) sort.push(str(values[`sort${i}.order`]) === 'desc' ? { by, order: 'desc' } : { by });
  }
  const orderText = str(values.order);
  if (orderText && !NUMBER_RE.test(orderText)) return { ok: false, error: 'settingsView.pages.errors.order' };
  const tags = (v: FormValues[string] | undefined) => [
    ...new Set(
      list(v)
        .map((n) => tagIdOf(n, known))
        .filter(Boolean),
    ),
  ];
  const exclude = tags(values.exclude);
  const display = str(values.display) as PageDefinition['display'];
  const page: PageDefinition = {
    id: base?.id ?? newPageId(name, taken),
    name: base && name === pageName(base, t) ? base.name : name,
    ...(base?.icon ? { icon: base.icon } : {}),
    require: tags(values.require),
    ...(exclude.length ? { exclude } : {}),
    ...(where.length ? { where } : {}),
    ...(groupBy.length ? { groupBy } : {}),
    ...(sort.length ? { sort } : {}),
    ...(display && PAGE_DISPLAYS.includes(display) ? { display } : {}),
    menu: { pinned: values.pinned === true, ...(orderText ? { order: toNumber(orderText) } : {}) },
  };
  return { ok: true, page };
}

/** Texte de l'aperçu : nombre d'éléments de la page, ou ce qui ne convient pas. */
export function previewText(r: { ok: true; count: number } | { ok: false; errors?: string[] } | null, t: Translate): string {
  if (!r?.ok) return t('settingsView.pages.errors.invalid');
  return t('settingsView.pages.preview', { count: r.count });
}
