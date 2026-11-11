/** Téléchargements : états et ligne de détail. */
import { fmtBytes, fmtEta, plural } from '../core/format.ts';
import type { Item } from './types.ts';

/** États d'un téléchargement en cours (pas en pause, ni terminé). */
export const DL_ACTIVE: ReadonlySet<unknown> = new Set(['waiting', 'downloading', 'extracting']);

/** Libellé de chaque état. */
export const DL_STATE: Record<string, string> = {
  pending: 'En attente de téléchargement',
  waiting: 'En attente',
  downloading: 'En cours',
  paused: 'En pause',
  extracting: 'Décompression',
  done: 'Terminé',
  error: 'Erreur',
  cancelled: 'Annulé',
  interrupted: 'Interrompu',
  external: 'Confié au logiciel de torrent',
};

/** Ligne de détail d'un téléchargement : « En cours · 1,5 Mo sur 3 Mo · 200 Ko/s · reste 2 min · vers … ». */
export function dlMeta(d: Item): string {
  const state = d.state as string;
  const total = d.total as number;
  const received = d.received as number;
  const parts = [DL_STATE[state] || state];
  if (total) parts.push(state === 'done' ? fmtBytes(total) : `${fmtBytes(received || 0)} sur ${fmtBytes(total)}`);
  else if (received) parts.push(fmtBytes(received));
  if (state === 'downloading' && d.speed) parts.push(`${fmtBytes(d.speed as number)}/s`);
  if (d.kind === 'torrent' && DL_ACTIVE.has(state)) parts.push(plural((d.peers as number) || 0, 'pair', 'pairs'));
  if (state === 'downloading' && d.eta) parts.push(`reste ${fmtEta(d.eta as number)}`);
  parts.push(d.consoleName ? `vers ${d.consoleName}` : d.dir ? 'vers Téléchargements' : '');
  if (d.group) parts.push(`fait partie de « ${d.group} »`);
  if (d.companions) parts.push(`${plural(d.companions as number, 'fichier du jeu ajouté', 'fichiers du jeu ajoutés')}`);
  if (d.extracted) parts.push('archive décompressée');
  return parts.filter(Boolean).join(' · ');
}
