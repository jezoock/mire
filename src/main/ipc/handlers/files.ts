/** Gestion des fichiers (P2-10) : nouvelles méthodes, sans usage dans l'interface historique. */
import type { FilesResult } from '../../files/service.ts';
import { t } from '../../i18n/current.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

/** Refus du service → message à afficher, dans la langue de l'interface. */
async function outcome(result: Promise<FilesResult>) {
  const r = await result;
  if (r.ok) return { ok: true as const, path: r.path };
  return { ok: false as const, error: t(`files.errors.${r.code}`, { reason: r.reason ?? '' }) };
}

export function filesHandlers(ctx: MainContext) {
  return {
    filesRename: (target, name) => outcome(ctx.fileManager.rename(target, name)),
    filesMove: (target, folder) => outcome(ctx.fileManager.move(target, folder)),
    filesRemove: (target) => outcome(ctx.fileManager.remove(target)),
  } satisfies Partial<IpcImplementations>;
}
