import { Component, Element, Event, Host, Prop, Watch, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readRecord } from '../../utils/elements.ts';
import { SEEK_STEPS, seekValue } from '../../utils/video.ts';
import type { VideoPlayerIcons, VideoPlayerLabels } from '../../utils/video.ts';

type RangeEl = HTMLElement & { refresh?: () => Promise<void>; formatter?: (v: unknown) => string };

/**
 * Lecteur vidéo plein écran (P4-14) : la vidéo et l'affichage par-dessus (titre, position, commandes, volume,
 * sous-titres, message au centre). Hôte du contrôleur `mire-video-player` : ses boutons sont des `ds-trigger` vers ses
 * actions (fermer, lecture, vidéo précédente ou suivante, sous-titres, plein écran, lecteur externe).
 *
 * Il n'a ni état ni accès au processus principal : la page (`src/renderer/players/video.ts`) pilote l'élément `<video>`
 * qu'il contient (source, pistes de sous-titres), lui donne ce qu'il affiche, déjà rédigé, et reçoit les réglettes
 * (`mireVideoSeek`, `mireVideoVolume`). Les réglettes (`ds-range`) ne suivent la lecture que lorsque personne ne les
 * tient : la position ne saute pas sous le pouce.
 */
@Component({ tag: 'mire-video-player', shadow: false })
export class MireVideoPlayer {
  @Element() host!: HTMLElement;

  /** Titre et sous-titre de l'en-tête. */
  @Prop() heading = '';
  @Prop() subheading = '';

  /** Position écrite (« 1:23 / 45:00 ») et proportion lue, de 0 à 1. */
  @Prop() time = '';
  @Prop() position = 0;

  /** Volume, de 0 à 1. */
  @Prop() volume = 1;

  /** La vidéo joue (le bouton montre « pause »). */
  @Prop() playing = false;

  /** Vidéos avant et après dans la liste. */
  @Prop() hasPrev = false;
  @Prop() hasNext = false;

  /** Libellé du bouton des sous-titres ; vide : la vidéo n'en a pas, le bouton est caché. */
  @Prop() subtitles = '';

  /** Message au centre de l'écran, et s'il est montré (il s'efface en fondu : le texte reste pendant ce temps). */
  @Prop() osd = '';
  @Prop() osdShown = false;

  /** Rien n'a bougé depuis un moment pendant la lecture : l'affichage et le pointeur se cachent. */
  @Prop({ reflect: true }) idle = false;

  /** Textes (voir `VideoPlayerLabels`) et icônes, en JSON ou en objets. */
  @Prop() labels: VideoPlayerLabels | string = '';
  @Prop() icons: VideoPlayerIcons | string = '';

  /** La réglette de position bouge (`commit` faux) ou est lâchée (`commit` vrai) : proportion de 0 à 1. */
  @Event() mireVideoSeek!: EventEmitter<{ ratio: number; commit: boolean }>;
  /** La réglette du volume bouge ou est lâchée : volume de 0 à 1. */
  @Event() mireVideoVolume!: EventEmitter<{ value: number; commit: boolean }>;

  private seekInput?: HTMLInputElement;
  private volumeInput?: HTMLInputElement;
  private seeking = false;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-video-player' } }));
  }

  componentDidLoad() {
    this.syncSeek();
    this.syncVolume();
    const seek = this.seekInput?.parentElement as RangeEl | undefined;
    // Texte lu par les lecteurs d'écran pour la position : le temps écrit, plutôt qu'un nombre sur 1000.
    if (seek) seek.formatter = () => this.time;
  }

  @Watch('position')
  @Watch('time')
  syncSeek() {
    const input = this.seekInput;
    if (!input || this.seeking) return;
    input.value = String(seekValue(this.position));
    (input.parentElement as RangeEl).refresh?.();
  }

  @Watch('volume')
  syncVolume() {
    const input = this.volumeInput;
    if (!input) return;
    input.value = String(this.volume);
    (input.parentElement as RangeEl).refresh?.();
  }

  private onSeek = (commit: boolean) => (e: Event) => {
    this.seeking = !commit;
    this.mireVideoSeek.emit({ ratio: Number((e.target as HTMLInputElement).value) / SEEK_STEPS, commit });
  };

  private onVolume = (commit: boolean) => (e: Event) => {
    this.mireVideoVolume.emit({ value: Number((e.target as HTMLInputElement).value), commit });
  };

  /** Bouton rond à icône, dans le `ds-trigger` d'une action du lecteur. */
  private iconButton(icon: string | undefined, label: string, opts: { big?: boolean; disabled?: boolean } = {}) {
    return (
      <button
        type="button"
        class={{ 'mire-video-player__icon': true, 'mire-video-player__icon--big': !!opts.big }}
        aria-label={label}
        disabled={!!opts.disabled}
        innerHTML={icon ?? ''}
      />
    );
  }

  /** Bouton à icône et texte (lecteur externe, sous-titres). */
  private textButton(icon: string | undefined, text: string) {
    return (
      <button type="button" class="mire-video-player__text-btn">
        <span class="mire-video-player__text-icon" aria-hidden="true" innerHTML={icon ?? ''} />
        <span>{text}</span>
      </button>
    );
  }

  render() {
    const l = readJson<VideoPlayerLabels>(this.labels) ?? ({} as VideoPlayerLabels);
    const icons = readRecord<string>(this.icons as Record<string, string> | string) as VideoPlayerIcons;
    return (
      <Host class="mire-video-player" tabindex="-1">
        <video class="mire-video-player__video" preload="metadata" />
        <div class={{ 'mire-video-player__osd': true, 'is-shown': this.osdShown }} aria-live="polite">
          {this.osd}
        </div>
        <div class="mire-video-player__ui">
          <div class="mire-video-player__top">
            <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="close">
              {this.iconButton(icons.close, l.close)}
            </ds-trigger>
            <div class="mire-video-player__heading">
              <div class="mire-video-player__title">{this.heading}</div>
              <div class="mire-video-player__sub">{this.subheading}</div>
            </div>
            <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="openExternal">
              {this.textButton(icons.external, l.external)}
            </ds-trigger>
          </div>
          <div class="mire-video-player__bottom">
            <ds-range class="mire-video-player__seek">
              <input
                type="range"
                min="0"
                max={String(SEEK_STEPS)}
                aria-label={l.seek}
                ref={(el) => (this.seekInput = el)}
                onInput={this.onSeek(false)}
                onChange={this.onSeek(true)}
              />
            </ds-range>
            <div class="mire-video-player__row">
              <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="previous">
                {this.iconButton(icons.prev, l.prev, { disabled: !this.hasPrev })}
              </ds-trigger>
              <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="togglePlay">
                {this.iconButton(this.playing ? icons.pause : icons.play, l.play, { big: true })}
              </ds-trigger>
              <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="next">
                {this.iconButton(icons.next, l.next, { disabled: !this.hasNext })}
              </ds-trigger>
              <span class="mire-video-player__time">{this.time}</span>
              <span class="mire-video-player__spacer" />
              {this.subtitles ? (
                <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="cycleSubtitles">
                  {this.textButton(icons.subs, this.subtitles)}
                </ds-trigger>
              ) : null}
              <span class="mire-video-player__volume-icon" aria-hidden="true" innerHTML={icons.volume ?? ''} />
              <ds-range class="mire-video-player__volume">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label={l.volume}
                  ref={(el) => (this.volumeInput = el)}
                  onInput={this.onVolume(false)}
                  onChange={this.onVolume(true)}
                />
              </ds-range>
              <ds-trigger class="mire-video-player__trigger" target="mire-video-player" action="toggleFullscreen">
                {this.iconButton(icons.fullscreen, l.fullscreen)}
              </ds-trigger>
            </div>
          </div>
        </div>
      </Host>
    );
  }
}
