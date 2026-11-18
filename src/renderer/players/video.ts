/**
 * Lecteur vidéo plein écran (P4-14) : pilote `mire-video-player` (la vidéo, l'affichage par-dessus, les réglettes),
 * les sous-titres, la reprise de lecture, le son absent et les touches. Les règles sans DOM sont dans `video-model.ts`.
 */
import { $, $$ } from '../core/dom.ts';
import { clamp, fmtTime } from '../core/format.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { i18n, t } from '../i18n/index.ts';
import { S, V } from '../state/index.ts';
import { api } from '../api/index.ts';
import { folderText } from '../domain/index.ts';
import { VIDEO_KEYS, keyAction } from '../nav/keyboard.ts';
import { rememberFocus, restoreFocus } from '../nav/focus.ts';
import { audio, getVolume, setVolume, video } from './volume.ts';
import {
  SILENCE_CHECK_DELAY,
  defaultSubtitle,
  isSilent,
  keepsResume,
  nextSubtitle,
  playedRatio,
  resumeAt,
  seekOsd,
  subtitleLabel,
  subtitleOsd,
  timeText,
  videoHeading,
  videoSubheading,
} from './video-model.ts';
import type { SubtitleInfo } from './video-model.ts';
import type { Playable } from './types.ts';
import type { Controllers } from '../controllers/index.ts';
import type { VideoUi } from '../controllers/types.ts';

export { video };

/**
 * Contrôleurs appelés par le lecteur vidéo : lecteur externe, marques-pages de sites rangés parmi les vidéos,
 * « Reprendre », vue web (montrée ou cachée selon ce qui recouvre l'écran), vue à remettre à jour en sortant.
 */
export type VideoControllers = Pick<Controllers, 'player' | 'home' | 'web'>;

/** Propriétés de `mire-video-player` (voir le composant). */
type PlayerEl = HTMLElement & {
  heading: string;
  subheading: string;
  time: string;
  position: number;
  playing: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  subtitles: string;
  osd: string;
  osdShown: boolean;
  idle: boolean;
  labels: string;
  icons: string;
};

let ctrl: VideoControllers;
const player = $('mire-video-player') as PlayerEl;

export const isVideoOpen = (): boolean => !player.hidden;

const current = () => V.list[V.i] as Playable | undefined;

function labels(): string {
  const k = (key: string) => t(`player.video.${key}`);
  return JSON.stringify({
    close: k('close'),
    external: k('external'),
    seek: k('seek'),
    prev: k('prev'),
    next: k('next'),
    play: k('play'),
    volume: k('volume'),
    fullscreen: k('fullscreen'),
  });
}

/** En-tête et bouton des sous-titres, rédigés dans la langue de l'interface. */
function showHeading(): void {
  const it = current();
  if (!it) return;
  player.heading = videoHeading(it);
  player.subheading = videoSubheading(folderText(it) as string, V.i, V.list.length, t);
  player.subtitles = V.subLabels.length ? subtitleLabel(V.subLabels, V.subIndex, t) : '';
}

function showTime(): void {
  const d = video.duration;
  if (!V.seeking) player.position = playedRatio(video.currentTime, d);
  player.time = timeText(video.currentTime, d);
}

// Remonte les sous-titres quand les commandes sont affichées, pour qu'ils ne passent pas dessous.
function liftCues(up: boolean): void {
  if (V.cuesUp === up) return;
  V.cuesUp = up;
  for (const tr of video.textTracks) {
    if (!tr.cues) continue;
    for (const c of tr.cues) (c as VTTCue).line = up ? -5 : 'auto';
  }
}

let osdTimer = 0;
function osd(text: string): void {
  player.osd = text;
  player.osdShown = true;
  clearTimeout(osdTimer);
  osdTimer = window.setTimeout(() => (player.osdShown = false), 900);
}

function wakeVideo(): void {
  player.idle = false;
  liftCues(true);
  clearTimeout(V.hideTimer);
  V.hideTimer = window.setTimeout(() => {
    if (!video.paused) {
      player.idle = true;
      liftCues(false);
    }
  }, 3000);
}

function clearSubtitleTracks(): void {
  for (const tr of $$('track', video)) tr.remove();
  for (const u of V.blobs) URL.revokeObjectURL(u);
  V.blobs = [];
  V.subLabels = [];
  V.subIndex = -1;
  V.cuesUp = null;
  player.subtitles = '';
}

function setSubtitle(k: number): void {
  V.subIndex = k;
  [...video.textTracks].forEach((tr, j) => {
    tr.mode = j === k ? 'showing' : 'disabled';
  });
  player.subtitles = subtitleLabel(V.subLabels, k, t);
}

function cycleSubtitles(): void {
  if (!V.subLabels.length) return;
  const k = nextSubtitle(V.subIndex, V.subLabels.length);
  setSubtitle(k);
  osd(subtitleOsd(V.subLabels, k, t));
}

interface Subtitle extends SubtitleInfo {
  vtt: string;
}

async function loadSubtitles(it: Playable): Promise<void> {
  const subs = (await api.subtitles(it.path)) as unknown;
  if (current() !== it || !Array.isArray(subs) || !subs.length) return;
  for (const s of subs as Subtitle[]) {
    const url = URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' }));
    V.blobs.push(url);
    V.subLabels.push(s.label);
    const tr = document.createElement('track');
    tr.kind = 'subtitles';
    tr.label = s.label;
    if (s.lang) tr.srclang = s.lang;
    tr.src = url;
    tr.addEventListener('load', () => {
      const up = V.cuesUp;
      V.cuesUp = null;
      liftCues(!!up);
    });
    video.appendChild(tr);
  }
  // Français activé d'office s'il existe.
  setSubtitle(defaultSubtitle(subs as Subtitle[]));
}

// Le processus principal garde ou efface la position (règles dans src/main/usage) et groupe les écritures.
function saveResume(it: Playable | undefined): void {
  const d = video.duration;
  if (!it || !keepsResume(d)) return;
  api.usageSaveResume(it.path, video.currentTime, d);
}

function openCurrentExternally(): void {
  const it = current();
  if (!it) return;
  const start = video.currentTime;
  closeVideo();
  ctrl.player.openExternal({ path: it.path, name: it.name, start });
}

function checkSilence(): void {
  if (player.hidden || video.paused) return;
  const decoded = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
  if (isSilent(decoded, video.currentTime)) {
    toast(t('player.video.silent.message'), {
      action: t('player.video.silent.action'),
      onAction: openCurrentExternally,
      duration: 10000,
    });
  }
}

/** Reprend la vidéo où elle avait été laissée, une fois sa durée connue. */
function resumeWhenReady(it: Playable): void {
  const saved = api.usageResume(it.path);
  video.addEventListener(
    'loadedmetadata',
    async () => {
      const at = resumeAt(await saved, video.duration);
      if (current() !== it || at === null) return;
      video.currentTime = at;
      toast(t('player.video.resume.at', { time: fmtTime(at) }), {
        action: t('player.video.resume.restart'),
        onAction: () => {
          video.currentTime = 0;
        },
      });
    },
    { once: true },
  );
}

export function openVideo(list: Playable[], i: number): void {
  const it = list[i];
  if (!it) return;
  if (it.bookmark) {
    ctrl.web.openBookmark({ id: it.bookmarkId as string });
    return;
  }
  if (!it.native) {
    ctrl.player.openExternal({ path: it.path, name: it.name });
    return;
  }
  if (player.hidden) V.returnFocus = rememberFocus();
  else saveResume(current());

  V.list = list;
  V.i = i;
  audio.pause();
  clearSubtitleTracks();
  player.hidden = false;
  ctrl.web.sync();
  showHeading();
  player.hasPrev = i > 0;
  player.hasNext = i < list.length - 1;
  player.position = 0;
  player.time = timeText(0, NaN);

  video.src = mediaUrl(it.path);
  resumeWhenReady(it);
  video.play().catch(() => {});
  ctrl.home.addRecent(it);
  loadSubtitles(it);
  clearTimeout(V.silentTimer);
  V.silentTimer = window.setTimeout(checkSilence, SILENCE_CHECK_DELAY);
  player.focus();
  wakeVideo();
}

export function closeVideo(): void {
  if (player.hidden) return;
  saveResume(current());
  video.pause();
  video.removeAttribute('src');
  video.load();
  clearSubtitleTracks();
  clearTimeout(V.silentTimer);
  clearTimeout(V.hideTimer);
  player.hidden = true;
  player.idle = false;
  V.list = [];
  V.i = -1;
  ctrl.web.sync();
  if (S.section === 'home') ctrl.player.refreshView();
  restoreFocus(V.returnFocus);
}

/** Vidéo suivante (1) ou précédente (-1) de la liste, s'il y en a une. */
export function stepVideo(d: number): void {
  const j = V.i + d;
  if (j >= 0 && j < V.list.length) openVideo(V.list as Playable[], j);
}

function togglePlay(): void {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
  osd(t(video.paused ? 'player.video.osd.pause' : 'player.video.osd.play'));
}

function seekBy(s: number): void {
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = clamp(video.currentTime + s, 0, video.duration - 0.5);
  showTime();
  osd(seekOsd(s, video.currentTime, t));
}

function nudgeVolume(d: number): void {
  const v = setVolume(getVolume() + d);
  if (!player.hidden) osd(t('player.video.osd.volume', { percent: Math.round(v * 100) }));
}

/** Après une commande à la souris, le focus revient au lecteur (les flèches avancent, Entrée met en pause). */
function refocus(): void {
  if (!player.hidden) player.focus();
}

/** Commandes du lecteur, appelées par son contrôleur (`mire-video-player`). */
export const videoUi: VideoUi = {
  close: closeVideo,
  togglePlay() {
    togglePlay();
    refocus();
  },
  step(d) {
    stepVideo(d);
    refocus();
  },
  cycleSubtitles() {
    cycleSubtitles();
    refocus();
  },
  openExternally: openCurrentExternally,
};

/** Touche pendant la lecture (du clavier, ou traduite depuis la manette) ; `true` si elle a été utilisée. */
export function videoKey(key: string, fromPad: boolean): boolean {
  wakeVideo();
  const a = document.activeElement;
  // Entrée et Espace gardent leur effet sur le bouton des commandes qui a le focus.
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== player && player.contains(a) && a.matches('button')) return false;
  switch (keyAction(VIDEO_KEYS, key)) {
    case 'play':
      togglePlay();
      return true;
    case 'rewind':
      seekBy(-10);
      return true;
    case 'forward':
      seekBy(10);
      return true;
    case 'rewind-long':
      seekBy(-60);
      return true;
    case 'forward-long':
      seekBy(60);
      return true;
    case 'volume-up':
      nudgeVolume(0.05);
      return true;
    case 'volume-down':
      nudgeVolume(-0.05);
      return true;
    case 'mute':
      video.muted = !video.muted;
      osd(t(video.muted ? 'player.video.osd.muted' : 'player.video.osd.unmuted'));
      return true;
    case 'fullscreen':
      api.toggleFullscreen();
      return true;
    case 'subtitles':
      cycleSubtitles();
      return true;
    case 'next':
      stepVideo(1);
      return true;
    case 'prev':
      stepVideo(-1);
      return true;
    case 'close':
      closeVideo();
      return true;
    default:
      return false;
  }
}

/** Format que le lecteur intégré ne lit pas : la vidéo passe au lecteur externe. */
function onVideoError(): void {
  if (player.hidden || !video.getAttribute('src')) return;
  const it = current() as Playable;
  closeVideo();
  toast(t('player.video.unsupported', { name: it.name }), { duration: 5000 });
  api.playExternal(it.path, it.name, 0).then((r) => {
    if (!r.ok) toast(r.error as string, { duration: 7000 });
  });
}

/** Branche le lecteur : événements de la vidéo, réglettes, textes et icônes. */
export function initVideo(controllers: VideoControllers): void {
  ctrl = controllers;
  player.icons = JSON.stringify(ICON);
  player.labels = labels();
  i18n.onChange(() => {
    player.labels = labels();
    showHeading();
  });
  video.addEventListener('play', () => {
    player.playing = true;
    wakeVideo();
  });
  video.addEventListener('pause', () => {
    player.playing = false;
    wakeVideo();
  });
  video.addEventListener('timeupdate', () => {
    showTime();
    if (Date.now() - V.lastSave > 5000) {
      V.lastSave = Date.now();
      saveResume(current());
    }
  });
  video.addEventListener('ended', () => {
    const it = current();
    if (it) api.usageClearResume(it.path);
    if (V.i < V.list.length - 1) openVideo(V.list as Playable[], V.i + 1);
    else closeVideo();
  });
  video.addEventListener('error', onVideoError);
  video.addEventListener('click', togglePlay);
  video.addEventListener('dblclick', () => api.toggleFullscreen());

  player.addEventListener('mireVideoSeek', (e) => {
    const { ratio, commit } = (e as CustomEvent<{ ratio: number; commit: boolean }>).detail;
    const d = video.duration;
    if (!commit) {
      V.seeking = true;
      player.time = timeText(ratio * (d || 0), d);
      return;
    }
    if (Number.isFinite(d)) video.currentTime = ratio * d;
    V.seeking = false;
    showTime();
    refocus();
  });
  player.addEventListener('mireVideoVolume', (e) => {
    const { value, commit } = (e as CustomEvent<{ value: number; commit: boolean }>).detail;
    setVolume(value);
    if (commit) refocus();
  });
  player.addEventListener('mousemove', wakeVideo);
}
