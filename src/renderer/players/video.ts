/** Lecteur vidéo plein écran : commandes, sous-titres, reprise de lecture, touches. */
import { $, $$ } from '../core/dom.ts';
import { clamp, fmtTime } from '../core/format.ts';
import { ICON } from '../core/icons.ts';
import { mediaUrl } from '../core/media.ts';
import { toast } from '../ui/toast.ts';
import { S, V } from '../state/index.ts';
import { api } from '../api/index.ts';
import { folderText } from '../domain/index.ts';
import { VIDEO_KEYS, keyAction } from '../nav/keyboard.ts';
import { focusFirst, focusSelectorOf } from '../nav/spatial.ts';
import { audio, getVolume, setRangeFill, setVolume, video } from './volume.ts';
import type { Playable } from './types.ts';

export { video };

/** Ce que l'interface fournit au lecteur vidéo. */
export interface VideoHooks {
  /** Ouvre la vidéo dans le lecteur externe, à la position donnée (s). */
  openExternal(it: Playable, start?: number): void;
  /** Ouvre un marque-page de site rangé parmi les vidéos. */
  openBookmark(id: string): void;
  addRecent(it: Playable): void;
  /** Affiche ou masque la vue web selon ce qui recouvre l'écran. */
  syncWeb(): void;
  /** Affiche de nouveau la section en cours. */
  render(): void;
}

let hooks: VideoHooks;
const viewEl = $('#view') as HTMLElement;
const videoLayer = $('#video-layer') as HTMLElement;
const vpPlay = $('#vp-play') as HTMLButtonElement;
const vpSeek = $('#vp-seek') as HTMLInputElement;
const vpSubs = $('#vp-subs') as HTMLElement;

export const isVideoOpen = (): boolean => !videoLayer.hidden;

// Remonte les sous-titres quand les commandes sont affichées, pour qu'ils ne passent pas dessous.
function liftCues(up: boolean): void {
  if (V.cuesUp === up) return;
  V.cuesUp = up;
  for (const t of video.textTracks) {
    if (!t.cues) continue;
    for (const c of t.cues) (c as VTTCue).line = up ? -5 : 'auto';
  }
}

let osdTimer = 0;
function osd(text: string): void {
  const el = $('#vp-osd') as HTMLElement;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = window.setTimeout(() => el.classList.remove('show'), 900);
}

function wakeVideo(): void {
  videoLayer.classList.remove('idle');
  liftCues(true);
  clearTimeout(V.hideTimer);
  V.hideTimer = window.setTimeout(() => {
    if (!video.paused) {
      videoLayer.classList.add('idle');
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
  vpSubs.hidden = true;
}

function setSubtitle(k: number): void {
  V.subIndex = k;
  [...video.textTracks].forEach((t, j) => {
    t.mode = j === k ? 'showing' : 'disabled';
  });
  ($('#vp-subs-lbl') as HTMLElement).textContent = k >= 0 ? `Sous-titres : ${V.subLabels[k]}` : 'Sous-titres : non';
}

function cycleSubtitles(): void {
  if (!V.subLabels.length) return;
  const k = V.subIndex + 1 >= V.subLabels.length ? -1 : V.subIndex + 1;
  setSubtitle(k);
  osd(k >= 0 ? `Sous-titres : ${V.subLabels[k]}` : 'Sous-titres désactivés');
}

interface Subtitle {
  vtt: string;
  label: string;
  lang?: string;
}

async function loadSubtitles(it: Playable): Promise<void> {
  const subs = (await api.subtitles(it.path)) as unknown;
  if (V.list[V.i] !== it || !Array.isArray(subs) || !subs.length) return;
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
  vpSubs.hidden = false;
  // Français activé d'office s'il existe.
  const fr = (subs as Subtitle[]).findIndex((s) => ['fr', 'fre', 'fra'].includes(s.lang as string) || /fr|fran/i.test(s.label));
  setSubtitle(fr);
}

// Le processus principal garde ou efface la position (règles dans src/main/usage) et groupe les écritures.
function saveResume(it: Playable | undefined): void {
  const d = video.duration;
  if (!it || !Number.isFinite(d) || d < 300) return;
  api.usageSaveResume(it.path, video.currentTime, d);
}

const current = () => V.list[V.i] as Playable | undefined;

function openCurrentExternally(): void {
  const it = current() as Playable;
  const t = video.currentTime;
  closeVideo();
  hooks.openExternal(it, t);
}

function checkSilence(): void {
  if (videoLayer.hidden || video.paused) return;
  const decoded = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
  if (typeof decoded === 'number' && decoded === 0 && video.currentTime > 2) {
    toast('Pas de son ? La piste audio de ce fichier n’est sans doute pas lisible ici.', {
      action: 'Ouvrir dans le lecteur externe',
      onAction: openCurrentExternally,
      duration: 10000,
    });
  }
}

export function openVideo(list: Playable[], i: number): void {
  const it = list[i];
  if (!it) return;
  if (it.bookmark) {
    hooks.openBookmark(it.bookmarkId as string);
    return;
  }
  if (!it.native) {
    hooks.openExternal(it);
    return;
  }
  if (videoLayer.hidden) V.returnSel = focusSelectorOf(document.activeElement);
  else saveResume(current());

  V.list = list;
  V.i = i;
  audio.pause();
  clearSubtitleTracks();
  videoLayer.hidden = false;
  hooks.syncWeb();
  ($('#vp-title') as HTMLElement).textContent = it.sTitle ? `${it.sTitle}${it.sYear ? ` (${it.sYear})` : ''}` : it.name;
  ($('#vp-sub') as HTMLElement).textContent = (list.length > 1 ? `${folderText(it)}, ${i + 1} sur ${list.length}` : folderText(it)) as string;
  ($('#vp-prev') as HTMLButtonElement).disabled = i <= 0;
  ($('#vp-next') as HTMLButtonElement).disabled = i >= list.length - 1;
  vpSeek.value = '0';
  setRangeFill(vpSeek, 0);

  const resume = api.usageResume(it.path);
  video.src = mediaUrl(it.path);
  video.addEventListener(
    'loadedmetadata',
    async () => {
      const saved = Number(await resume) || 0;
      if (V.list[V.i] !== it) return;
      if (saved > 30 && saved < video.duration - 90) {
        video.currentTime = saved;
        toast(`Reprise à ${fmtTime(saved)}`, {
          action: 'Reprendre au début',
          onAction: () => {
            video.currentTime = 0;
          },
        });
      }
    },
    { once: true },
  );
  video.play().catch(() => {});
  hooks.addRecent(it);
  loadSubtitles(it);
  clearTimeout(V.silentTimer);
  V.silentTimer = window.setTimeout(checkSilence, 7000);
  videoLayer.focus();
  wakeVideo();
}

export function closeVideo(): void {
  if (videoLayer.hidden) return;
  saveResume(current());
  video.pause();
  video.removeAttribute('src');
  video.load();
  clearSubtitleTracks();
  clearTimeout(V.silentTimer);
  clearTimeout(V.hideTimer);
  videoLayer.hidden = true;
  videoLayer.classList.remove('idle');
  V.list = [];
  V.i = -1;
  hooks.syncWeb();
  if (S.section === 'home') hooks.render();
  const back = V.returnSel && viewEl.querySelector<HTMLElement>(V.returnSel);
  if (back) back.focus();
  else focusFirst();
}

/** Vidéo suivante (1) ou précédente (-1) de la liste, s'il y en a une. */
export function stepVideo(d: number): void {
  const j = V.i + d;
  if (j >= 0 && j < V.list.length) openVideo(V.list as Playable[], j);
}

function togglePlay(): void {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
  osd(video.paused ? 'Pause' : 'Lecture');
}

function seekBy(s: number): void {
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = clamp(video.currentTime + s, 0, video.duration - 0.5);
  osd(`${s > 0 ? '+' : '−'}${Math.abs(s)} s  ${fmtTime(video.currentTime)}`);
}

function nudgeVolume(d: number): void {
  const v = setVolume(getVolume() + d);
  if (!videoLayer.hidden) osd(`Volume ${Math.round(v * 100)} %`);
}

/** Touche pendant la lecture (du clavier, ou traduite depuis la manette) ; `true` si elle a été utilisée. */
export function videoKey(key: string, fromPad: boolean): boolean {
  wakeVideo();
  const a = document.activeElement;
  // Entrée et Espace gardent leur effet sur le bouton des commandes qui a le focus.
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== videoLayer && videoLayer.contains(a) && a.matches('button')) return false;
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
      osd(video.muted ? 'Son coupé' : 'Son rétabli');
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

/** Branche les commandes du lecteur. */
export function initVideo(h: VideoHooks): void {
  hooks = h;
  video.addEventListener('play', () => {
    vpPlay.innerHTML = ICON.pause;
    wakeVideo();
  });
  video.addEventListener('pause', () => {
    vpPlay.innerHTML = ICON.play;
    wakeVideo();
  });
  video.addEventListener('timeupdate', () => {
    const d = video.duration;
    if (!V.seeking) {
      const r = Number.isFinite(d) && d > 0 ? video.currentTime / d : 0;
      vpSeek.value = String(Math.round(r * 1000));
      setRangeFill(vpSeek, r);
    }
    ($('#vp-time') as HTMLElement).textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
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
  video.addEventListener('error', () => {
    if (videoLayer.hidden || !video.getAttribute('src')) return;
    const it = current() as Playable;
    closeVideo();
    toast(`Format non lu par le lecteur intégré : ${it.name} s’ouvre dans le lecteur externe`, { duration: 5000 });
    api.playExternal(it.path, it.name, 0).then((r) => {
      if (!r.ok) toast(r.error as string, { duration: 7000 });
    });
  });
  video.addEventListener('click', togglePlay);
  video.addEventListener('dblclick', () => api.toggleFullscreen());

  vpSeek.addEventListener('input', () => {
    V.seeking = true;
    const r = Number(vpSeek.value) / 1000;
    setRangeFill(vpSeek, r);
    ($('#vp-time') as HTMLElement).textContent = `${fmtTime(r * (video.duration || 0))} / ${fmtTime(video.duration)}`;
  });
  vpSeek.addEventListener('change', () => {
    if (Number.isFinite(video.duration)) video.currentTime = (Number(vpSeek.value) / 1000) * video.duration;
    V.seeking = false;
    videoLayer.focus();
  });
  const vpVol = $('#vp-vol') as HTMLInputElement;
  vpVol.addEventListener('input', (e) => setVolume(Number((e.target as HTMLInputElement).value)));
  vpVol.addEventListener('change', () => videoLayer.focus());
  videoLayer.addEventListener('mousemove', wakeVideo);
  videoLayer.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closeVideo();
    else if (act === 'play') togglePlay();
    else if (act === 'prev') stepVideo(-1);
    else if (act === 'next') stepVideo(1);
    else if (act === 'subs') cycleSubtitles();
    else if (act === 'fs') api.toggleFullscreen();
    else if (act === 'external') openCurrentExternally();
    if (!videoLayer.hidden) videoLayer.focus();
  });
}
