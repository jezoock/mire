/**
 * Lecteur vidéo, sans DOM (P4-14) : reprise de lecture, choix et suite des sous-titres, son absent, textes de
 * l'affichage sur la vidéo. Testé tel quel ; `video.ts` s'en sert pour piloter `mire-video-player`.
 */
import { fmtTime } from '../core/format.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Une vidéo plus courte (en secondes) ne garde pas sa position. */
export const RESUME_MIN_DURATION = 300;
/** On ne reprend pas au tout début (avant 30 s) ni dans les 90 dernières secondes. */
export const RESUME_MIN_POSITION = 30;
export const RESUME_END_MARGIN = 90;
/** Le son est vérifié après 7 s de lecture, s'il a joué plus de 2 s. */
export const SILENCE_CHECK_DELAY = 7000;
export const SILENCE_MIN_TIME = 2;

/** Vrai si la position de cette vidéo est à garder (sa durée est connue et assez longue). */
export function keepsResume(duration: number): boolean {
  return Number.isFinite(duration) && duration >= RESUME_MIN_DURATION;
}

/** Position où reprendre une vidéo de cette durée, d'après la position gardée ; `null` : depuis le début. */
export function resumeAt(saved: unknown, duration: number): number | null {
  const s = Number(saved) || 0;
  return s > RESUME_MIN_POSITION && s < duration - RESUME_END_MARGIN ? s : null;
}

export interface SubtitleInfo {
  label: string;
  lang?: string;
}

/** Sous-titres activés d'office : les premiers en français, s'il y en a ; sinon aucun (-1). */
export function defaultSubtitle(subs: readonly SubtitleInfo[]): number {
  return subs.findIndex((s) => ['fr', 'fre', 'fra'].includes(s.lang as string) || /fr|fran/i.test(s.label));
}

/** Sous-titres suivants : chacun à son tour, puis aucun (-1), puis le premier. */
export function nextSubtitle(current: number, count: number): number {
  if (!count) return -1;
  return current + 1 >= count ? -1 : current + 1;
}

/**
 * Vrai si la vidéo joue sans son : aucun octet de son décodé alors qu'elle joue depuis plus de 2 s. `decoded` est
 * `webkitAudioDecodedByteCount` (absent hors de Chromium : on ne conclut rien).
 */
export function isSilent(decoded: unknown, currentTime: number): boolean {
  return typeof decoded === 'number' && decoded === 0 && currentTime > SILENCE_MIN_TIME;
}

/** Ce que le lecteur sait d'une vidéo pour son titre. */
export interface VideoTitleInfo {
  name: string;
  sTitle?: string;
  sYear?: string | number;
}

/** Titre de la vidéo : celui de sa fiche (avec l'année), sinon le nom du fichier. */
export function videoHeading(it: VideoTitleInfo): string {
  return it.sTitle ? `${it.sTitle}${it.sYear ? ` (${it.sYear})` : ''}` : it.name;
}

/** Sous-titre de l'en-tête : le dossier, et la place dans la liste quand elle en a plusieurs. */
export function videoSubheading(folder: string, index: number, count: number, t: Translate): string {
  return count > 1 ? t('player.video.position', { folder, index: index + 1, count }) : folder;
}

/** Libellé du bouton des sous-titres. */
export function subtitleLabel(labels: readonly string[], index: number, t: Translate): string {
  return index >= 0 ? t('player.video.subtitles.on', { label: labels[index] as string }) : t('player.video.subtitles.off');
}

/** Message affiché sur la vidéo après un changement de sous-titres. */
export function subtitleOsd(labels: readonly string[], index: number, t: Translate): string {
  return index >= 0 ? t('player.video.subtitles.on', { label: labels[index] as string }) : t('player.video.osd.subtitlesOff');
}

/** Message affiché sur la vidéo après un saut (secondes, en avant ou en arrière), avec la nouvelle position. */
export function seekOsd(step: number, time: number, t: Translate): string {
  return t(step > 0 ? 'player.video.osd.forward' : 'player.video.osd.back', { seconds: Math.abs(step), time: fmtTime(time) });
}

/** Position affichée : « 1:23 / 45:00 ». */
export function timeText(current: number, duration: number): string {
  return `${fmtTime(current)} / ${fmtTime(duration)}`;
}

/** Proportion lue (0 à 1) ; 0 tant que la durée n'est pas connue. */
export function playedRatio(current: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
}
