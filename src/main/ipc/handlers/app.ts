/** Fenêtre, application et lecteur externe. */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function appHandlers(ctx: MainContext) {
  return {
    playExternal: (...args) => ctx.playExternal(...args),
    toggleFullscreen: () => {
      const { mainWindow } = ctx;
      if (!mainWindow) return false;
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return mainWindow.isFullScreen();
    },
    quit: () => {
      ctx.electron.app.quit();
      return true;
    },
    // Mode secours (P4-10) : sans argument ; rien de ce qui vient de la page n'est lu.
    rescueStart: () => ctx.rescue.takeStart(),
    rescueThemeOk: () => {
      ctx.rescue.themeOk();
      return true;
    },
  } satisfies Partial<IpcImplementations>;
}
