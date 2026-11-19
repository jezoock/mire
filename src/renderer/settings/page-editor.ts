/**
 * Boîte de dialogue d'une page (P4-21) : formulaire à onglets de P4-06 (`dialogs.form`), « Compter les éléments »
 * (aperçu, `pages.preview`), enregistrement (`pages.save`). Sans DOM : tout passe par le contexte des contrôleurs.
 */
import type { PageDefinition, PagePreview, PageSaveResult, TagSummary } from '@mire/shared';
import type { ControllerContext } from '../controllers/types.ts';
import type { FormHandle } from '../ui/dialogs.ts';
import { pageName } from '../pages/model.ts';
import { pageFormTabs, pageFromForm, previewText } from './pages.ts';

/**
 * Ouvre la boîte d'une page (`id`) ou d'une nouvelle page (`null`) ; rend la page enregistrée, ou `null` (abandon,
 * page inconnue).
 */
export async function openPageEditor(ctx: ControllerContext, id: string | null): Promise<PageDefinition | null> {
  const { api, t, toast } = ctx;
  const base = id === null ? null : ((await api.pagesGet(id)) as PageDefinition | null);
  if (id !== null && !base) {
    toast(t('settingsView.pages.gone'));
    return null;
  }
  const [known, all] = await Promise.all([
    (api.tagsList() as Promise<TagSummary[] | null>).then((x) => x ?? []),
    (api.pagesList() as Promise<PageDefinition[] | null>).then((x) => x ?? []),
  ]);
  const taken = all.map((p) => p.id);
  const tagsHelp = t('settingsView.pages.form.knownTags', { tags: known.map((x) => x.name).join(', ') });
  let saved: PageDefinition | null = null;

  /** Définition tirée du formulaire, ou `null` (l'erreur est écrite dans la boîte). */
  const read = (form: FormHandle): PageDefinition | null => {
    const r = pageFromForm(form.values(), base, known, taken, t);
    if (r.ok) return r.page;
    form.help(t(r.error));
    return null;
  };

  const res = await ctx.dialogs.form({
    title: base ? t('settingsView.pages.editTitle', { name: pageName(base, t) }) : t('settingsView.pages.createTitle'),
    help: tagsHelp,
    tabs: pageFormTabs(base, known, t),
    actions: [
      { id: 'save', label: t('settingsView.pages.save'), kind: 'primary' },
      { id: 'preview', label: t('settingsView.pages.countButton') },
      { id: 'cancel', label: t('settingsView.pages.cancel'), kind: 'ghost' },
    ],
    wide: true,
    labels: { emptyList: t('settingsView.pages.form.noTags') },
    async onAction(action, form) {
      if (action === 'preview') {
        const page = read(form);
        if (page) form.help(previewText((await api.pagesPreview(page)) as PagePreview | null, t));
        return true;
      }
      if (action !== 'save') return false;
      const page = read(form);
      if (!page) return true;
      const r = (await api.pagesSave(page)) as PageSaveResult | null;
      if (!r?.ok) {
        form.help(t('settingsView.pages.errors.invalid'));
        return true;
      }
      saved = r.page;
      return false;
    },
  });
  if (res.action !== 'save' || !saved) return null;
  toast(t('settingsView.pages.saved', { name: pageName(saved, t) }));
  return saved;
}
