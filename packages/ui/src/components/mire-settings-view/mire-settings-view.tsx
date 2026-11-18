import { Component, Element, Event, Host, Prop, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { settingsArgs, settingsDomId } from '../../utils/settings.ts';
import type { OrderListView, SettingsActionView, SettingsFieldView, SettingsLabels, SettingsOptionView, SettingsPanelView } from '../../utils/settings.ts';

/**
 * Vue des Réglages (P4-20) : un panneau par bloc du schéma des réglages, puis un par plugin qui déclare des réglages.
 * Champs de dot-stash (`ds-field`, `ds-select`, `ds-toggle`), palettes avec leur aperçu (dessiné avec leurs propres
 * jetons), thèmes des pages, listes ordonnables (`ds-sortable`).
 *
 * Elle n'a ni état ni accès au processus principal : la page (`src/renderer/settings/`) lui donne les panneaux déjà
 * rédigés, et reçoit chaque changement (`mireSettingChange`, enregistré aussitôt), chaque brouillon (`mireSettingDraft` :
 * texte à ajouter à une liste, éditeur JSON) et chaque nouvel ordre (`mireSettingOrder`). Les boutons vont au
 * contrôleur `mire-settings` par `ds-trigger`, avec la clé du champ, l'identifiant de la palette ou de la liste.
 */
@Component({ tag: 'mire-settings-view', shadow: false })
export class MireSettingsView {
  @Element() host!: HTMLElement;

  /** Panneaux (voir `SettingsPanelView`). */
  @Prop() panels: SettingsPanelView[] | string = [];

  /** Textes (voir `SettingsLabels`). */
  @Prop() labels: SettingsLabels | string = '';

  @Event() mireSettingChange!: EventEmitter<{ key: string; value: string | boolean }>;
  @Event() mireSettingDraft!: EventEmitter<{ key: string; value: string }>;
  @Event() mireSettingOrder!: EventEmitter<{ kind: string; keys: string[] }>;

  // Chaque rendu est signalé : la page rend le focus au contenu s'il s'est perdu.
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireSettingsRender'));
  }

  private change(key: string, value: string | boolean) {
    this.mireSettingChange.emit({ key, value });
  }

  private renderOptions(options: SettingsOptionView[], value: string) {
    const groups: (string | undefined)[] = [...new Set(options.map((o) => o.group))];
    const opt = (o: SettingsOptionView) => (
      <option value={o.value} selected={o.value === value}>
        {o.label}
      </option>
    );
    return groups.map((g) =>
      g === undefined ? options.filter((o) => o.group === undefined).map(opt) : <optgroup label={g}>{options.filter((o) => o.group === g).map(opt)}</optgroup>,
    );
  }

  private renderList(f: SettingsFieldView, l: SettingsLabels) {
    const id = settingsDomId(f.key);
    const values = Array.isArray(f.value) ? f.value : [];
    return (
      <div class="mire-settings-view__field mire-settings-view__list" role="group" aria-labelledby={`${id}-label`}>
        <span class="mire-settings-view__label" id={`${id}-label`}>
          {f.label}
        </span>
        <ul class="mire-settings-view__entries">
          {values.length ? (
            values.map((v) => (
              <li class="mire-settings-view__entry" key={v}>
                <span class="mire-settings-view__value">{v}</span>
                <ds-trigger
                  type="button"
                  mods="stl-3"
                  target="mire-settings"
                  action={`removeFromList:${settingsArgs({ key: f.key, value: v })}`}
                  aria-label={`${l.remove ?? ''} : ${v}`}
                >
                  {l.remove}
                </ds-trigger>
              </li>
            ))
          ) : (
            <li class="mire-settings-view__entry --none">{l.empty}</li>
          )}
        </ul>
        <div class="mire-settings-view__row">
          <input
            class="ds-control"
            type="text"
            id={id}
            aria-label={f.label}
            placeholder={f.placeholder}
            onInput={(e) => this.mireSettingDraft.emit({ key: f.key, value: (e.target as HTMLInputElement).value })}
          />
          <ds-trigger type="button" mods="stl-2" target="mire-settings" action={`addToList:${settingsArgs({ key: f.key })}`}>
            {l.add}
          </ds-trigger>
        </div>
      </div>
    );
  }

  private renderPalettes(f: SettingsFieldView, l: SettingsLabels) {
    return (
      <div class="mire-settings-view__palettes" role="group" aria-label={f.label}>
        {(f.palettes ?? []).map((p) => (
          <ds-trigger
            type="button"
            mods="stl-3"
            class="mire-settings-view__palette"
            target="mire-settings"
            action={`setTheme:${settingsArgs({ id: p.id })}`}
            aria-pressed={String(p.current)}
            data-key={p.id}
          >
            <span class="mire-settings-view__preview" aria-hidden="true">
              {p.preview.map((id) => (
                <span class="mire-settings-view__pane" data-palette={id}>
                  <span class="mire-settings-view__pane-rail" />
                  <span class="mire-settings-view__pane-body">
                    <span class="mire-settings-view__pane-bars">
                      {['white', 'yellow', 'cyan', 'green', 'magenta', 'red', 'blue'].map((c) => (
                        <i style={{ background: `var(--bar-${c})` }} />
                      ))}
                    </span>
                    <span class="mire-settings-view__pane-line" />
                    <span class="ds-button --stl-1 mire-settings-view__pane-button" />
                  </span>
                </span>
              ))}
            </span>
            <span class="mire-settings-view__palette-name">
              {p.name}
              {p.current && <span class="mire-settings-view__current"> · {l.current}</span>}
            </span>
          </ds-trigger>
        ))}
      </div>
    );
  }

  private renderThemes(f: SettingsFieldView, l: SettingsLabels) {
    return (
      <div class="mire-settings-view__field --full">
        <span class="mire-settings-view__label">{f.label}</span>
        {this.renderPalettes(f, l)}
        <div class="mire-settings-view__themes" role="group" aria-label={f.label}>
          {(f.pageThemes ?? []).map((th) => (
            <ds-trigger
              type="button"
              mods="stl-3"
              class="mire-settings-view__theme"
              target="mire-settings"
              action={`setPageTheme:${settingsArgs({ id: th.id })}`}
              aria-pressed={String(th.current)}
              data-key={th.id}
            >
              <span class="mire-settings-view__theme-name">{th.name}</span>
              <span class="mire-settings-view__theme-desc">{th.description}</span>
            </ds-trigger>
          ))}
        </div>
      </div>
    );
  }

  private renderOrderList(list: OrderListView, l: SettingsLabels) {
    const on = list.items.filter((x) => x.on);
    const off = list.items.filter((x) => !x.on);
    return (
      <div class="mire-settings-view__order" data-list={list.kind}>
        <h3 class="mire-settings-view__sub">{list.label}</h3>
        <ds-sortable
          class="mire-settings-view__sortable"
          label={list.label}
          buttons
          labels={l.sortable}
          data-list={list.kind}
          onOrderChange={(e: CustomEvent<{ keys: string[] }>) => this.mireSettingOrder.emit({ kind: list.kind, keys: e.detail.keys })}
        >
          {on.map((x) => (
            <div class="mire-settings-view__item" key={x.id} data-key={x.id} data-label={x.label}>
              <span class="mire-settings-view__chip" style={{ background: x.color }} />
              <span class="mire-settings-view__item-label">{x.label}</span>
              {list.toggle && (
                <ds-trigger
                  type="button"
                  mods="stl-3"
                  target="mire-settings"
                  action={`toggleHomeItem:${settingsArgs({ kind: list.kind, id: x.id, on: false })}`}
                  aria-label={`${l.hide ?? ''} : ${x.label}`}
                >
                  {l.hide}
                </ds-trigger>
              )}
            </div>
          ))}
        </ds-sortable>
        {list.toggle && off.length > 0 && (
          <div class="mire-settings-view__hidden" role="group" aria-label={`${list.label} · ${l.hidden ?? ''}`}>
            <span class="mire-settings-view__hint">{l.hidden}</span>
            {off.map((x) => (
              <span class="mire-settings-view__off" key={x.id}>
                <span class="mire-settings-view__chip" style={{ background: x.color }} />
                <ds-trigger
                  type="button"
                  mods="stl-3"
                  target="mire-settings"
                  action={`toggleHomeItem:${settingsArgs({ kind: list.kind, id: x.id, on: true })}`}
                  aria-label={`${l.show ?? ''} : ${x.label}`}
                >
                  {x.label}
                </ds-trigger>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  private renderField(f: SettingsFieldView, l: SettingsLabels) {
    const id = settingsDomId(f.key);
    const hint = f.help ?? '';
    switch (f.kind) {
      case 'toggle':
        return (
          <div class="mire-settings-view__field --toggle">
            <label class="mire-settings-view__check">
              <ds-toggle
                type="switch"
                id={id}
                checked={f.value === true}
                onToggle={(e: Event) => this.change(f.key, !!(e as CustomEvent<{ checked?: boolean }>).detail?.checked)}
              />
              <span>{f.label}</span>
            </label>
            {hint && <p class="mire-settings-view__hint">{hint}</p>}
          </div>
        );
      case 'choice':
        return (
          <ds-field class="mire-settings-view__field" label={f.label} hint={hint}>
            <ds-select name={id} defaultValue={String(f.value ?? '')} onChange={(e: Event) => this.change(f.key, (e.target as HTMLSelectElement).value)}>
              {this.renderOptions(f.options ?? [], String(f.value ?? ''))}
            </ds-select>
          </ds-field>
        );
      case 'list':
        return this.renderList(f, l);
      case 'themes':
        return this.renderThemes(f, l);
      case 'order':
        return (
          <div class="mire-settings-view__field --full">
            {hint && <p class="mire-settings-view__hint">{hint}</p>}
            {(f.lists ?? []).map((list) => this.renderOrderList(list, l))}
          </div>
        );
      case 'page':
        return (
          <div class="mire-settings-view__field --full">
            <span class="mire-settings-view__label">{f.label}</span>
            <div class="mire-settings-view__buttons">
              {(f.links ?? []).map((k) => (
                <ds-trigger type="button" mods="stl-3" target="mire-settings" action={`openPageSettings:${settingsArgs({ page: k.page, tab: k.tab })}`}>
                  {k.label}
                </ds-trigger>
              ))}
            </div>
          </div>
        );
      default: {
        const secret = f.kind === 'secret';
        const placeholder = secret && f.secretSet ? l.secretSet : f.placeholder;
        return (
          <div class={{ 'mire-settings-view__field': true, 'mire-settings-view__row': f.kind === 'path' }}>
            <ds-field label={f.label} hint={hint}>
              <input
                type={secret ? 'password' : 'text'}
                id={id}
                name={f.key}
                value={String(f.value ?? '')}
                placeholder={placeholder}
                autocomplete="off"
                spellcheck={false}
                onChange={(e) => this.change(f.key, (e.target as HTMLInputElement).value.trim())}
              />
            </ds-field>
            {f.kind === 'path' && (
              <ds-trigger type="button" mods="stl-3" target="mire-settings" action={`pickPath:${settingsArgs({ key: f.key, pick: f.pick ?? 'folder' })}`}>
                {l.browse}
              </ds-trigger>
            )}
          </div>
        );
      }
    }
  }

  // Chaque action est écrite telle quelle (le script de P4-04 vérifie qu'elle existe dans le contrôleur).
  private renderAction(a: SettingsActionView) {
    const mods = a.ghost ? 'stl-3' : 'stl-2';
    switch (a.action) {
      case 'rescan':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="rescan">
            {a.label}
          </ds-trigger>
        );
      case 'scrapeAll':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="scrapeAll">
            {a.label}
          </ds-trigger>
        );
      case 'clearScrape':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="clearScrape">
            {a.label}
          </ds-trigger>
        );
      case 'updateFilterLists':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="updateFilterLists">
            {a.label}
          </ds-trigger>
        );
      case 'exportConfig':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="exportConfig">
            {a.label}
          </ds-trigger>
        );
      case 'importConfig':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action={`importConfig:${settingsArgs({ mode: a.mode ?? 'replace' })}`}>
            {a.label}
          </ds-trigger>
        );
      case 'revealConfig':
        return (
          <ds-trigger type="button" mods={mods} target="mire-settings" action="revealConfig">
            {a.label}
          </ds-trigger>
        );
      default:
        return null;
    }
  }

  private renderActions(actions: SettingsActionView[]) {
    return <div class="mire-settings-view__buttons">{actions.map((a) => this.renderAction(a))}</div>;
  }

  private renderPanel(p: SettingsPanelView, l: SettingsLabels) {
    const id = settingsDomId(p.id);
    return (
      <section class="mire-settings-view__panel" id={id} data-panel={p.id} aria-labelledby={`${id}-title`} key={p.id}>
        <h2 class="mire-settings-view__title" id={`${id}-title`}>
          {p.title}
        </h2>
        {p.help && <p class="mire-settings-view__help">{p.help}</p>}
        {p.fields.length > 0 && <div class="mire-settings-view__fields">{p.fields.map((f) => this.renderField(f, l))}</div>}
        {(p.notes ?? []).map((n) => (
          <p class="mire-settings-view__note">{n}</p>
        ))}
        {p.json !== undefined && (
          <div class="mire-settings-view__json">
            <textarea
              class="ds-control mire-settings-view__code"
              rows={18}
              spellcheck={false}
              aria-label={p.title}
              value={p.json}
              onInput={(e) => this.mireSettingDraft.emit({ key: 'advanced', value: (e.target as HTMLTextAreaElement).value })}
            />
            <div class="mire-settings-view__buttons">
              <ds-trigger type="button" mods="stl-1" target="mire-settings" action="saveAdvanced">
                {l.save}
              </ds-trigger>
            </div>
          </div>
        )}
        {p.actions && p.actions.length > 0 && this.renderActions(p.actions)}
      </section>
    );
  }

  render() {
    const l = readJson<SettingsLabels>(this.labels) ?? {};
    return <Host class="mire-settings-view">{readList<SettingsPanelView>(this.panels).map((p) => this.renderPanel(p, l))}</Host>;
  }
}
