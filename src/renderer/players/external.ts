/**
 * Lecteurs externes disponibles (P5-20) : ceux que décrivent les plugins actifs (mpv, VLC…). Sans eux (plugin
 * désactivé), le bouton « Lecteur externe » disparaît et les formats non lus ne sont plus confiés à un autre lecteur.
 * Le programme et ses arguments restent dans le processus principal : l'interface ne connaît que la liste.
 */
import type { ExternalPlayerInfo } from '@mire/shared/ipc';
import { api } from '../api/index.ts';

let players: ExternalPlayerInfo[] = [];
const listeners = new Set<() => void>();

/** Un lecteur externe est-il disponible ? */
export const hasExternalPlayer = (): boolean => players.length > 0;

/** Appelé quand la liste change (plugin activé ou désactivé). */
export function onExternalPlayersChange(listener: () => void): void {
  listeners.add(listener);
}

async function refresh(): Promise<void> {
  try {
    const r = await api.externalPlayers();
    players = Array.isArray(r) ? r : [];
  } catch {
    players = [];
  }
  for (const l of listeners) l();
}

/** Lit la liste, puis la relit à chaque changement. */
export function initExternalPlayers(): Promise<void> {
  api.onExternalPlayersChange(() => void refresh());
  return refresh();
}
