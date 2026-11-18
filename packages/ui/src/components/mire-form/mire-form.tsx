import { Component, Element, Event, Host, Method, Prop, State, h } from '@stencil/core';
import type { EventEmitter } from '@stencil/core';
import { readJson } from '../../utils/elements.ts';
import type { ActionSpec, Field, FormLabels, FormValues, Tab } from '../../utils/forms.ts';
import { mediaUrl } from '../../utils/media.ts';

/** Détail des événements d'une boîte : sa clé, et pour une saisie le champ et sa valeur (ou le brouillon d'une liste). */
export interface DialogEventDetail {
  dialog: string;
  field?: string;
  value?: string | boolean;
  draft?: string;
}

/** Fenêtre de dialogue de `ds-modal`, une fois chargée. */
type ModalElement = HTMLElement & { shown: boolean; componentOnReady?: () => Promise<unknown> };

/** Action d'un bouton de la boîte, pour le contrôleur `mire-dialogs` (`act:[{"dialog":…,"action":…}]`). */
const act = (args: Record<string, string>) => JSON.stringify([args]);

/**
 * Formulaire dans une fenêtre de dialogue (P4-06), équivalent d'`openForm` de l'interface historique : champs texte
 * (avec propositions et bouton « Parcourir »), liste, zone de texte, image, interrupteur, liste de sources, panneau à
 * onglets (`ds-panel-group`) et boutons d'action. Elle n'agit pas elle-même : chaque bouton appelle l'action `act` du
 * contrôleur `mire-dialogs` avec la clé de la boîte, et chaque saisie est signalée (`mireDialogInput`) au service des
 * boîtes, qui tient les valeurs. Elle s'ouvre une fois rendue (`modalOpen` de `ds-modal`) ; fermée par Échap, B ou un
 * clic à côté, elle émet `mireDialogClose`. Textes : ceux de l'appelant, et `labels` tirés des catalogues.
 */
@Component({ tag: 'mire-form', shadow: false })
export class MireForm {
  @Element() host!: HTMLElement;

  /** Clé de la boîte, donnée par le service (`d1`, `d2`…). */
  @Prop() dialog = '';

  @Prop() heading = '';

  @Prop() help = '';

  /** Champs complétés (`normalizeField`), hors onglets. */
  @Prop() fields: Field[] | string = [];

  /** Onglets du panneau (`ds-panel-group`), chacun avec ses champs. */
  @Prop() tabs: Tab[] | string = [];

  @Prop() actions: ActionSpec[] | string = [];

  /** Valeurs des champs, tenues par le service (images comprises, pour l'aperçu). */
  @Prop() values: FormValues | string = {};

  /** Brouillon de chaque liste de sources (champ « nouvelle source »). */
  @Prop() drafts: Record<string, string> | string = {};

  /** Libellé affiché devant chaque entrée d'une liste de sources (« Dossier », « Réseau »…), par valeur. */
  @Prop() entryLabels: Record<string, string> | string = {};

  /** Textes tirés des catalogues (voir `FormLabels`). */
  @Prop() labels: FormLabels | string = {};

  /** Fenêtre large. */
  @Prop() wide = false;

  @State() shown = false;

  @Event({ eventName: 'mireDialogOpen' }) opened!: EventEmitter<DialogEventDetail>;
  @Event({ eventName: 'mireDialogClose' }) closed!: EventEmitter<DialogEventDetail>;
  @Event({ eventName: 'mireDialogInput' }) input!: EventEmitter<DialogEventDetail>;

  private modal?: ModalElement;

  // La fenêtre s'ouvre une fois ds-modal chargé : il émet alors modalOpen, qui la date pour la navigation (P4-03).
  async componentDidLoad() {
    // Phase de capture : ds-modal arrête la propagation d'Échap avant qu'elle ne remonte jusqu'ici.
    this.host.addEventListener('keydown', this.onKeyDown, true);
    await customElements.whenDefined('ds-modal');
    await this.modal?.componentOnReady?.();
    if (this.host.isConnected) this.shown = true;
  }

  /** Ferme la boîte (comme Échap) ; le service la retire du document quand `mireDialogClose` est émis. */
  @Method()
  async close(): Promise<void> {
    this.shown = false;
  }

  /** Montre l'erreur d'un champ obligatoire (message de `ds-field`) et lui donne le focus. */
  @Method()
  async showInvalid(field: string): Promise<void> {
    const control = this.host.querySelector<HTMLInputElement>(`[name="${CSS.escape(field)}"]`);
    if (!control) return;
    const panel = control.closest('ds-panel') as (HTMLElement & { expanded?: boolean }) | null;
    if (panel && !panel.expanded) panel.click?.();
    control.reportValidity?.();
    control.focus();
  }

  private own = (e: Event) => (e.target as Element).closest('ds-modal') === this.modal;

  private onModalOpen = (e: Event) => {
    if (this.own(e)) this.opened.emit({ dialog: this.dialog });
  };

  private onModalClose = (e: Event) => {
    if (!this.own(e)) return;
    this.shown = false;
    this.closed.emit({ dialog: this.dialog });
  };

  // Échap ferme ds-modal ; l'effet par défaut empêché, une boîte historique (<dialog>) sous elle reste ouverte.
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Esc') e.preventDefault();
  };

  private emitInput(field: string, value: string | boolean) {
    this.input.emit({ dialog: this.dialog, field, value });
  }

  private trigger(label: string, args: Record<string, string>, mods = 'stl-2') {
    return (
      <ds-trigger type="button" mods={mods} target="mire-dialogs" action={`act:${act({ dialog: this.dialog, ...args })}`}>
        {label}
      </ds-trigger>
    );
  }

  private renderField(f: Field, values: FormValues, labels: FormLabels) {
    const v = values[f.id] ?? f.value;
    const cls = { 'mire-form__field': true, '--full': f.full };
    const fieldLabels = labels.required ? JSON.stringify({ required: labels.required }) : undefined;
    const messages = labels.valueMissing ? JSON.stringify({ valueMissing: labels.valueMissing }) : undefined;
    const onInput = (e: Event) => this.emitInput(f.id, (e.target as HTMLInputElement).value);
    switch (f.type) {
      case 'select':
        return (
          <ds-field class={cls} label={f.label} labels={fieldLabels}>
            <ds-select name={f.id} required={f.required} defaultValue={String(v)} onChange={onInput}>
              {f.options.map(([value, label]) => (
                <option value={value} selected={value === v}>
                  {label}
                </option>
              ))}
            </ds-select>
          </ds-field>
        );
      case 'textarea':
        return (
          <ds-field class={cls} label={f.label} labels={fieldLabels} messages={messages}>
            <textarea name={f.id} rows={f.rows} placeholder={f.placeholder} required={f.required} value={String(v)} onInput={onInput} />
          </ds-field>
        );
      case 'toggle':
        return (
          <label class={{ ...cls, 'mire-form__toggle': true }}>
            <ds-toggle
              type="switch"
              name={f.id}
              checked={v === true}
              required={f.required}
              onToggle={(e: Event) => this.emitInput(f.id, !!(e as CustomEvent<{ checked?: boolean }>).detail?.checked)}
            />
            <span>{f.label}</span>
          </label>
        );
      case 'image':
        return this.renderImage(f, String(v || ''), labels);
      case 'list':
        return this.renderList(f, Array.isArray(v) ? v : [], labels);
      default:
        return (
          <div class={{ ...cls, 'mire-form__row': !!f.browse }}>
            <ds-field label={f.label} labels={fieldLabels} messages={messages}>
              <input
                type="text"
                name={f.id}
                value={String(v)}
                placeholder={f.placeholder}
                required={f.required}
                list={f.options.length ? `${this.dialog}-${f.id}-options` : undefined}
                onInput={onInput}
              />
            </ds-field>
            {f.options.length > 0 && (
              <datalist id={`${this.dialog}-${f.id}-options`}>
                {f.options.map(([value]) => (
                  <option value={value} />
                ))}
              </datalist>
            )}
            {f.browse && this.trigger(labels.browse ?? '', { action: `browse-${f.browse}`, field: f.id })}
          </div>
        );
    }
  }

  private renderImage(f: Field, src: string, labels: FormLabels) {
    return (
      <div class="mire-form__field mire-form__image" role="group" aria-label={f.label}>
        <span class="mire-form__label">{f.label}</span>
        <span class={{ 'mire-form__preview': true, '--wide': f.wide }}>
          {src ? <ds-thumb src={mediaUrl(src)} ratio={f.wide ? '16/9' : '2/3'} decorative /> : <span class="mire-form__none">{labels.noImage}</span>}
        </span>
        <span class="mire-form__buttons">
          {this.trigger(labels.pickImage ?? '', { action: 'pick', field: f.id })}
          {this.trigger(labels.removeImage ?? '', { action: 'clear', field: f.id }, 'stl-3')}
        </span>
      </div>
    );
  }

  private renderList(f: Field, list: string[], labels: FormLabels) {
    const kinds = readJson<Record<string, string>>(this.entryLabels) ?? {};
    const draft = (readJson<Record<string, string>>(this.drafts) ?? {})[f.id] ?? '';
    return (
      <div class="mire-form__field --full mire-form__list" role="group" aria-label={f.label}>
        <span class="mire-form__label">{f.label}</span>
        <ul class="mire-form__entries">
          {list.length ? (
            list.map((value) => (
              <li class="mire-form__entry" key={value}>
                {kinds[value] && <span class="mire-form__kind">{kinds[value]}</span>}
                <span class="mire-form__value">{value}</span>
                {this.trigger(labels.remove ?? '', { action: 'list-del', field: f.id, value }, 'stl-3')}
              </li>
            ))
          ) : (
            <li class="mire-form__entry --none">{labels.emptyList}</li>
          )}
        </ul>
        <div class="mire-form__row">
          <input
            class="ds-control"
            type="text"
            name={`${f.id}-new`}
            aria-label={f.label}
            placeholder={f.placeholder}
            value={draft}
            onInput={(e) => this.input.emit({ dialog: this.dialog, field: f.id, draft: (e.target as HTMLInputElement).value })}
          />
          {this.trigger(labels.add ?? '', { action: 'list-add', field: f.id })}
          {this.trigger(labels.addFolder ?? '', { action: 'list-folder', field: f.id }, 'stl-3')}
        </div>
      </div>
    );
  }

  private renderFields(fields: Field[], values: FormValues, labels: FormLabels) {
    return <div class="mire-form__fields">{fields.map((f) => this.renderField(f, values, labels))}</div>;
  }

  render() {
    const labels = readJson<FormLabels>(this.labels) ?? {};
    const values = readJson<FormValues>(this.values) ?? {};
    const fields = readJson<Field[]>(this.fields) ?? [];
    const tabs = readJson<Tab[]>(this.tabs) ?? [];
    const actions = readJson<ActionSpec[]>(this.actions) ?? [];
    return (
      <Host class={{ 'mire-form': true, '--wide': this.wide }}>
        <ds-modal ref={(el) => (this.modal = el as ModalElement)} shown={this.shown} onModalOpen={this.onModalOpen} onModalClose={this.onModalClose}>
          <h2 slot="title" class="mire-form__title">
            {this.heading}
          </h2>
          {this.help && (
            <p slot="description" class="mire-form__help">
              {this.help}
            </p>
          )}
          <form class="mire-form__form" noValidate onSubmit={(e) => e.preventDefault()}>
            {fields.length > 0 && this.renderFields(fields, values, labels)}
            {tabs.length > 0 && (
              <ds-panel-group class="mire-form__tabs" type="tab" label={labels.tabs}>
                {tabs.map((tab) => (
                  <ds-panel key={tab.id} data-tab={tab.id}>
                    <span slot="title">{tab.label}</span>
                    {this.renderFields(tab.fields, values, labels)}
                  </ds-panel>
                ))}
              </ds-panel-group>
            )}
            <div class="mire-form__actions">
              {actions.map((a) => this.trigger(a.label, { action: a.id }, a.kind === 'primary' ? 'stl-1' : a.kind === 'ghost' ? 'stl-3' : 'stl-2'))}
            </div>
          </form>
        </ds-modal>
      </Host>
    );
  }
}
