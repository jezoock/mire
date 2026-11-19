import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { explorerArgs } from '../../utils/explorer.ts';
import type { ExplorerColumn, ExplorerLabels, ExplorerPreview, ExplorerRow, ExplorerSelection } from '../../utils/explorer.ts';

/**
 * Vue de l'explorateur (P4-08) : des colonnes côte à côte, comme le Finder du Mac, puis l'aperçu de l'élément choisi.
 * Navigation par colonnes (P4-03, `data-nav="columns"`) : haut et bas changent de ligne, gauche et droite de colonne.
 *
 * Elle n'a ni état ni accès au processus principal : la page (`src/renderer/explorer/`) lui donne les colonnes et les
 * textes déjà rédigés. Une ligne qui reçoit le focus est signalée (`mireExplorerFocus`) : la page montre ce qu'elle
 * ouvre, sans déplacer le focus. Les actions (Entrée, bouton A, clic) vont au contrôleur `mire-explorer`, avec le nœud
 * d'une branche ou la clé d'un élément. Affichage fixe : l'habillage du cœur et la palette, jamais le thème.
 *
 * Sélection multiple (P4-09) : Ctrl (ou ⌘) + clic choisit un élément, Maj + clic une plage, Espace au clavier ; la
 * vue le signale (`mireExplorerPick`) sans ouvrir l'aperçu. Les éléments choisis ont une barre d'actions au-dessus des
 * colonnes ; les actions sur les fichiers de l'aperçu sont désactivées, avec la raison, hors des dossiers autorisés.
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

  /** Clés des éléments choisis (sélection multiple). */
  @Prop() picked: string[] | string = [];

  /** Barre de la sélection ; `null` si rien n'est choisi. */
  @Prop() selection: ExplorerSelection | string | null = null;

  /** Une ligne a reçu le focus : son nœud (branche) ou sa clé (élément). */
  @Event() mireExplorerFocus!: EventEmitter<{ node?: string; key?: string }>;

  /** Un élément est choisi ou retiré de la sélection ; `range` : tous ceux depuis le dernier choisi. */
  @Event() mireExplorerPick!: EventEmitter<{ key: string; range: boolean }>;

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

  /** Ligne d'un élément qu'on peut choisir, sous l'événement ; `null` sinon. */
  private pickable(e: Event): HTMLElement | null {
    const row = (e.target as Element | null)?.closest?.('.mire-explorer-view__row[data-key]') as HTMLElement | null;
    return row && !row.hasAttribute('data-unavailable') ? row : null;
  }

  private pick(e: Event, row: HTMLElement, range: boolean) {
    // Avant le ds-trigger de la ligne : le choix n'ouvre pas l'aperçu.
    e.preventDefault();
    e.stopPropagation();
    this.mireExplorerPick.emit({ key: row.dataset.key as string, range });
  }

  private onClickCapture = (e: MouseEvent) => {
    const row = e.ctrlKey || e.metaKey || e.shiftKey ? this.pickable(e) : null;
    if (row) this.pick(e, row, e.shiftKey);
  };

  private onKeyDownCapture = (e: KeyboardEvent) => {
    const row = e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey ? this.pickable(e) : null;
    if (row) this.pick(e, row, e.shiftKey);
  };

  private renderRow(r: ExplorerRow, selected: boolean, l: ExplorerLabels, picked: boolean) {
    const common = {
      key: r.id,
      class: { 'mire-explorer-view__row': true, '--selected': selected, '--branch': !!r.node, '--unavailable': !!r.unavailable, '--picked': picked },
      'data-node': r.node,
      'data-key': r.key,
      'data-unavailable': r.unavailable ? '' : undefined,
      'data-picked': picked ? '' : undefined,
      'aria-current': selected ? 'true' : undefined,
      label: [r.label, r.count !== undefined ? String(r.count) : '', r.unavailable ? l.unavailable : '', picked ? l.picked : ''].filter(Boolean).join(', '),
    };
    const inner = [
      picked && <span class="mire-explorer-view__check" aria-hidden="true" />,
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

  private renderColumn(c: ExplorerColumn, l: ExplorerLabels, picked: ReadonlySet<string>) {
    return (
      <section key={c.node} class="mire-explorer-view__column" data-nav-column data-column={c.node} aria-label={c.heading}>
        <h2 class="mire-explorer-view__heading">{c.heading}</h2>
        <div class="mire-explorer-view__rows" role="list">
          {c.rows.length ? (
            c.rows.map((r) => this.renderRow(r, r.id === c.selected, l, !!r.key && picked.has(r.key)))
          ) : (
            <p class="mire-explorer-view__empty">{l.empty}</p>
          )}
          {c.more && (
            <ds-trigger class="mire-explorer-view__more" type="button" mods="stl-3,sm" target="mire-explorer" action={`more:${explorerArgs({ node: c.node })}`}>
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
            <ds-trigger class="mire-explorer-view__action" type="button" mods="stl-1" target="mire-explorer" action={`play:${args}`} data-preview-action="play">
              {l.play}
            </ds-trigger>
          )}
          <ds-trigger class="mire-explorer-view__action" type="button" mods="stl-2" target="mire-explorer" action={`edit:${args}`} data-preview-action="edit">
            {l.edit}
          </ds-trigger>
          <ds-trigger
            class="mire-explorer-view__action"
            type="button"
            mods="stl-2"
            target="mire-explorer"
            action={`editTags:${args}`}
            data-preview-action="tags"
          >
            {l.editTags}
          </ds-trigger>
          <ds-trigger
            class="mire-explorer-view__action"
            type="button"
            mods="stl-2"
            target="mire-explorer"
            action={`addToList:${args}`}
            data-preview-action="list"
          >
            {l.addToList}
          </ds-trigger>
          {this.renderFileActions(p, l, args)}
        </div>
        {p.files && !p.files.allowed && (
          <p class="mire-explorer-view__reason" id="mire-explorer-files-reason">
            <strong>{l.filesBlocked}</strong> {p.files.reason}
          </p>
        )}
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

  /** Renommer, déplacer, supprimer : désactivés hors des dossiers autorisés (la raison suit les actions). */
  private renderFileActions(p: ExplorerPreview, l: ExplorerLabels, args: string) {
    if (!p.files) return null;
    const off = !p.files.allowed;
    const described = off ? 'mire-explorer-files-reason' : undefined;
    const common = { class: 'mire-explorer-view__action', type: 'button' as const, mods: 'stl-3', disabled: off, 'aria-describedby': described };
    return [
      <ds-trigger {...common} target="mire-explorer" action={`rename:${args}`} data-preview-action="rename">
        {l.rename}
      </ds-trigger>,
      <ds-trigger {...common} target="mire-explorer" action={`move:${args}`} data-preview-action="move">
        {l.move}
      </ds-trigger>,
      <ds-trigger {...common} target="mire-explorer" action={`remove:${args}`} data-preview-action="remove">
        {l.remove}
      </ds-trigger>,
    ];
  }

  /** Barre des éléments choisis : combien, et ce qu'on peut en faire. */
  private renderSelection(sel: ExplorerSelection, l: ExplorerLabels) {
    const blocked = !!sel.blocked;
    return (
      <section class="mire-explorer-view__selection" aria-label={l.selection}>
        <p class="mire-explorer-view__selection-count" role="status">
          {sel.count}
        </p>
        <div class="mire-explorer-view__actions">
          <ds-trigger type="button" mods="stl-2,sm" target="mire-explorer" action="addTagToPicked" data-selection-action="addTag">
            {l.addTag}
          </ds-trigger>
          <ds-trigger type="button" mods="stl-2,sm" target="mire-explorer" action="removeTagFromPicked" data-selection-action="removeTag">
            {l.removeTag}
          </ds-trigger>
          <ds-trigger type="button" mods="stl-2,sm" target="mire-explorer" action="addPickedToList" data-selection-action="list">
            {l.toList}
          </ds-trigger>
          <ds-trigger
            type="button"
            mods="stl-3,sm"
            target="mire-explorer"
            action="removePicked"
            data-selection-action="remove"
            disabled={blocked || !!sel.checking}
            aria-describedby={blocked ? 'mire-explorer-selection-reason' : undefined}
          >
            {l.removePicked}
          </ds-trigger>
          <ds-trigger type="button" mods="stl-3,sm" target="mire-explorer" action="clearPicks" data-selection-action="clear">
            {l.clearPicks}
          </ds-trigger>
        </div>
        {blocked && (
          <p class="mire-explorer-view__reason" id="mire-explorer-selection-reason">
            {sel.blocked}
          </p>
        )}
      </section>
    );
  }

  render() {
    const l = readJson<ExplorerLabels>(this.labels) ?? {};
    const columns = readList<ExplorerColumn>(this.columns);
    const preview = readJson<ExplorerPreview>(this.preview);
    const picked = new Set(readList<string>(this.picked));
    const selection = readJson<ExplorerSelection>(this.selection);
    return (
      <Host class="mire-explorer-view">
        {selection && this.renderSelection(selection, l)}
        <div
          class="mire-explorer-view__columns"
          data-nav="columns"
          aria-label={l.columns}
          onFocusin={this.onFocusIn}
          onClickCapture={this.onClickCapture}
          onKeyDownCapture={this.onKeyDownCapture}
        >
          {columns.map((c) => this.renderColumn(c, l, picked))}
          {preview && this.renderPreview(preview, l)}
        </div>
      </Host>
    );
  }
}
