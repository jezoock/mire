/**
 * Catalogue d'éléments (P2-01), moteur de tags et d'infos (P2-04), pages (P2-07) et listes (P2-08) : nouvelles méthodes, sans usage dans
 * l'interface historique.
 */
import { listIdOfPage } from '@mire/shared';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function catalogHandlers(ctx: MainContext) {
  return {
    // L'élément avec ses tags, infos et images effectifs.
    catalogElement: (key) => ctx.tags.element(key),
    catalogSetTags: (key, changes) => ctx.tags.setTags(key, changes),
    catalogSetInfos: (key, changes) => ctx.tags.setInfos(key, changes),
    tagsList: () => ctx.tags.tagsList(),
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
  } satisfies Partial<IpcImplementations>;
}
