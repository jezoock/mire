/** Métadonnées saisies à la main et images choisies sur le disque. */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';
import { t } from '../../i18n/current.ts';

// Image choisie sur le disque (bannière d'une console…) : copiée dans les données de Mire.
export async function pickImageFile(ctx: MainContext, title?: string) {
  const r = await ctx.electron.dialog.showOpenDialog(ctx.mainWindow, {
    title: title || t('dialogs.chooseAnImage'),
    properties: ['openFile'],
    filters: [{ name: t('dialogs.filters.images'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const dest = path.join(ctx.metaDir(), 'img', `${crypto.createHash('sha1').update(`${src}|${Date.now()}`).digest('hex')}${path.extname(src).toLowerCase()}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  return dest;
}

export function metaHandlers(ctx: MainContext) {
  return {
    metaAll: () => ctx.userMeta,
    metaSet: (...args) => ctx.setMeta(...args),
    metaPickImage: (...args) => ctx.pickMetaImage(...args),
    metaReset: (key) => {
      delete ctx.userMeta[key];
      ctx.saveMeta();
      return true;
    },
    pickImageFile: (title) => pickImageFile(ctx, title),
  } satisfies Partial<IpcImplementations>;
}
