/**
 * Éditeur d'un regroupement (P4-22) : un album, une série, désignés par leur page et leur chemin. Le formulaire est
 * celui des éléments (`openForm`, P4-06) ; chaque modification vaut pour tous les éléments du regroupement et passe
 * par le catalogue en un seul appel (`catalogEditGroup`). Sans DOM : tout passe par le contexte des contrôleurs.
 */
import type { CatalogGroup, GroupFetchResult, TagSummary } from '@mire/shared';
import type { FormHandle } from '../ui/dialogs.ts';
import type { ControllerContext } from '../controllers/types.ts';
import type { Candidate, ImageField } from './model.ts';
import {
  GROUP_FIELDS,
  NAME_FIELD,
  factValues,
  groupEdit,
  groupFields,
  groupHelp,
  groupKind,
  groupScrapeJob,
  groupTitle,
  groupValues,
  isEmptyEdit,
  commonImage,
  type GroupKind,
  type GroupRef,
} from './group-model.ts';

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error?: string };

const IMAGE_FIELDS: readonly string[] = ['poster', 'background'];

/** État de la boîte : le regroupement suit son chemin (une image posée le rend à nouveau). */
interface Session {
  ref: GroupRef;
  group: CatalogGroup;
  initial: Record<string, string>;
}

/** Ouvre l'éditeur d'un regroupement ; rend le bouton choisi (`save`, `reset`, `cancel`), ou `null` s'il manque. */
export async function openGroupEditor(ctx: ControllerContext, ref: GroupRef): Promise<string | null> {
  const { api, t, toast } = ctx;
  const group = (await api.catalogGroup(ref.page, ref.path)) as CatalogGroup | null;
  if (!group) {
    toast(t('editors.group.gone'));
    return null;
  }
  const known = ((await api.tagsList()) ?? []) as TagSummary[];
  const kind = groupKind(group.info);
  const fields = groupFields(group, known, t);
  const s: Session = { ref: { page: group.page, path: group.path }, group, initial: groupValues(group) };
  const job = groupScrapeJob(kind);
  const res = await ctx.dialogs.form({
    title: groupTitle(kind, t),
    help: groupHelp(group, t),
    fields,
    actions: [
      { id: 'save', label: t('editors.actions.save'), kind: 'primary' },
      ...(job ? [{ id: 'online', label: t('editors.actions.online') }] : []),
      { id: 'reset', label: t('editors.actions.reset'), kind: 'ghost' as const },
      { id: 'cancel', label: t('editors.actions.cancel'), kind: 'ghost' as const },
    ],
    wide: fields.length > 3,
    labels: { emptyList: t('editors.noTags') },
    async onAction(action, form) {
      const [act, field] = action.split(':');
      if ((act === 'pick' || act === 'clear') && IMAGE_FIELDS.includes(field)) {
        await image(ctx, s, act, field as ImageField, form);
        return true;
      }
      if (act === 'online' && job) {
        await searchOnline(ctx, s, kind, form);
        return true;
      }
      if (act === 'reset') {
        await api.catalogEditGroup(s.ref.page, s.ref.path, { reset: true });
        return false;
      }
      if (act === 'save') return !(await save(ctx, s, form, known));
      return false;
    },
  });
  if (res.action === 'save') toast(t('editors.saved'));
  else if (res.action === 'reset') toast(t('editors.resetDone'));
  if (res.action === 'save' || res.action === 'reset') ctx.ui.afterEdit?.();
  return res.action;
}

/** Regroupement rendu par le catalogue : il remplace celui de la boîte (même chemin). */
function follow(s: Session, g: CatalogGroup | null): void {
  if (!g) return;
  s.group = g;
  s.ref = { page: g.page, path: g.path };
}

/** Image choisie sur le disque, ou retirée, pour tous les éléments. */
async function image(ctx: ControllerContext, s: Session, act: string, field: ImageField, form: FormHandle): Promise<void> {
  const { api } = ctx;
  const g = (
    act === 'pick'
      ? await api.catalogGroupPickImage(s.ref.page, s.ref.path, field)
      : await api.catalogEditGroup(s.ref.page, s.ref.path, { clearImages: [field] })
  ) as CatalogGroup | null;
  if (!g) return;
  follow(s, g);
  form.setImage(field, commonImage(g.elements, field));
}

/** Enregistre le nom, les infos et les tags changés ; faux si une valeur ne convient pas (la boîte reste ouverte). */
async function save(ctx: ControllerContext, s: Session, form: FormHandle, known: readonly TagSummary[]): Promise<boolean> {
  const { api, t } = ctx;
  const { edit, invalid } = groupEdit(s.group, s.initial, form.values(), known);
  if (invalid.length) {
    form.help(t(invalid.includes(NAME_FIELD) ? 'editors.group.nameRequired' : 'editors.invalidYear'));
    return false;
  }
  if (!isEmptyEdit(edit)) await api.catalogEditGroup(s.ref.page, s.ref.path, edit);
  return true;
}

/**
 * « Rechercher en ligne » : fiches trouvées pour le nom saisi (et l'artiste d'un album), choix de la bonne,
 * récupération. Ses images sont posées sur tous les éléments ; ses infos remplissent les champs, à enregistrer.
 */
async function searchOnline(ctx: ControllerContext, s: Session, kind: GroupKind, form: FormHandle): Promise<void> {
  const { api, t } = ctx;
  const job = groupScrapeJob(kind)!;
  const val = form.values();
  const query = String(val[NAME_FIELD] ?? '').trim();
  form.help(t('editors.online.searching'));
  const found = (await api.scrapeCandidates({ ...job, query, year: String(val.year ?? ''), artist: String(val.artist ?? '') })) as Outcome<{
    items: Candidate[];
  }> | null;
  if (!found?.ok) {
    form.help((found && !found.ok && found.error) || t('editors.online.failed'));
    return;
  }
  if (!found.items.length) {
    form.help(t('editors.online.none'));
    return;
  }
  const pick = ctx.dialogs.pick
    ? await ctx.dialogs.pick(found.items, { title: t('editors.online.choose'), help: t('editors.online.found', { count: found.items.length, query }) })
    : null;
  if (!pick) {
    form.help(t('editors.online.noChoice'));
    return;
  }
  form.help(t('editors.online.fetching', { title: pick.title }));
  const r = (await api.catalogGroupFetch(s.ref.page, s.ref.path, { ...job, pick })) as GroupFetchResult | null;
  if (!r?.ok) {
    form.help((r && !r.ok && r.error) || t('editors.online.fetchFailed'));
    return;
  }
  for (const [f, v] of Object.entries(factValues(r.facts, kind))) form.set(f, v);
  follow(s, r.group);
  for (const f of GROUP_FIELDS[kind].images) form.setImage(f, commonImage(s.group.elements, f));
  form.help(t('editors.online.fetched', { title: pick.title }));
}
