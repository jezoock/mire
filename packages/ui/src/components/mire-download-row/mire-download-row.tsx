import { Component, Element, Host, Prop, h } from '@stencil/core';
import { readJson } from '../../utils/elements.ts';
import { idArgs, installerArgs } from '../../utils/centre.ts';
import type { DownloadRow, DownloadRowLabels } from '../../utils/centre.ts';

/**
 * Une ligne de la liste des téléchargements (P4-18) : nature, nom, ligne d'infos, erreur, barre d'avancement et
 * boutons selon l'état. La page change sa propriété `row` quand seul ce téléchargement avance : la ligne se met à
 * jour sans redessiner le Centre. Les boutons appellent le contrôleur `mire-centre` avec l'identifiant du
 * téléchargement (`pauseDownload:[{"id":"…"}]`).
 */
@Component({ tag: 'mire-download-row', shadow: false })
export class MireDownloadRow {
  @Element() host!: HTMLElement;

  /** La ligne, déjà rédigée (voir `DownloadRow`). */
  @Prop() row: DownloadRow | null = null;

  /** Textes des boutons (JSON ou objet, voir `DownloadRowLabels`). */
  @Prop() labels: DownloadRowLabels | string = '';

  // Chaque rendu est signalé : le test de fumée vérifie qu'une ligne qui avance ne redessine qu'elle.
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireDownloadRowRender', { bubbles: true, detail: { id: this.row?.id ?? '' } }));
  }

  render() {
    const r = this.row;
    if (!r) return <Host class="mire-download-row" />;
    const l = readJson<DownloadRowLabels>(this.labels) ?? {};
    const id = idArgs(r.id);
    const a = r.actions;
    return (
      <Host class={{ 'mire-download-row': true, [`--${r.state}`]: true }} data-key={r.id} data-state={r.state}>
        <span class="mire-download-row__kind">{r.kind}</span>
        <div class="mire-download-row__main">
          <div class="mire-download-row__name" title={r.name}>
            {r.name}
          </div>
          <div class="mire-download-row__meta">{r.meta}</div>
          {r.error && <div class="mire-download-row__error">{r.error}</div>}
          {r.percent !== null && (
            <div class="mire-download-row__bar" role="progressbar" aria-label={r.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent}>
              <i style={{ width: `${r.percent}%` }} />
            </div>
          )}
        </div>
        <div class="mire-download-row__actions">
          {r.installers.map((f) => (
            <ds-trigger key={f.file} type="button" mods="stl-1,sm" title={f.file} target="mire-centre" action={`runInstaller:${installerArgs(r.id, f.file)}`}>
              {f.label}
            </ds-trigger>
          ))}
          {a.start && (
            <ds-trigger type="button" mods="stl-1,sm" target="mire-centre" action={`startDownload:${id}`}>
              {l.start}
            </ds-trigger>
          )}
          {a.pause && (
            <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`pauseDownload:${id}`}>
              {l.pause}
            </ds-trigger>
          )}
          {(a.resume || a.retry) && (
            <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`resumeDownload:${id}`}>
              {a.retry ? l.retry : l.resume}
            </ds-trigger>
          )}
          {a.cancel && (
            <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`cancelDownload:${id}`}>
              {l.cancel}
            </ds-trigger>
          )}
          {a.reveal && (
            <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`revealDownload:${id}`}>
              {l.reveal}
            </ds-trigger>
          )}
          {a.remove && (
            <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`removeDownload:${id}`}>
              {l.remove}
            </ds-trigger>
          )}
        </div>
      </Host>
    );
  }
}
