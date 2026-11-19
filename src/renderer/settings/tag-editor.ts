/**
 * Boîtes de dialogue des tags et des listes (P4-21, partie 2) : modifier un tag (nom, couleur, icône, fusion dans un
 * autre tag), créer ou renommer une liste. Sans DOM : tout passe par le contexte des contrôleurs.
 */
import type { ListSummary, TagOverview } from '@mire/shared';
import type { ControllerContext } from '../controllers/types.ts';
import { listName, tagChangesFromForm, tagFormFields } from './tags.ts';

/** Ouvre la boîte d'un tag ; vrai si quelque chose a été enregistré. */
export async function openTagEditor(ctx: ControllerContext, id: string): Promise<boolean> {
  const { api, t, toast } = ctx;
  const all = ((await api.tagsOverview()) as TagOverview[] | null) ?? [];
  const tag = all.find((x) => x.id === id);
  if (!tag) {
    toast(t('settingsView.tags.gone'));
    return false;
  }
  let done = false;
  const res = await ctx.dialogs.form({
    title: t('settingsView.tags.editTitle', { name: tag.name }),
    help: tag.origin === 'user' ? t('settingsView.tags.form.userHelp') : t('settingsView.tags.form.autoHelp'),
    fields: tagFormFields(tag, all, t),
    actions: [
      { id: 'save', label: t('settingsView.pages.save'), kind: 'primary' },
      { id: 'cancel', label: t('settingsView.pages.cancel'), kind: 'ghost' },
    ],
    async onAction(action, form) {
      if (action !== 'save') return false;
      const r = tagChangesFromForm(form.values(), tag);
      if (!r.ok) {
        form.help(t(r.error));
        return true;
      }
      const { rename, look, merge } = r.changes;
      if (look && !(await api.tagsSetLook(tag.id, look))) {
        form.help(t('settingsView.tags.errors.failed'));
        return true;
      }
      if (rename && !merge && !(await api.tagsRename(tag.id, rename))) {
        form.help(t('settingsView.tags.errors.name'));
        return true;
      }
      if (merge) {
        const n = (await api.tagsMerge(tag.id, merge)) as number | null;
        if (n === null) {
          form.help(t('settingsView.tags.errors.failed'));
          return true;
        }
        toast(t('settingsView.tags.merged', { name: tag.name, into: all.find((x) => x.id === merge)?.name ?? merge, count: n }));
      } else toast(t('settingsView.tags.saved', { name: rename ?? tag.name }));
      done = true;
      return false;
    },
  });
  return res.action === 'save' && done;
}

/** Demande le nom d'une liste (nouvelle : `list` absent) ; rend la liste créée ou renommée, ou `null`. */
export async function openListEditor(ctx: ControllerContext, list: ListSummary | null): Promise<boolean> {
  const { api, t, toast } = ctx;
  const res = await ctx.dialogs.form({
    title: list ? t('settingsView.lists.renameTitle', { name: listName(list, t) }) : t('settingsView.lists.createTitle'),
    fields: [{ id: 'name', label: t('settingsView.lists.name'), value: list ? listName(list, t) : '', required: true, full: true }],
    actions: [
      { id: 'save', label: t('settingsView.pages.save'), kind: 'primary' },
      { id: 'cancel', label: t('settingsView.pages.cancel'), kind: 'ghost' },
    ],
    async onAction(action, form) {
      if (action !== 'save') return false;
      const name = String(form.values().name ?? '').trim();
      if (list && name === listName(list, t)) return false;
      const ok = list ? await api.listsRename(list.id, name) : !!(await api.listsCreate(name));
      if (!ok) {
        form.help(t('settingsView.lists.errors.name'));
        return true;
      }
      toast(t(list ? 'settingsView.lists.renamed' : 'settingsView.lists.created', { name }));
      return false;
    },
  });
  return res.action === 'save';
}
