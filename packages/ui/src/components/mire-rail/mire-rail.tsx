import { Component, Element, Event, Host, Prop, State, Watch, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { RAIL_CLOSE_DELAY, badgeText, isCarousel, menuPosition, railStaysOpen, readProp, scrollBehavior } from '../../utils/shell.ts';
import type { RailEntry, RailLabels, RailSession } from '../../utils/shell.ts';

/**
 * Menu principal (P4-07) : les écrans du cœur et les pages épinglées, les sites ouverts sous leur page, le badge des
 * téléchargements. À gauche ou à droite (barre latérale), en haut ou en bas (carrousel) ; rétractable.
 *
 * Chaque entrée est un `ds-trigger` vers le contrôleur `mire-app` (`open`, `openSite`, `openFile`, `quit`) autour d'un
 * vrai bouton (`.rail-item`, destination de la navigation, habillé par l'interface historique). Le menu ne fait que
 * s'afficher : la page lui donne ses entrées, l'entrée affichée et ses textes ; il prévient (`mireRailToggle`)
 * quand le menu rétractable s'ouvre ou se ferme, la page en tire la mise en page (classes du document, vue web).
 */
@Component({ tag: 'mire-rail', shadow: false })
export class MireRail {
  @Element() host!: HTMLElement;

  /** Entrées (`RailEntry`), en propriété ou en JSON. */
  @Prop() entries: RailEntry[] | string = [];

  /** Clé de l'entrée affichée. */
  @Prop() current = '';

  /** Sites ouverts par clé d'entrée, et site affiché. */
  @Prop() sessions: Record<string, RailSession[]> | string = {};
  @Prop() currentSite = '';

  /** Badges par clé d'entrée (téléchargements en cours sous le Centre). */
  @Prop() badges: Record<string, number> | string = {};

  /** `left`, `right`, `top` ou `bottom`. */
  @Prop() position = 'left';

  /** Menu rétractable : il se cache et revient quand on approche du bord ou qu'on y revient au clavier. */
  @Prop() autohide = false;

  /** Menu rétractable ouvert. */
  @Prop({ mutable: true }) open = false;

  /** Textes (`RailLabels`). */
  @Prop() labels: RailLabels | string = {};

  /** Icônes par nom (SVG de l'interface), fournies par la page. */
  @Prop() icons: Record<string, string> | string = {};

  @Event() mireRailToggle!: EventEmitter<{ open: boolean }>;

  @State() overflow = { has: false, start: true, end: true };

  private items?: HTMLElement;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private centered = '';
  private lastCenter = 0;

  @Watch('position')
  @Watch('autohide')
  layoutChanged() {
    this.setOpen(false);
    this.centered = '';
  }

  @Watch('current')
  currentChanged() {
    this.centered = '';
  }

  disconnectedCallback() {
    clearTimeout(this.closeTimer);
    removeEventListener('resize', this.updateArrows);
  }

  connectedCallback() {
    addEventListener('resize', this.updateArrows);
  }

  componentDidRender() {
    this.updateArrows();
    // En carrousel, l'entrée affichée vient au centre (sans animation) quand elle change ou que la position change.
    if (!isCarousel(menuPosition(this.position)) || this.centered === this.current) return;
    this.centered = this.current;
    this.host.querySelector('.rail-item[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  private setOpen(open: boolean) {
    if (open === this.open) return;
    this.open = open;
    this.mireRailToggle.emit({ open });
  }

  private openNow = () => {
    if (!this.autohide) return;
    clearTimeout(this.closeTimer);
    this.setOpen(true);
  };

  private closeSoon(delay: number) {
    if (!this.autohide) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      const nav = this.host.querySelector('.rail');
      if (railStaysOpen({ hover: !!nav?.matches(':hover'), focusInside: !!nav?.contains(document.activeElement) })) return;
      this.setOpen(false);
    }, delay);
  }

  private onFocusIn = (e: FocusEvent) => {
    this.openNow();
    // En carrousel, l'entrée sélectionnée vient au centre.
    const item = (e.target as HTMLElement).closest('.rail-item, .rail-sub');
    if (!item || !isCarousel(menuPosition(this.position))) return;
    const now = performance.now();
    const behavior = scrollBehavior({ reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, sinceLast: now - this.lastCenter });
    this.lastCenter = now;
    item.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
  };

  private onFocusOut = () => {
    setTimeout(() => {
      if (!this.host.querySelector('.rail')?.contains(document.activeElement)) this.closeSoon(RAIL_CLOSE_DELAY.blur);
    }, 0);
  };

  private updateArrows = () => {
    const el = this.items;
    if (!el) return;
    const next = {
      has: isCarousel(menuPosition(this.position)) && el.scrollWidth > el.clientWidth + 4,
      start: el.scrollLeft < 4,
      end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4,
    };
    const cur = this.overflow;
    if (next.has !== cur.has || next.start !== cur.start || next.end !== cur.end) this.overflow = next;
  };

  // En carrousel, la molette fait défiler horizontalement.
  private onWheel = (e: WheelEvent) => {
    if (!isCarousel(menuPosition(this.position)) || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    this.items?.scrollBy({ left: e.deltaY });
  };

  private scrollBy(step: number) {
    const el = this.items;
    el?.scrollBy({ left: step * el.clientWidth * 0.7, behavior: 'smooth' });
  }

  private icon(name: string | undefined) {
    const svg = name ? readProp<Record<string, string>>(this.icons, {})[name] : '';
    return svg ?? '';
  }

  private renderEntry(e: RailEntry, sessions: Record<string, RailSession[]>, badges: Record<string, number>, labels: RailLabels) {
    const current = e.key === this.current;
    const badge = badgeText(badges[e.key]);
    const button = (
      <button
        type="button"
        class="rail-item focusable"
        data-go={e.view}
        data-key={e.key}
        style={{ '--c': e.color }}
        aria-current={current ? 'page' : undefined}
      >
        <span class="lead">{e.icon ? <span class="ri-ico" innerHTML={this.icon(e.icon)} /> : <span class="chip" />}</span>
        <span class="lbl">{e.label}</span>
        {badge && <span class="rail-badge">{badge}</span>}
      </button>
    );
    const trigger =
      e.kind === 'openFile' ? (
        <ds-trigger key={e.key} class="mire-rail__trigger" target="mire-app" action="openFile">
          {button}
        </ds-trigger>
      ) : e.kind === 'quit' ? (
        <ds-trigger key={e.key} class="mire-rail__trigger" target="mire-app" action="quit">
          {button}
        </ds-trigger>
      ) : (
        <ds-trigger key={e.key} class="mire-rail__trigger" target="mire-app" action={`open:${JSON.stringify([{ target: e.target, focus: 'keep' }])}`}>
          {button}
        </ds-trigger>
      );
    if (!e.sessions) return trigger;
    const subs = sessions[e.key] ?? [];
    return [
      trigger,
      <div key={`${e.key}/sessions`} class="rail-sessions" aria-label={labels.sessions?.[e.key]}>
        {subs.map((s) => (
          <ds-trigger key={s.id} class="mire-rail__trigger" target="mire-app" action={`openSite:${JSON.stringify([{ id: s.id }])}`}>
            <button
              type="button"
              class="rail-sub focusable"
              data-web={s.id}
              style={{ '--c': s.color }}
              title={s.name}
              aria-current={this.currentSite === s.id ? 'page' : undefined}
            >
              <span class="dot" />
              <span class="lbl">{s.name}</span>
            </button>
          </ds-trigger>
        ))}
      </div>,
    ];
  }

  render() {
    const entries = readProp<RailEntry[]>(this.entries, []);
    const sessions = readProp<Record<string, RailSession[]>>(this.sessions, {});
    const badges = readProp<Record<string, number>>(this.badges, {});
    const labels = readProp<RailLabels>(this.labels, {});
    const top = entries.filter((e) => !e.bottom);
    const bottom = entries.filter((e) => e.bottom);
    const { has, start, end } = this.overflow;
    return (
      <Host class="mire-rail">
        <nav
          class={{ rail: true, 'has-overflow': has, 'at-start': start, 'at-end': end }}
          id="rail"
          aria-label={labels.menu}
          onMouseEnter={this.openNow}
          onMouseLeave={() => this.closeSoon(RAIL_CLOSE_DELAY.leave)}
          onFocusin={this.onFocusIn}
          onFocusout={this.onFocusOut}
        >
          <div class="brand">
            <span class="bars7 brand-bars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span class="brand-name">{labels.brand}</span>
          </div>
          <button
            class="rail-arrow prev"
            type="button"
            aria-label={labels.prev}
            tabindex="-1"
            innerHTML={this.icon('chevL')}
            onClick={() => this.scrollBy(-1)}
          />
          <div class="rail-items" id="rail-items" ref={(el) => (this.items = el)} onScroll={this.updateArrows} onWheel={this.onWheel}>
            {top.map((e) => this.renderEntry(e, sessions, badges, labels))}
            <div class="rail-spacer" />
            {bottom.map((e) => this.renderEntry(e, sessions, badges, labels))}
          </div>
          <button
            class="rail-arrow next"
            type="button"
            aria-label={labels.next}
            tabindex="-1"
            innerHTML={this.icon('chevR')}
            onClick={() => this.scrollBy(1)}
          />
        </nav>
        <div class="rail-handle" id="rail-handle" aria-hidden="true" onMouseEnter={this.openNow} />
      </Host>
    );
  }
}
