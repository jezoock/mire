/**
 * Catalogue d'éléments (P2-01) et moteur de tags et d'infos (P2-04) : nouvelles méthodes, sans usage dans
 * l'interface historique.
 */
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
    catalogPage: (pageId, path, cursor) => ctx.pages.page(pageId, path, cursor),
  } satisfies Partial<IpcImplementations>;
}
