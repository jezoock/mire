/** Musique : file de lecture et mini-lecteur en bas de l'écran. */
import { $, $$ } from '../core/dom.ts';
import { fmtTime } from '../core/format.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { Q, S } from '../state/index.ts';
import { api } from '../api/index.ts';
import { cleanTrack, folderText } from '../domain/index.ts';
import type { MediaItem } from '@mire/shared/ipc';
import type { Playable } from './types.ts';
import { focusFirst } from '../nav/spatial.ts';
import { audio, setRangeFill, setVolume } from './volume.ts';

export { audio };

/** Ce que l'interface fournit au lecteur de musique. */
export interface AudioHooks {
  /** Ouvre le morceau dans le lecteur externe (formats non lus par le lecteur intégré). */
  openExternal(it: Playable): void;
  addRecent(it: Playable): void;
}

let hooks: AudioHooks;
const viewEl = $('#view') as HTMLElement;
const mini = $('#mini') as HTMLElement;
const miniPlay = $('#mini-play') as HTMLButtonElement;
const miniRange = $('#mini-range') as HTMLInputElement;
let miniSeeking = false;

export function playQueue(list: MediaItem[], i: number): void {
  Q.list = list;
  Q.i = i;
  loadTrack();
}

function loadTrack(): void {
  const t = Q.list[Q.i] as Playable | undefined;
  if (!t) return;
  if (!t.native) {
    hooks.openExternal(t);
    return;
  }
  audio.src = mediaUrl(t.path);
  audio.play().catch(() => {
    /* lecture bloquée */
  });
  hooks.addRecent(t);

  mini.hidden = false;
  document.body.classList.add('has-mini');
  ($('#mini-title') as HTMLElement).textContent = cleanTrack(t.name);
  ($('#mini-sub') as HTMLElement).textContent = (Q.list.length > 1 ? `${folderText(t)}, ${Q.i + 1} sur ${Q.list.length}` : folderText(t)) as string;
  const cover = $('#mini-cover') as HTMLImageElement;
  const coverPath = (t.cover || S.scrape[`a:${t.dir}`]?.image) as string | undefined;
  if (coverPath) {
    cover.hidden = false;
    cover.src = mediaUrl(coverPath);
  } else {
    cover.hidden = true;
    cover.removeAttribute('src');
  }
  markPlaying();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cleanTrack(t.name), album: t.folder });
}

/** Morceau suivant (1) ou précédent (-1) ; « précédent » après 3 s revient au début du morceau. */
export function stepTrack(d: number): void {
  if (!Q.list.length) return;
  if (d < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const j = Q.i + d;
  if (j < 0) {
    audio.currentTime = 0;
    return;
  }
  if (j >= Q.list.length) {
    audio.pause();
    audio.currentTime = 0;
    return;
  }
  Q.i = j;
  loadTrack();
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
  const cur = Q.list[Q.i]?.path;
  for (const el of $$('.track', viewEl)) el.classList.toggle('is-playing', !!cur && (S.list[Number(el.dataset.index)] as Playable | undefined)?.path === cur);
}

/** Branche le mini-lecteur. */
export function initAudio(h: AudioHooks): void {
  hooks = h;
  audio.addEventListener('ended', () => stepTrack(1));
  audio.addEventListener('play', () => {
    miniPlay.innerHTML = ICON.pause;
  });
  audio.addEventListener('pause', () => {
    miniPlay.innerHTML = ICON.play;
  });
  audio.addEventListener('timeupdate', () => {
    if (miniSeeking) return;
    const d = audio.duration;
    const r = Number.isFinite(d) && d > 0 ? audio.currentTime / d : 0;
    miniRange.value = String(Math.round(r * 1000));
    setRangeFill(miniRange, r);
    ($('#mini-cur') as HTMLElement).textContent = fmtTime(audio.currentTime);
    ($('#mini-dur') as HTMLElement).textContent = fmtTime(d);
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    const t = Q.list[Q.i] as Playable | undefined;
    if (!t) return;
    toast(`${t.name} : format non lu par le lecteur intégré, ouverture dans le lecteur externe`, { duration: 5000 });
    api.playExternal(t.path, t.name, 0);
  });

  miniPlay.addEventListener('click', toggleAudio);
  ($('#mini-prev') as HTMLElement).addEventListener('click', () => stepTrack(-1));
  ($('#mini-next') as HTMLElement).addEventListener('click', () => stepTrack(1));
  ($('#mini-close') as HTMLElement).addEventListener('click', stopMusic);
  miniRange.addEventListener('input', () => {
    miniSeeking = true;
    const r = Number(miniRange.value) / 1000;
    setRangeFill(miniRange, r);
    ($('#mini-cur') as HTMLElement).textContent = fmtTime(r * (audio.duration || 0));
  });
  miniRange.addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(miniRange.value) / 1000) * audio.duration;
    miniSeeking = false;
  });
  ($('#mini-vol') as HTMLInputElement).addEventListener('input', (e) => setVolume(Number((e.target as HTMLInputElement).value)));
}
