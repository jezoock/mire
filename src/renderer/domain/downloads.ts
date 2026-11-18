/** Téléchargements : états (la ligne d'infos est rédigée par le Centre, P4-18 : src/renderer/centre/model.ts). */

/** États d'un téléchargement en cours (pas en pause, ni terminé). */
export const DL_ACTIVE: ReadonlySet<unknown> = new Set(['waiting', 'downloading', 'extracting']);
