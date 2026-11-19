/**
 * Volume partagé par la musique et le lecteur vidéo : un seul réglage, enregistré dans les données d'usage.
 * Les deux éléments de lecture sont déclarés ici, puisque le volume s'applique aux deux.
 */
import { $ } from '../core/dom.ts';
import { clamp } from '../core/format.ts';
import { S } from '../state/index.ts';
import { api } from '../api/index.ts';

export const audio = new Audio();
audio.preload = 'auto';
// La vidéo est celle du lecteur (`mire-video-player`, P4-14), rendu par la coquille avant le démarrage de l'interface.
const player = $('mire-video-player') as HTMLElement & { volume: number };
export const video = player.querySelector('video') as HTMLVideoElement;
// Le mini-lecteur de musique (`mire-mini-player`, P4-15) montre le même volume.
const miniPlayer = $('mire-mini-player') as HTMLElement & { volume: number };
let volume = 0.9;

export const getVolume = (): number => volume;

/** Règle le volume (arrondi au centième, entre 0 et 1) sur les deux lecteurs et leurs réglettes ; renvoie la valeur retenue. */
export function setVolume(v: number): number {
  volume = clamp(Math.round(v * 100) / 100, 0, 1);
  audio.volume = volume;
  video.volume = volume;
  player.volume = volume;
  miniPlayer.volume = volume;
  if (volume !== S.usage.volume) {
    S.usage.volume = volume;
    api.usageSetVolume(volume);
  }
  return volume;
}
