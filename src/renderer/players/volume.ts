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
export const video = $('#video') as HTMLVideoElement;
let volume = 0.9;

export const getVolume = (): number => volume;

/** Remplissage d'une réglette (`--p`) selon la proportion donnée. */
export function setRangeFill(el: HTMLElement, ratio: number): void {
  el.style.setProperty('--p', `${clamp(ratio, 0, 1) * 100}%`);
}

/** Règle le volume (arrondi au centième, entre 0 et 1) sur les deux lecteurs et leurs réglettes ; renvoie la valeur retenue. */
export function setVolume(v: number): number {
  volume = clamp(Math.round(v * 100) / 100, 0, 1);
  audio.volume = volume;
  video.volume = volume;
  for (const el of [$<HTMLInputElement>('#mini-vol'), $<HTMLInputElement>('#vp-vol')] as HTMLInputElement[]) {
    el.value = String(volume);
    setRangeFill(el, volume);
  }
  if (volume !== S.usage.volume) {
    S.usage.volume = volume;
    api.usageSetVolume(volume);
  }
  return volume;
}
