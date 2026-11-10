/**
 * Enregistrement générique des handlers IPC : un handler par méthode de la table, ni plus ni moins.
 * Une erreur levée par un handler est journalisée et renvoyée à l'interface sous la forme `{ ok: false, error }`,
 * comme avant le contrat.
 */
import type { IpcArgs, IpcMethodName, IpcResult } from '@mire/shared/ipc';

/** Implémentation d'une méthode du contrat (synchrone ou non). */
export type IpcImplementation<K extends IpcMethodName> = (...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>;
export type IpcImplementations = { [K in IpcMethodName]: IpcImplementation<K> };

/** Ce que `registerHandlers` utilise d'`ipcMain`. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Vérifie que chaque méthode de la table a une implémentation et que chaque implémentation est dans la table. */
export function checkImplementations(table: Record<string, string>, implementations: Record<string, unknown>): void {
  const missing = Object.keys(table).filter((name) => typeof implementations[name] !== 'function');
  const extra = Object.keys(implementations).filter((name) => !Object.hasOwn(table, name));
  if (missing.length || extra.length) {
    throw new Error(`Contrat IPC : implémentation manquante (${missing.join(', ') || 'aucune'}), hors table (${extra.join(', ') || 'aucune'}).`);
  }
}

export function registerHandlers(ipcMain: IpcMainLike, table: Record<string, string>, implementations: Record<string, unknown>): void {
  checkImplementations(table, implementations);
  for (const [name, channel] of Object.entries(table)) {
    const fn = implementations[name] as (...args: unknown[]) => unknown;
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        console.error(channel, err);
        return { ok: false, error: (err as Error).message };
      }
    });
  }
}
