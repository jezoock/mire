/**
 * Catalogue d'éléments (P2-01), moteur de tags et d'infos (P2-04), pages (P2-07), listes (P2-08) et recherche (P2-09) : nouvelles méthodes, sans usage dans
 * l'interface historique.
 */
import { listIdOfPage } from '@mire/shared';
import type { MainContext } from '../context.ts';
import { editGroup, groupFacts, groupOf, setGroupImages } from '../../catalog/groups.ts';
import { IMAGE_FIELDS } from '../../catalog/tags/engine.ts';
import { t } from '../../i18n/current.ts';
import { pickImageFile } from './meta.ts';
import type { IpcImplementations } from '../register.ts';

export function catalogHandlers(ctx: MainContext) {
  return {
    // L'élément avec ses tags, infos et images effectifs.
    catalogElement: (key) => ctx.tags.element(key),
    catalogSetTags: (key, changes) => ctx.tags.setTags(key, changes),
    catalogSetInfos: (key, changes) => ctx.tags.setInfos(key, changes),
    tagsList: () => ctx.tags.tagsList(),
    // Éditeurs (P4-22) : image choisie sur le disque (copiée dans les données de Mire), images effacées, réinitialisation.
    catalogPickImage: async (key, field) => {
      if (!ctx.tags.element(key) || !IMAGE_FIELDS.includes(field)) return null;
      const file = await pickImageFile(ctx, t('dialogs.chooseAnImage'));
      return file ? ctx.tags.setImage(key, field, file) : null;
    },
    catalogClearImages: (key, fields) => ctx.tags.clearImages(key, fields),
    catalogReset: (key) => ctx.tags.reset(key),
    // Éditeurs des regroupements (P4-22) : chaque modification vaut pour tous les éléments du regroupement.
    catalogGroup: (pageId, path) => groupOf(ctx, pageId, path),
    catalogEditGroup: (pageId, path, edit) => editGroup(ctx, pageId, path, edit),
    catalogGroupPickImage: async (pageId, path, field) => {
      if (!ctx.pages.group(pageId, path) || !IMAGE_FIELDS.includes(field)) return null;
      const file = await pickImageFile(ctx, t('dialogs.chooseAnImage'));
      return file ? setGroupImages(ctx, pageId, path, { [field]: file }) : null;
    },
    catalogGroupFetch: async (pageId, path, job) => {
      const g = ctx.pages.group(pageId, path);
      const pick = job?.pick as { id?: unknown } | undefined;
      if (!g || !job || typeof job.kind !== 'string' || typeof pick?.id !== 'string') return { ok: false };
      // Les images de la fiche sont copiées par le moteur de récupération, sous un nom tiré du regroupement.
      const key = `group:${g.page}:${JSON.stringify(g.path)}:${pick.id}`;
      const r = await ctx.scraper.lookup({ kind: job.kind, item: job.item ?? {}, override: { pick }, key });
      if (!r?.ok) return { ok: false, ...(r?.error ? { error: String(r.error) } : {}) };
      const { image, backdrop } = r.facts as { image?: string | null; backdrop?: string | null };
      const group = setGroupImages(ctx, pageId, path, { ...(image ? { poster: image } : {}), ...(backdrop ? { background: backdrop } : {}) });
      return { ok: true, facts: groupFacts(r.facts), group };
    },
    // Pages et regroupements (P2-07).
    pagesList: () => ctx.pages.list(),
    pagesGet: (id) => ctx.pages.get(id),
    pagesSave: (page) => ctx.pages.save(page),
    pagesRemove: (id) => ctx.pages.remove(id),
    catalogPage: (pageId, path, cursor) => (listIdOfPage(pageId) === null ? ctx.pages : ctx.lists).page(pageId, path, cursor),
    // Listes (P2-08).
    listsList: () => ctx.lists.list(),
    listsGet: (id) => ctx.lists.get(id),
    listsCreate: (name) => ctx.lists.create(name),
    listsRename: (id, name) => ctx.lists.rename(id, name),
    listsRemove: (id) => ctx.lists.remove(id),
    listsAdd: (id, keys, at?: number) => ctx.lists.add(id, keys, at),
    listsRemoveItems: (id, keys) => ctx.lists.removeItems(id, keys),
    listsMove: (id, key, to) => ctx.lists.move(id, key, to),
    // Recherche dans le catalogue (P2-09).
    catalogSearch: (query, options?) => ctx.search.search(query, options),
  } satisfies Partial<IpcImplementations>;
}
