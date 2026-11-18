/**
 * Service des boîtes de dialogue et des notifications sur les composants (P4-06) : `openForm` (formulaire sur
 * `ds-modal`, résultat par promesse, même forme que l'`openForm` historique), `confirmDialog` (oui / non),
 * `pickCandidate` (choisir la bonne fiche) et `notify` (`ds-toaster`, mêmes durées que `toast`).
 *
 * Les boîtes ouvertes forment une pile (`DialogStack`) : la dernière reçoit le clavier et la manette (portée de la
 * navigation, P4-03), Échap ou B ne ferme qu'elle, et `ds-modal` rend le focus à l'élément qui l'avait. Tant qu'une
 * boîte est ouverte, `onOpenChange` le signale à l'interface, qui masque la vue web native puis la réaffiche
 * (`syncWeb` d'app.js, comme pour les couches plein écran). Une boîte ouverte depuis une boîte historique
 * (`<dialog>` modal) est placée dans celle-ci, seule partie de la page qui n'est pas inerte.
 *
 * Les boutons des boîtes appellent l'action `act` du contrôleur `mire-dialogs` (controllers/dialogs.ts), qui la
 * transmet ici. Les textes viennent des catalogues (`forms.*`).
 */
import { DialogStack } from './dialog-stack.ts';
import {
  actionKind,
  addToList,
  allFields,
  formValues,
  initialValues,
  legacyActionId,
  missingRequired,
  normalizeCandidates,
  normalizeField,
  parseDialogAction,
  removeFromList,
  toastDuration,
} from '@mire/ui/utils';
import type { ActionSpec, CandidateSpec, Field, FieldSpec, FormLabels, FormResult, FormValues, Tab } from '@mire/ui/utils';

/** Ce que l'interface fournit au service. */
export interface DialogHooks {
  /** Traduction (catalogues `forms.*`). */
  t(key: string): string;
  pickFile(): Promise<string | null | undefined>;
  pickFolder(): Promise<string | null | undefined>;
  /** Première boîte ouverte (`true`), dernière fermée (`false`) : la vue web native se masque, puis revient. */
  onOpenChange?(open: boolean): void;
  /** Notification avec un bouton d'action, que `ds-toaster` n'a pas : message historique (`toast`). */
  toastWithAction?(message: string, opts: NotifyOptions): void;
}

/** Ce que reçoit `onAction`, comme le `form` d'`openForm`. */
export interface FormHandle {
  values(): FormValues;
  set(id: string, value: string | boolean | string[] | null | undefined): void;
  setImage(id: string, src: string | null | undefined): void;
  help(text: string): void;
}

export interface FormOptions {
  title: string;
  help?: string;
  fields?: FieldSpec[];
  /** Panneau à onglets : chaque onglet a ses champs ; les valeurs de tous les onglets sont rendues ensemble. */
  tabs?: { id: string; label: string; fields: FieldSpec[] }[];
  actions: ActionSpec[];
  /** Appelé pour chaque bouton (hors champs) ; rendre `true` garde la boîte ouverte. */
  onAction?(action: string, form: FormHandle): boolean | void | Promise<boolean | void>;
  wide?: boolean;
  /** Libellé affiché devant une entrée d'une liste de sources (son type : dossier, réseau…). */
  entryLabel?(value: string): string;
  /** Textes des boîtes propres à ce formulaire (liste vide des tags d'un éditeur…), à la place de ceux de `forms.*`. */
  labels?: Partial<FormLabels>;
}

export interface NotifyOptions {
  duration?: number;
  action?: string;
  onAction?(): void;
}

type DialogElement = HTMLElement & { close(): Promise<void>; showInvalid?(field: string): Promise<void>; [prop: string]: unknown };

interface FormEntry {
  kind: 'form';
  el: DialogElement;
  opts: FormOptions;
  fields: Field[];
  values: FormValues;
  drafts: Record<string, string>;
  resolve(result: FormResult): void;
}

interface PickEntry<T> {
  kind: 'pick';
  el: DialogElement;
  items: readonly T[];
  keys: string[];
  resolve(item: T | null): void;
}

type Entry = (FormEntry | PickEntry<unknown>) & { openedAt: number; returnFocus: Element | null };

const stack = new DialogStack<Entry>();
let hooks: DialogHooks | null = null;
let host: HTMLElement | null = null;

const LABEL_KEYS: (keyof FormLabels)[] = [
  'browse',
  'pickImage',
  'removeImage',
  'noImage',
  'add',
  'addFolder',
  'remove',
  'emptyList',
  'required',
  'valueMissing',
  'tabs',
  'cancel',
];
const labels = (): FormLabels => Object.fromEntries(LABEL_KEYS.map((k) => [k, hooks?.t(`forms.${k}`) ?? ''])) as FormLabels;

/** Branche le service : hôte `mire-dialogs` de la page (créé s'il manque), saisies et fermetures des boîtes. */
export function initDialogs(h: DialogHooks): void {
  hooks = h;
  if (host) return;
  host = document.querySelector('mire-dialogs') ?? document.body.appendChild(document.createElement('mire-dialogs'));
  host.addEventListener('mireDialogInput', onInput);
  document.addEventListener('mireDialogClose', onClosed);
  stack.onChange((open) => {
    hooks?.onOpenChange?.(open);
    document.dispatchEvent(new CustomEvent('mireDialogsChange', { detail: { open } }));
  });
}

/** Vrai tant qu'une boîte du service est ouverte. */
export const dialogsOpen = (): boolean => stack.size > 0;

/** Clé de la boîte au premier plan, ou `undefined`. */
export const topDialogKey = (): string | undefined => stack.topId();

/* ------------------------------------------------------------------ */
/* Ouverture                                                            */
/* ------------------------------------------------------------------ */

// Une boîte historique (<dialog> modal) rend le reste de la page inerte : une boîte ouverte après elle y est placée.
function containerFor(): HTMLElement {
  const legacy = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
    .sort((a, b) => Number(a.dataset.opened || 0) - Number(b.dataset.opened || 0))
    .pop();
  const top = stack.top();
  if (legacy && (!top || Number(legacy.dataset.opened || 0) > top.openedAt)) return legacy;
  return top?.el.parentElement ?? (host as HTMLElement);
}

function mount(tag: string, props: Record<string, unknown>, entry: Omit<FormEntry, 'el'> | Omit<PickEntry<unknown>, 'el'>): DialogElement {
  if (!host) throw new Error('Service des boîtes non initialisé (initDialogs)');
  const id = stack.nextId();
  const el = document.createElement(tag) as DialogElement;
  Object.assign(el, { labels: labels() }, props, { dialog: id });
  const returnFocus = document.activeElement;
  containerFor().appendChild(el);
  stack.push(id, { ...entry, el, openedAt: Date.now() + Math.random(), returnFocus } as Entry);
  return el;
}

/** Formulaire sur `ds-modal` ; la promesse rend `{ action, values }` (`action` vaut `cancel` si la boîte est fermée). */
export function openForm(opts: FormOptions): Promise<FormResult> {
  const fields = (opts.fields ?? []).map(normalizeField);
  const tabs: Tab[] = (opts.tabs ?? []).map((tab) => ({ id: tab.id, label: tab.label, fields: tab.fields.map(normalizeField) }));
  const every = allFields(fields, tabs);
  const values = initialValues(every);
  return new Promise((resolve) => {
    const entry = { kind: 'form' as const, opts, fields: every, values, drafts: {}, resolve };
    mount(
      'mire-form',
      {
        heading: opts.title,
        help: opts.help ?? '',
        fields,
        tabs,
        actions: opts.actions,
        values: { ...values },
        wide: !!opts.wide,
        entryLabels: entryLabels(opts, values),
        ...(opts.labels ? { labels: { ...labels(), ...opts.labels } } : {}),
      },
      entry,
    );
  });
}

/** Question oui / non ; `true` si l'on a choisi `yesLabel`. */
export async function confirmDialog(title: string, help: string, yesLabel: string): Promise<boolean> {
  const res = await openForm({
    title,
    help,
    fields: [],
    actions: [
      { id: 'yes', label: yesLabel, kind: 'primary' },
      { id: 'no', label: hooks?.t('forms.no') ?? '', kind: 'ghost' },
    ],
  });
  return res.action === 'yes';
}

/** Choisir la bonne fiche ; la promesse rend la fiche choisie (l'objet reçu), ou `null`. */
export function pickCandidate<T extends CandidateSpec>(items: readonly T[], { title, help = '' }: { title: string; help?: string }): Promise<T | null> {
  const candidates = normalizeCandidates(items);
  return new Promise((resolve) => {
    mount(
      'mire-pick',
      { heading: title, help, candidates },
      { kind: 'pick', items, keys: candidates.map((c) => c.key), resolve: resolve as (item: unknown) => void },
    );
  });
}

function entryLabels(opts: FormOptions, values: FormValues): Record<string, string> {
  if (!opts.entryLabel) return {};
  const out: Record<string, string> = {};
  for (const v of Object.values(values)) if (Array.isArray(v)) for (const x of v) out[x] = opts.entryLabel(x);
  return out;
}

/* ------------------------------------------------------------------ */
/* Actions, saisies, fermeture                                          */
/* ------------------------------------------------------------------ */

function render(entry: FormEntry): void {
  entry.el.values = { ...entry.values };
  entry.el.drafts = { ...entry.drafts };
  entry.el.entryLabels = entryLabels(entry.opts, entry.values);
}

function handle(entry: FormEntry): FormHandle {
  return {
    values: () => formValues(entry.fields, entry.values),
    set(id, value) {
      entry.values[id] = Array.isArray(value) ? [...value] : typeof value === 'boolean' ? value : String(value ?? '');
      render(entry);
    },
    setImage(id, src) {
      entry.values[id] = src ?? '';
      render(entry);
    },
    help(text) {
      entry.el.help = text;
    },
  };
}

// Élément qui avait le focus à l'ouverture d'une boîte, au cas où ds-modal ne l'aurait pas rendu (boîte jamais affichée).
const returnFocusOf = new WeakMap<Element, Element | null>();

/** Ferme une boîte et rend son résultat ; la boîte quitte la page une fois fermée (`mireDialogClose`). */
function finish(id: string, outcome: string | null, picked?: unknown): void {
  const entry = stack.remove(id);
  if (!entry) return;
  if (entry.kind === 'form') entry.resolve({ action: outcome ?? 'cancel', values: formValues(entry.fields, entry.values) });
  else entry.resolve(picked ?? null);
  returnFocusOf.set(entry.el, entry.returnFocus);
  const modal = entry.el.querySelector('ds-modal') as (HTMLElement & { shown?: boolean }) | null;
  if (modal?.shown) void entry.el.close();
  else discard(entry.el, entry.returnFocus);
}

function discard(el: HTMLElement, returnFocus: Element | null): void {
  el.remove();
  const focused = document.activeElement;
  if ((!focused || focused === document.body) && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
}

function onClosed(e: Event): void {
  const el = e.target as DialogElement;
  const id = (e as CustomEvent<{ dialog: string }>).detail?.dialog;
  if (!id || (el.localName !== 'mire-form' && el.localName !== 'mire-pick')) return;
  if (stack.get(id)?.el === el) finish(id, null);
  else discard(el, returnFocusOf.get(el) ?? null);
}

function onInput(e: Event): void {
  const { dialog, field, value, draft } = (e as CustomEvent<{ dialog: string; field?: string; value?: string | boolean; draft?: string }>).detail ?? {};
  const entry = dialog ? stack.get(dialog) : undefined;
  if (entry?.kind !== 'form' || !field) return;
  if (draft !== undefined) entry.drafts[field] = draft;
  else if (value !== undefined) entry.values[field] = value;
}

async function fieldAction(entry: FormEntry, action: string, field: string, value?: string): Promise<void> {
  const list = (entry.values[field] as string[] | undefined) ?? [];
  if (action === 'browse-file' || action === 'browse-folder') {
    const path = await (action === 'browse-file' ? hooks?.pickFile() : hooks?.pickFolder());
    if (path) entry.values[field] = path;
  } else if (action === 'list-add') {
    entry.values[field] = addToList(list, entry.drafts[field] ?? '') ?? list;
    entry.drafts[field] = '';
  } else if (action === 'list-del' && value !== undefined) {
    entry.values[field] = removeFromList(list, value);
  } else if (action === 'list-folder') {
    const path = await hooks?.pickFolder();
    if (path) entry.values[field] = addToList(list, path) ?? list;
  }
  render(entry);
}

/** Action d'un bouton de boîte (contrôleur `mire-dialogs`) : `{ dialog, action, field?, value? }`. */
export async function dialogAction(args: unknown): Promise<void> {
  const a = parseDialogAction(args);
  const entry = a ? stack.get(a.dialog) : undefined;
  if (!a || !entry) return;
  if (entry.kind === 'pick') {
    if (a.action === 'pick') {
      const i = entry.keys.indexOf(a.value ?? '');
      if (i >= 0) finish(a.dialog, 'pick', entry.items[i]);
    } else if (a.action === 'cancel') finish(a.dialog, null);
    return;
  }
  const kind = actionKind(entry.opts.actions, a);
  if (kind === 'field') return fieldAction(entry, a.action, a.field as string, a.value);
  if (kind === 'cancel') return finish(a.dialog, 'cancel');
  if (kind === 'submit') {
    const missing = missingRequired(entry.fields, entry.values);
    if (missing) {
      await entry.el.showInvalid?.(missing);
      return;
    }
  }
  const id = legacyActionId(a);
  const keepOpen = entry.opts.onAction ? await entry.opts.onAction(id, handle(entry)) : false;
  if (!keepOpen) finish(a.dialog, id);
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

type ToasterElement = HTMLElement & { messages: string[]; closingDelay: number; displayToast(): Promise<void>; componentOnReady?(): Promise<unknown> };

let toaster: ToasterElement | null = null;

/** Message bref en bas de l'écran (`ds-toaster`), avec les durées de `toast` : 3,8 s par défaut. */
export async function notify(message: string, opts: NotifyOptions = {}): Promise<void> {
  if (opts.action && hooks?.toastWithAction) {
    hooks.toastWithAction(message, opts);
    return;
  }
  if (!toaster) {
    toaster = document.createElement('ds-toaster') as ToasterElement;
    toaster.setAttribute('position', 'bottom,center');
    toaster.setAttribute('max-displayed-toast', '1');
    (host ?? document.body).appendChild(toaster);
  }
  await customElements.whenDefined('ds-toaster');
  await toaster.componentOnReady?.();
  toaster.closingDelay = toastDuration(opts);
  toaster.messages = [message];
  await toaster.displayToast();
}
