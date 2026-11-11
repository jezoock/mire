/**
 * Seul point d'accès de l'interface à `window.api`, exposé par le preload (src/preload/preload.js).
 * Les méthodes et abonnements sont décrits par le contrat IPC (`@mire/shared/ipc`).
 */
import type { IpcApi } from '@mire/shared/ipc';

export type MireApi = IpcApi & {
  /** Chemin d'un fichier glissé-déposé (résolu dans le preload) ; chaîne vide si inconnu. */
  pathForFile(file: File): string;
};

declare global {
  interface Window {
    api: MireApi;
  }
}

export const api: MireApi = window.api;
