/** Vues web intégrées, DRM, bloqueur de publicités et recherche dans les services de streaming. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function webHandlers(ctx: MainContext) {
  return {
    webOpen: (id, url, opts) => ctx.web.open(id, url, opts),
    webShow: (id, bounds, focus) => ctx.web.show(id, bounds, focus),
    webHide: () => ctx.web.hide(),
    webBounds: (bounds) => ctx.web.setBounds(bounds),
    webNav: (action) => ctx.web.nav(action),
    webClose: (id) => ctx.web.close(id),
    webFocus: () => ctx.web.focus(),
    webKey: (name) => ctx.web.key(name),
    webLearnSearch: (id) => ctx.web.learnSearch(id),
    webSessions: () => ctx.web.sessions(),
    drmStatus: (...args) => ctx.drmStatus(...args),
    searchStreaming: (...args) => ctx.searchStreaming(...args),

    adblockStatus: () => (ctx.adblock ? ctx.adblock.status() : null),
    adblockSetEnabled: async (on) => {
      const st = await ctx.adblock.setEnabled(on);
      ctx.web.reloadAll();
      return st;
    },
    adblockToggleSite: () => {
      const { adblock } = ctx;
      const wc = ctx.web.activeContents();
      if (!wc) return null;
      const st = adblock.toggleSite(wc.getURL());
      wc.reload();
      return { ...st, adOn: adblock.status().enabled && !adblock.pageAllowed(wc.getURL()) };
    },
    adblockSetLists: (lists) => ctx.adblock.setLists(lists || {}),
    adblockUpdate: async () => {
      await ctx.adblock.refresh();
      return ctx.adblock.status();
    },
  } satisfies Partial<IpcImplementations>;
}
