/**
 * Éditeur d'un élément du catalogue (P4-22) : formulaire de P4-06 (`openForm`), choix de la bonne fiche
 * (`pickCandidate`), enregistrement par le catalogue (`catalog.setInfos`, `catalog.setTags`, images, réinitialisation).
 * Sans DOM : tout passe par le contexte des contrôleurs, et se teste sans Electron.
 */
import type { Element as CatalogElement, TagSummary } from '@mire/shared';
import type { FormHandle } from '../ui/dialogs.ts';
import type { ControllerContext } from '../controllers/types.ts';
import {
  EDITOR_FIELDS,
  SCRAPED_INFOS,
  TAGS_FIELD,
  editorFields,
  editorHelp,
  editorKind,
  editorTitle,
  infoChanges,
  infoValues,
  scrapeJob,
  tagChanges,
  type Candidate,
  type ImageField,
  type InfoField,
  type ScrapeJob,
} from './model.ts';

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error?: string };

const IMAGE_FIELDS: readonly string[] = ['poster', 'background'];

/** Ouvre l'éditeur d'un élément ; rend le bouton choisi (`save`, `reset`, `cancel`), ou `null` si l'élément manque. */
export async function openEditor(ctx: ControllerContext, key: string): Promise<string | null> {
  const { api, t, toast } = ctx;
  const el = (await api.catalogElement(key)) as CatalogElement | null;
  if (!el) {
    toast(t('editors.gone'));
    return null;
  }
  const known = ((await api.tagsList()) ?? []) as TagSummary[];
  const kind = editorKind(el);
  const infoFields = EDITOR_FIELDS[kind].infos;
  const fields = editorFields(el, known, t);
  // Valeurs de référence : celles de l'ouverture, puis celles d'une fiche récupérée en ligne.
  const initial: Record<string, string> = infoValues(el, infoFields);
  const job = scrapeJob(el);
  const res = await ctx.dialogs.form({
    title: editorTitle(kind, t),
    help: editorHelp(el),
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
        await image(ctx, key, act, field as ImageField, form);
        return true;
      }
      if (act === 'online' && job) {
        await searchOnline(ctx, key, job, form, initial, infoFields);
        return true;
      }
      if (act === 'reset') {
        await api.catalogReset(key);
        return false;
      }
      if (act === 'save') return !(await save(ctx, el, form, initial, infoFields, known));
      return false;
    },
  });
  if (res.action === 'save') toast(t('editors.saved'));
  else if (res.action === 'reset') toast(t('editors.resetDone'));
  if (res.action === 'save' || res.action === 'reset') ctx.ui.afterEdit?.();
  return res.action;
}

/** Image choisie sur le disque, ou retirée (l'image automatique revient). */
async function image(ctx: ControllerContext, key: string, act: string, field: ImageField, form: FormHandle): Promise<void> {
  if (act === 'pick') {
    const e = (await ctx.api.catalogPickImage(key, field)) as CatalogElement | null;
    if (e) form.setImage(field, e.images[field] ?? '');
    return;
  }
  const e = (await ctx.api.catalogClearImages(key, [field])) as CatalogElement | null;
  form.setImage(field, e?.images[field] ?? '');
}

/** Enregistre les infos et les tags changés ; faux si une valeur ne convient pas (la boîte reste ouverte). */
async function save(
  ctx: ControllerContext,
  el: CatalogElement,
  form: FormHandle,
  initial: Record<string, string>,
  infoFields: readonly InfoField[],
  known: readonly TagSummary[],
): Promise<boolean> {
  const { api, t } = ctx;
  const values = form.values();
  const { changes, invalid } = infoChanges(initial, values, infoFields);
  if (invalid.length) {
    form.help(t('editors.invalidYear'));
    return false;
  }
  if (Object.keys(changes).length) await api.catalogSetInfos(el.key, changes);
  const tags = tagChanges(el.tags, (values[TAGS_FIELD] as string[] | undefined) ?? [], known);
  if (Object.keys(tags).length) await api.catalogSetTags(el.key, tags);
  return true;
}

/**
 * « Rechercher en ligne » : fiches trouvées pour le nom saisi, choix de la bonne, récupération. Les champs prennent
 * les valeurs de la fiche, et les infos saisies à la main sont retirées pour qu'elles se voient (comme l'éditeur
 * historique) ; les images choisies à la main restent.
 */
async function searchOnline(
  ctx: ControllerContext,
  key: string,
  job: ScrapeJob,
  form: FormHandle,
  initial: Record<string, string>,
  infoFields: readonly InfoField[],
): Promise<void> {
  const { api, t } = ctx;
  const val = form.values();
  const query = String(val.title ?? '').trim();
  form.help(t('editors.online.searching'));
  const found = (await api.scrapeCandidates({ ...job, query, year: String(val.year ?? '') })) as Outcome<{ items: Candidate[] }> | null;
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
  const r = (await api.scrapeOne({ ...job, override: { pick } })) as Outcome | null;
  if (!r?.ok) {
    form.help((r && !r.ok && r.error) || t('editors.online.fetchFailed'));
    return;
  }
  const cleared = Object.fromEntries(SCRAPED_INFOS.map((f) => [f, null]));
  const el = (await api.catalogSetInfos(key, cleared)) as CatalogElement | null;
  if (el) {
    const next = infoValues(el, infoFields);
    for (const f of infoFields) {
      initial[f] = next[f];
      form.set(f, next[f]);
    }
    // Le titre de la fiche est proposé comme nom : enregistré, il devient le nom affiché.
    const title = typeof el.infos.title === 'string' ? el.infos.title : '';
    if (title) form.set('title', title);
    for (const f of EDITOR_FIELDS[editorKind(el)].images) form.setImage(f, el.images[f] ?? '');
  }
  form.help(t('editors.online.fetched', { title: pick.title }));
}
