import { Component, Element, Event, Host, Prop, State, Watch, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readRecord } from '../../utils/elements.ts';
import { SEEK_STEPS, seekValue } from '../../utils/video.ts';
import type { MiniPlayerIcons, MiniPlayerLabels } from '../../utils/music.ts';

type RangeEl = HTMLElement & { refresh?: () => Promise<void> };

/**
 * Mini-lecteur de musique (P4-15), en bas de l'écran : le morceau en cours (pochette, titre, dossier et place dans la
 * file d'attente), les commandes, la position et le volume, partagé avec le lecteur vidéo. Hôte du contrôleur
 * `mire-mini-player` : ses boutons sont des `ds-trigger` vers ses actions (morceau précédent, lecture, morceau suivant,
 * arrêt).
 *
 * Il n'a ni état ni accès au processus principal : la page (`src/renderer/players/audio.ts`) tient la file et l'élément
 * audio, lui donne ce qu'il affiche, déjà rédigé, et reçoit les réglettes (`mireMusicSeek`, `mireMusicVolume`). Comme
 * dans l'interface historique, les réglettes se règlent à la souris : les flèches et la manette passent d'un bouton à
 * l'autre sans s'y arrêter.
 */
@Component({ tag: 'mire-mini-player', shadow: false })
export class MireMiniPlayer {
  @Element() host!: HTMLElement;

  /** Titre du morceau et sous-titre (dossier, place dans la file). */
  @Prop() heading = '';
  @Prop() subheading = '';

  /** Adresse de la pochette ; vide : pas de pochette. Une pochette illisible est cachée. */
  @Prop() cover = '';
  @State() coverFailed = false;

  /** Temps écoulé et durée, écrits (« 1:23 »), et proportion lue, de 0 à 1. */
  @Prop() current = '0:00';
  @Prop() duration = '0:00';
  @Prop() position = 0;

  /** Volume, de 0 à 1. */
  @Prop() volume = 1;

  /** Le morceau joue (le bouton montre « pause »). */
  @Prop() playing = false;

  /** Textes (voir `MiniPlayerLabels`) et icônes, en JSON ou en objets. */
  @Prop() labels: MiniPlayerLabels | string = '';
  @Prop() icons: MiniPlayerIcons | string = '';

  /** La réglette de position bouge (`commit` faux) ou est lâchée (`commit` vrai) : proportion de 0 à 1. */
  @Event() mireMusicSeek!: EventEmitter<{ ratio: number; commit: boolean }>;
  /** La réglette du volume bouge ou est lâchée : volume de 0 à 1. */
  @Event() mireMusicVolume!: EventEmitter<{ value: number; commit: boolean }>;

  private seekInput?: HTMLInputElement;
  private volumeInput?: HTMLInputElement;
  private seeking = false;

  connectedCallback() {
    this.host.dispatchEvent(new CustomEvent('mireConnect', { bubbles: true, detail: { tag: 'mire-mini-player' } }));
  }

  componentDidLoad() {
    this.syncSeek();
    this.syncVolume();
  }

  @Watch('cover')
  resetCover() {
    this.coverFailed = false;
  }

  @Watch('position')
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
    this.mireMusicSeek.emit({ ratio: Number((e.target as HTMLInputElement).value) / SEEK_STEPS, commit });
  };

  private onVolume = (commit: boolean) => (e: Event) => {
    this.mireMusicVolume.emit({ value: Number((e.target as HTMLInputElement).value), commit });
  };

  /** Bouton rond à icône, dans le `ds-trigger` d'une action du mini-lecteur. */
  private iconButton(icon: string | undefined, label: string, big = false) {
    return <button type="button" class={{ 'mire-mini-player__icon': true, 'mire-mini-player__icon--big': big }} aria-label={label} innerHTML={icon ?? ''} />;
  }

  render() {
    const l = readJson<MiniPlayerLabels>(this.labels) ?? ({} as MiniPlayerLabels);
    const icons = readRecord<string>(this.icons as Record<string, string> | string) as MiniPlayerIcons;
    return (
      <Host class="mire-mini-player">
        <div class="mire-mini-player__meta">
          <img
            class="mire-mini-player__cover"
            alt=""
            src={this.cover || undefined}
            hidden={!this.cover || this.coverFailed}
            onError={() => (this.coverFailed = true)}
          />
          <div class="mire-mini-player__text">
            <div class="mire-mini-player__title">{this.heading}</div>
            <div class="mire-mini-player__sub">{this.subheading}</div>
          </div>
        </div>
        <div class="mire-mini-player__controls">
          <ds-trigger class="mire-mini-player__trigger" target="mire-mini-player" action="previous">
            {this.iconButton(icons.prev, l.prev)}
          </ds-trigger>
          <ds-trigger class="mire-mini-player__trigger" target="mire-mini-player" action="togglePlay">
            {this.iconButton(this.playing ? icons.pause : icons.play, l.play, true)}
          </ds-trigger>
          <ds-trigger class="mire-mini-player__trigger" target="mire-mini-player" action="next">
            {this.iconButton(icons.next, l.next)}
          </ds-trigger>
        </div>
        <div class="mire-mini-player__seek">
          <span class="mire-mini-player__current">{this.current}</span>
          <ds-range class="mire-mini-player__range">
            <input
              type="range"
              min="0"
              max={String(SEEK_STEPS)}
              tabindex="-1"
              aria-label={l.seek}
              ref={(el) => (this.seekInput = el)}
              onInput={this.onSeek(false)}
              onChange={this.onSeek(true)}
            />
          </ds-range>
          <span class="mire-mini-player__duration">{this.duration}</span>
        </div>
        <div class="mire-mini-player__volume">
          <span class="mire-mini-player__volume-icon" aria-hidden="true" innerHTML={icons.volume ?? ''} />
          <ds-range class="mire-mini-player__range">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              tabindex="-1"
              aria-label={l.volume}
              ref={(el) => (this.volumeInput = el)}
              onInput={this.onVolume(false)}
              onChange={this.onVolume(true)}
            />
          </ds-range>
        </div>
        <ds-trigger class="mire-mini-player__trigger" target="mire-mini-player" action="stop">
          {this.iconButton(icons.close, l.stop)}
        </ds-trigger>
      </Host>
    );
  }
}
