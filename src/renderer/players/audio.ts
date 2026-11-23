/** Musique : file de lecture et mini-lecteur en bas de l'écran (`mire-mini-player`, P4-15). Règles sans DOM : `music-model.ts`. */
import { $, $$ } from '../core/dom.ts';
import { fmtTime } from '../core/format.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { i18n, t } from '../i18n/index.ts';
import { Q, S } from '../state/index.ts';
import { api } from '../api/index.ts';
import { cleanTrack, folderText } from '../domain/index.ts';
import type { MediaItem } from '@mire/shared/ipc';
import type { Playable } from './types.ts';
import { hasExternalPlayer } from './external.ts';
import type { Controllers } from '../controllers/index.ts';
import type { MusicUi } from '../controllers/types.ts';
import { focusFirst } from '../nav/focus.ts';
import { audio, setVolume } from './volume.ts';
import { stepInQueue, trackSubheading } from './music-model.ts';
import { playedRatio } from './video-model.ts';

export { audio };

/** Contrôleurs appelés par le lecteur de musique : lecteur externe (formats non lus ici), « Reprendre ». */
export type AudioControllers = Pick<Controllers, 'player' | 'home'>;

/** Propriétés de `mire-mini-player` (voir le composant). */
type MiniEl = HTMLElement & {
  heading: string;
  subheading: string;
  cover: string;
  current: string;
  duration: string;
  position: number;
  playing: boolean;
  labels: string;
  icons: string;
};

let ctrl: AudioControllers;
const viewEl = $('#view') as HTMLElement;
const mini = $('mire-mini-player') as MiniEl;
let seeking = false;

const current = () => Q.list[Q.i] as Playable | undefined;

function labels(): string {
  const k = (key: string) => t(`player.music.${key}`);
  return JSON.stringify({ prev: k('prev'), play: k('play'), next: k('next'), seek: k('seek'), volume: k('volume'), stop: k('stop') });
}

/** Sous-titre du mini-lecteur, rédigé dans la langue de l'interface. */
function showSubheading(): void {
  const tr = current();
  if (tr) mini.subheading = trackSubheading(folderText(tr) as string, Q.i, Q.list.length, t);
}

export function playQueue(list: MediaItem[], i: number): void {
  Q.list = list;
  Q.i = i;
  loadTrack();
}

function loadTrack(): void {
  const tr = current();
  if (!tr) return;
  if (!tr.native) {
    ctrl.player.openExternal({ path: tr.path, name: tr.name });
    return;
  }
  audio.src = mediaUrl(tr.path);
  audio.play().catch(() => {
    /* lecture bloquée */
  });
  ctrl.home.addRecent(tr);

  mini.hidden = false;
  document.body.classList.add('has-mini');
  mini.heading = cleanTrack(tr.name);
  showSubheading();
  const coverPath = (tr.cover || S.scrape[`a:${tr.dir}`]?.image) as string | undefined;
  mini.cover = coverPath ? mediaUrl(coverPath) : '';
  markPlaying();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cleanTrack(tr.name), album: tr.folder });
}

/** Morceau suivant (1) ou précédent (-1) ; « précédent » après 3 s revient au début du morceau. */
export function stepTrack(d: number): void {
  const step = stepInQueue(Q.i, Q.list.length, d, audio.currentTime);
  if (!step) return;
  if (step.kind === 'play') {
    Q.i = step.index;
    loadTrack();
    return;
  }
  if (step.kind === 'stop') audio.pause();
  audio.currentTime = 0;
}

export function toggleAudio(): void {
  if (!audio.getAttribute('src')) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function stopMusic(): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  Q.list = [];
  Q.i = -1;
  mini.hidden = true;
  document.body.classList.remove('has-mini');
  markPlaying();
  if (document.activeElement === document.body || mini.contains(document.activeElement)) focusFirst();
}

/** Signale le morceau en cours dans la liste de la section Musique. */
export function markPlaying(): void {
  if (S.section !== 'music') return;
  const cur = current()?.path;
  for (const el of $$('.track', viewEl)) el.classList.toggle('is-playing', !!cur && (S.list[Number(el.dataset.index)] as Playable | undefined)?.path === cur);
}

/** Commandes du mini-lecteur, appelées par son contrôleur (`mire-mini-player`). */
export const musicUi: MusicUi = { togglePlay: toggleAudio, step: stepTrack, stop: stopMusic };

/** Branche le mini-lecteur : événements de l'élément audio, réglettes, textes et icônes. */
export function initAudio(controllers: AudioControllers): void {
  ctrl = controllers;
  mini.icons = JSON.stringify(ICON);
  mini.labels = labels();
  i18n.onChange(() => {
    mini.labels = labels();
    showSubheading();
  });
  audio.addEventListener('ended', () => stepTrack(1));
  audio.addEventListener('play', () => (mini.playing = true));
  audio.addEventListener('pause', () => (mini.playing = false));
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    mini.position = playedRatio(audio.currentTime, audio.duration);
    mini.current = fmtTime(audio.currentTime);
    mini.duration = fmtTime(audio.duration);
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    const tr = current();
    if (!tr) return;
    if (!hasExternalPlayer()) {
      toast(t('player.music.unsupportedNoExternal', { name: tr.name }), { duration: 5000 });
      return;
    }
    toast(t('player.music.unsupported', { name: tr.name }), { duration: 5000 });
    api.playExternal(tr.path, tr.name, 0);
  });
  mini.addEventListener('mireMusicSeek', (e) => {
    const { ratio, commit } = (e as CustomEvent<{ ratio: number; commit: boolean }>).detail;
    if (!commit) {
      seeking = true;
      mini.current = fmtTime(ratio * (audio.duration || 0));
      return;
    }
    if (Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
    seeking = false;
  });
  mini.addEventListener('mireMusicVolume', (e) => setVolume((e as CustomEvent<{ value: number }>).detail.value));
}
