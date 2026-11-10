/** Vues web intégrées, DRM, bloqueur de publicités et recherche dans les services de streaming. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function webHandlers(ctx: MainContext) {
  return {
    webOpen: (...args) => ctx.webOpen(...args),
    webShow: (...args) => ctx.webShow(...args),
    webHide: (...args) => ctx.webHide(...args),
    webBounds: (...args) => ctx.webBounds(...args),
    webNav: (...args) => ctx.webNav(...args),
    webClose: (...args) => ctx.webClose(...args),
    webFocus: (...args) => ctx.webFocus(...args),
    webKey: (...args) => ctx.webKey(...args),
    webLearnSearch: (...args) => ctx.webLearnSearch(...args),
    webSessions: (...args) => ctx.webSessions(...args),
    drmStatus: (...args) => ctx.drmStatus(...args),
    searchStreaming: (...args) => ctx.searchStreaming(...args),

    adblockStatus: () => (ctx.adblock ? ctx.adblock.status() : null),
    adblockSetEnabled: (on) => {
      const st = ctx.adblock.setEnabled(on);
      for (const w of ctx.webViews.values()) w.view.webContents.reload();
      return st;
    },
    adblockToggleSite: () => {
      const { adblock } = ctx;
      const w = ctx.webViews.get(ctx.web.activeId as string);
      if (!w) return null;
      const st = adblock.toggleSite(w.view.webContents.getURL());
      w.view.webContents.reload();
      return { ...st, adOn: adblock.status().enabled && !adblock.pageAllowed(w.view.webContents.getURL()) };
    },
    adblockSetLists: (lists) => ctx.adblock.setLists(lists || {}),
    adblockUpdate: async () => {
      await ctx.adblock.refresh();
      return ctx.adblock.status();
    },
  } satisfies Partial<IpcImplementations>;
}
