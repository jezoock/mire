import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson } from '../../utils/elements.ts';
import { navArgs } from '../../utils/web.ts';
import type { WebBarIcons, WebBarLabels, WebBarView } from '../../utils/web.ts';

/**
 * Barre d'un site ouvert dans Mire (P4-16) : page précédente et suivante, rechargement, nom et couleur du site (publiés
 * par le processus principal), titre de la page ou choix du site de jeux, puis mémoriser la recherche, bloqueur de
 * publicités, étoile, plein écran, navigateur et fermeture.
 *
 * Sans état ni accès au processus principal : la page (`src/renderer/web/`) lui donne la barre déjà rédigée
 * (`WebBarView`), ses textes et ses icônes. Les boutons appellent le contrôleur `mire-web` ; le choix d'un site de jeux
 * part en événement (`mireWebSite`), la page le transmet au contrôleur.
 */
@Component({ tag: 'mire-webbar', shadow: false })
export class MireWebbar {
  @Element() host!: HTMLElement;

  /** La barre (voir `WebBarView`) ; `null` : aucun site ouvert. */
  @Prop() bar: WebBarView | string | null = null;

  /** Textes fixes (voir `WebBarLabels`) et icônes SVG (voir `WebBarIcons`), en JSON ou en objet. */
  @Prop() labels: WebBarLabels | string = '';
  @Prop() icons: WebBarIcons | string = '';

  /** Site de jeux choisi dans la liste (sa position). */
  @Event() mireWebSite!: EventEmitter<{ site: number }>;

  // Chaque rendu est signalé : le test de fumée attend la barre du site ouvert.
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireWebbarRender', { bubbles: true }));
  }

  private onSite = (e: Event) => {
    this.mireWebSite.emit({ site: Number((e.target as HTMLSelectElement).value) });
  };

  /** Bouton à icône de la barre ; `web` le désigne pour le test de fumée. */
  private btn(
    web: string,
    icon: string | undefined,
    label: string | undefined,
    opts: { title?: string; disabled?: boolean; cls?: string; badge?: number | null } = {},
  ) {
    return (
      <button type="button" class={`icon-btn focusable ${opts.cls ?? ''}`.trim()} aria-label={label} title={opts.title} disabled={opts.disabled} data-web={web}>
        <span class="mire-webbar__icon" innerHTML={icon ?? ''} />
        {opts.badge != null && (
          <span class="mire-webbar__badge" hidden={!opts.badge}>
            {opts.badge}
          </span>
        )}
      </button>
    );
  }

  private renderTitle(b: WebBarView, l: WebBarLabels) {
    if (b.rom) {
      return (
        <div class="mire-webbar__title --rom">
          <span class="mire-webbar__site">{b.name}</span>
          <label class="mire-webbar__label" htmlFor="mire-webbar-sites">
            {l.site}
          </label>
          <select class="mire-webbar__select focusable" id="mire-webbar-sites" aria-label={l.siteChoice} onChange={this.onSite}>
            {b.rom.sites.map((name, n) => (
              <option value={String(n)} selected={n === b.rom?.site}>
                {name}
              </option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div class="mire-webbar__title">
        <span class="mire-webbar__site">{b.name}</span>
        <span class="mire-webbar__page">{b.title}</span>
      </div>
    );
  }

  render() {
    const b = readJson<WebBarView>(this.bar);
    if (!b) return <Host class="mire-webbar" hidden />;
    const l = readJson<WebBarLabels>(this.labels) ?? {};
    const i = readJson<WebBarIcons>(this.icons) ?? {};
    const ad = b.adblock;
    const game = b.kind === 'rom';
    return (
      <Host
        class={{ 'mire-webbar': true, '--loading': b.loading }}
        role="toolbar"
        aria-label={l.label}
        data-key={b.id}
        data-kind={b.kind}
        style={{ '--brand': b.color }}
      >
        <ds-trigger target="mire-web" action={`navigate:${navArgs('back')}`}>
          {this.btn('back', i.back, l.back, { disabled: !b.canGoBack })}
        </ds-trigger>
        <ds-trigger target="mire-web" action={`navigate:${navArgs('forward')}`}>
          {this.btn('forward', i.forward, l.forward, { disabled: !b.canGoForward })}
        </ds-trigger>
        <ds-trigger target="mire-web" action={`navigate:${navArgs('reload')}`}>
          {this.btn('reload', i.reload, l.reload)}
        </ds-trigger>
        {this.renderTitle(b, l)}
        <div class="mire-webbar__tools">
          <ds-trigger target="mire-web" action="learnSearch">
            {this.btn('learnSearch', i.search, b.hasSearch ? l.learned : l.learn, {
              title: b.hasSearch ? l.learnedTitle : l.learnTitle,
              cls: `mire-webbar__btn${b.hasSearch ? ' --on' : ''}`,
            })}
          </ds-trigger>
          {ad && (
            <ds-trigger target="mire-web" action="toggleAdblock">
              {this.btn('toggleAdblock', ad.on ? i.shield : i.shieldOff, ad.label, {
                title: ad.title,
                cls: `mire-webbar__btn${ad.on ? '' : ' --off'}`,
                badge: ad.on ? ad.blocked : 0,
              })}
            </ds-trigger>
          )}
          {game ? (
            <ds-trigger target="mire-web" action="bookmarkGame">
              {this.btn('bookmarkGame', i.star, l.bookmarkGame, { title: l.bookmarkGameTitle, cls: 'mire-webbar__btn' })}
            </ds-trigger>
          ) : (
            <ds-trigger target="mire-web" action="bookmarkPage">
              {this.btn('bookmarkPage', i.star, l.bookmarkPage, { title: l.bookmarkPageTitle, cls: 'mire-webbar__btn' })}
            </ds-trigger>
          )}
          <ds-trigger target="mire-web" action={`navigate:${navArgs('immersive')}`}>
            {this.btn('immersive', i.fullscreen, l.immersive, { title: l.immersiveTitle, cls: 'mire-webbar__btn' })}
          </ds-trigger>
          <ds-trigger target="mire-web" action={`navigate:${navArgs('browser')}`}>
            {this.btn('browser', i.globe, l.browser, { title: l.browserTitle, cls: 'mire-webbar__btn' })}
          </ds-trigger>
          <ds-trigger target="mire-web" action="close">
            {this.btn('close', i.close, l.close, { title: l.closeTitle, cls: 'mire-webbar__btn' })}
          </ds-trigger>
        </div>
      </Host>
    );
  }
}
