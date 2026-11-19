/** Gestion des fichiers (P2-10) : utilisée par l'explorateur (P4-09), pas par l'interface historique. */
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

/** Nombre maximal de chemins contrôlés en une fois (sélection multiple de l'explorateur). */
export const MAX_CHECKED = 500;

/** Refus du service → message, ou `null` si le service peut agir. */
const reasonOf = (r: FilesResult): string | null => (r.ok ? null : t(`files.errors.${r.code}`, { reason: r.reason ?? '' }));

export function filesHandlers(ctx: MainContext) {
  return {
    filesRename: (target, name) => outcome(ctx.fileManager.rename(target, name)),
    filesMove: (target, folder) => outcome(ctx.fileManager.move(target, folder)),
    filesRemove: (target) => outcome(ctx.fileManager.remove(target)),
    // Une valeur qui n'est pas une liste de chemins (ou trop longue) est refusée en entier ; chaque chemin est contrôlé.
    filesCheck: async (targets) => {
      if (!Array.isArray(targets) || targets.length > MAX_CHECKED) return null;
      return Promise.all(targets.map(async (p) => reasonOf(await ctx.fileManager.check(p))));
    },
  } satisfies Partial<IpcImplementations>;
}
