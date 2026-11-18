import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { explorerArgs } from '../../utils/explorer.ts';
import type { ExplorerColumn, ExplorerLabels, ExplorerPreview, ExplorerRow } from '../../utils/explorer.ts';

/**
 * Vue de l'explorateur (P4-08) : des colonnes côte à côte, comme le Finder du Mac, puis l'aperçu de l'élément choisi.
 * Navigation par colonnes (P4-03, `data-nav="columns"`) : haut et bas changent de ligne, gauche et droite de colonne.
 *
 * Elle n'a ni état ni accès au processus principal : la page (`src/renderer/explorer/`) lui donne les colonnes et les
 * textes déjà rédigés. Une ligne qui reçoit le focus est signalée (`mireExplorerFocus`) : la page montre ce qu'elle
 * ouvre, sans déplacer le focus. Les actions (Entrée, bouton A, clic) vont au contrôleur `mire-explorer`, avec le nœud
 * d'une branche ou la clé d'un élément. Affichage fixe : l'habillage du cœur et la palette, jamais le thème.
 */
@Component({ tag: 'mire-explorer-view', shadow: false })
export class MireExplorerView {
  @Element() host!: HTMLElement;

  /** Colonnes, de gauche à droite. */
  @Prop() columns: ExplorerColumn[] | string = [];

  /** Aperçu de l'élément choisi ; `null` s'il n'y en a pas. */
  @Prop() preview: ExplorerPreview | string | null = null;

  /** Textes (voir `ExplorerLabels`), en JSON. */
  @Prop() labels: ExplorerLabels | string = '';

  /** Une ligne a reçu le focus : son nœud (branche) ou sa clé (élément). */
  @Event() mireExplorerFocus!: EventEmitter<{ node?: string; key?: string }>;

  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireExplorerRender'));
  }

  private onFocusIn = (e: FocusEvent) => {
    const row = (e.target as Element | null)?.closest?.('.mire-explorer-view__row') as HTMLElement | null;
    if (!row) return;
    const { node, key } = row.dataset;
    if (node) this.mireExplorerFocus.emit({ node });
    else if (key && !row.hasAttribute('data-unavailable')) this.mireExplorerFocus.emit({ key });
  };

  private renderRow(r: ExplorerRow, selected: boolean, l: ExplorerLabels) {
    const common = {
      key: r.id,
      class: { 'mire-explorer-view__row': true, '--selected': selected, '--branch': !!r.node, '--unavailable': !!r.unavailable },
      'data-node': r.node,
      'data-key': r.key,
      'data-unavailable': r.unavailable ? '' : undefined,
      'aria-current': selected ? 'true' : undefined,
      label: [r.label, r.count !== undefined ? String(r.count) : '', r.unavailable ? l.unavailable : ''].filter(Boolean).join(', '),
    };
    const inner = [
      <span class="mire-explorer-view__label" aria-hidden="true">
        {r.label}
      </span>,
      r.unavailable && (
        <span class="mire-explorer-view__badge" aria-hidden="true">
          {l.unavailable}
        </span>
      ),
      r.count !== undefined && (
        <span class="mire-explorer-view__count" aria-hidden="true">
          {r.count}
        </span>
      ),
      r.node && <span class="mire-explorer-view__chevron" aria-hidden="true" />,
    ];
    // Une branche ouvre la colonne suivante, un élément son aperçu ; un élément disparu d'une liste ne s'ouvre pas.
    if (r.node)
      return (
        <ds-trigger {...common} target="mire-explorer" action={`openNode:${explorerArgs({ node: r.node })}`}>
          {inner}
        </ds-trigger>
      );
    if (r.unavailable) return <ds-trigger {...common}>{inner}</ds-trigger>;
    return (
      <ds-trigger {...common} target="mire-explorer" action={`showElement:${explorerArgs({ key: r.key as string })}`}>
        {inner}
      </ds-trigger>
    );
  }

  private renderColumn(c: ExplorerColumn, l: ExplorerLabels) {
    return (
      <section key={c.node} class="mire-explorer-view__column" data-nav-column data-column={c.node} aria-label={c.heading}>
        <h2 class="mire-explorer-view__heading">{c.heading}</h2>
        <div class="mire-explorer-view__rows" role="list">
          {c.rows.length ? c.rows.map((r) => this.renderRow(r, r.id === c.selected, l)) : <p class="mire-explorer-view__empty">{l.empty}</p>}
          {c.more && (
            <ds-trigger class="mire-explorer-view__more" mods="stl-3" target="mire-explorer" action={`more:${explorerArgs({ node: c.node })}`}>
              {c.more}
            </ds-trigger>
          )}
        </div>
      </section>
    );
  }

  private renderPreview(p: ExplorerPreview, l: ExplorerLabels) {
    const args = explorerArgs({ key: p.key });
    return (
      <section key="preview" class="mire-explorer-view__column mire-explorer-view__preview" data-nav-column data-preview={p.key} aria-label={l.preview}>
        {p.image && <ds-thumb class="mire-explorer-view__image" src={p.image} ratio="2/3" label={p.name} decorative />}
        <h2 class="mire-explorer-view__name">{p.name}</h2>
        <div class="mire-explorer-view__actions">
          {p.playable && (
            <ds-trigger class="mire-explorer-view__action" mods="stl-1" target="mire-explorer" action={`play:${args}`} data-preview-action="play">
              {l.play}
            </ds-trigger>
          )}
          <ds-trigger class="mire-explorer-view__action" mods="stl-2" target="mire-explorer" action={`edit:${args}`} data-preview-action="edit">
            {l.edit}
          </ds-trigger>
          <ds-trigger class="mire-explorer-view__action" mods="stl-2" target="mire-explorer" action={`editTags:${args}`} data-preview-action="tags">
            {l.editTags}
          </ds-trigger>
          <ds-trigger class="mire-explorer-view__action" mods="stl-2" target="mire-explorer" action={`addToList:${args}`} data-preview-action="list">
            {l.addToList}
          </ds-trigger>
        </div>
        {p.facts.length > 0 && (
          <dl class="mire-explorer-view__facts" aria-label={l.infos}>
            {p.facts.map((f) => [<dt>{f.label}</dt>, <dd>{f.value}</dd>])}
          </dl>
        )}
        <h3 class="mire-explorer-view__subheading">{l.tags}</h3>
        {p.tags.length ? (
          <ul class="mire-explorer-view__tags">
            {p.tags.map((x) => (
              <li>{x}</li>
            ))}
          </ul>
        ) : (
          <p class="mire-explorer-view__empty">{l.noTags}</p>
        )}
        <dl class="mire-explorer-view__facts">
          <dt>{l.source}</dt>
          <dd>{p.source}</dd>
          {p.location && [<dt>{l.location}</dt>, <dd class="mire-explorer-view__location">{p.location}</dd>]}
        </dl>
      </section>
    );
  }

  render() {
    const l = readJson<ExplorerLabels>(this.labels) ?? {};
    const columns = readList<ExplorerColumn>(this.columns);
    const preview = readJson<ExplorerPreview>(this.preview);
    return (
      <Host class="mire-explorer-view">
        <div class="mire-explorer-view__columns" data-nav="columns" aria-label={l.columns} onFocusin={this.onFocusIn}>
          {columns.map((c) => this.renderColumn(c, l))}
          {preview && this.renderPreview(preview, l)}
        </div>
      </Host>
    );
  }
}
