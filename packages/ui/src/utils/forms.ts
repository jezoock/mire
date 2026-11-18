/**
 * Logique sans DOM des boîtes de dialogue (P4-06) : description des champs d'un formulaire (celle d'`openForm` de
 * l'interface historique), valeurs, validation, listes, actions des boutons et résultat, fiches à choisir. Partagée
 * par `mire-form`, `mire-pick` et le service des boîtes (`src/renderer/ui/dialogs.ts`) ; testée sous `node:test`
 * (`test/ui/forms.test.ts`).
 */

/** Types de champs : ceux d'`openForm` (texte, liste, image, zone de texte, liste de sources) et l'interrupteur. */
export const FIELD_TYPES = ['text', 'select', 'textarea', 'image', 'list', 'toggle'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Option d'une liste : une valeur, ou `[valeur, libellé]`. */
export type FieldOption = string | [string, string];

/** Champ tel que le décrit l'appelant (même forme que les champs d'`openForm`). */
export interface FieldSpec {
  id: string;
  type?: FieldType;
  label?: string;
  value?: string | boolean | string[] | null;
  placeholder?: string;
  /** Liste (`select`) : ses options ; texte : les propositions (`datalist`). */
  options?: FieldOption[];
  required?: boolean;
  /** Zone de texte : nombre de lignes (4 par défaut). */
  rows?: number;
  /** Le champ prend toute la largeur (toujours pour une zone de texte et une liste de sources). */
  full?: boolean;
  /** Bouton « Parcourir » à côté d'un champ texte : un fichier ou un dossier. */
  browse?: 'file' | 'folder';
  /** Image : aperçu large (fond d'écran). */
  wide?: boolean;
}

/** Bouton d'action : `primary` valide le formulaire (et vérifie les champs obligatoires), `ghost` est discret. */
export interface ActionSpec {
  id: string;
  label: string;
  kind?: 'primary' | 'ghost' | '';
}

/** Onglet d'un panneau à onglets (`ds-panel-group`) : ses propres champs. */
export interface TabSpec {
  id: string;
  label: string;
  fields: FieldSpec[];
}

/** Champ complété : chaque propriété a sa valeur par défaut. */
export interface Field {
  id: string;
  type: FieldType;
  label: string;
  value: string | boolean | string[];
  placeholder: string;
  options: [string, string][];
  required: boolean;
  rows: number;
  full: boolean;
  browse: 'file' | 'folder' | '';
  wide: boolean;
}

export interface Tab {
  id: string;
  label: string;
  fields: Field[];
}

/** Textes des boîtes, tirés des catalogues par le service (`forms.*`) : aucun texte n'est écrit dans un composant. */
export interface FormLabels {
  browse?: string;
  pickImage?: string;
  removeImage?: string;
  noImage?: string;
  add?: string;
  addFolder?: string;
  remove?: string;
  emptyList?: string;
  /** Marque d'un champ obligatoire (`ds-field`). */
  required?: string;
  /** Message d'un champ obligatoire laissé vide. */
  valueMissing?: string;
  /** Nom de la liste des onglets. */
  tabs?: string;
  /** Bouton qui ferme une boîte sans rien choisir (choix d'une fiche). */
  cancel?: string;
}

export type FieldValue = string | boolean | string[];
export type FormValues = Record<string, FieldValue>;

/** Résultat d'une boîte : celui d'`openForm` (`action` : identifiant du bouton, `cancel` si elle a été fermée). */
export interface FormResult {
  action: string;
  values: FormValues;
}

const asText = (value: unknown): string => (value == null ? '' : String(value));

function option(o: FieldOption): [string, string] {
  return Array.isArray(o) ? [asText(o[0]), asText(o[1] ?? o[0])] : [asText(o), asText(o)];
}

/** Complète la description d'un champ (type `text` par défaut, valeur selon le type). */
export function normalizeField(spec: FieldSpec): Field {
  const type: FieldType = FIELD_TYPES.includes(spec.type as FieldType) ? (spec.type as FieldType) : 'text';
  const options = (spec.options ?? []).map(option);
  let value: FieldValue;
  if (type === 'list') value = Array.isArray(spec.value) ? spec.value.map(asText) : [];
  else if (type === 'toggle') value = spec.value === true || spec.value === 'true';
  else if (type === 'select') value = options.some(([v]) => v === asText(spec.value)) ? asText(spec.value) : (options[0]?.[0] ?? '');
  else value = Array.isArray(spec.value) ? '' : asText(spec.value);
  return {
    id: String(spec.id),
    type,
    label: asText(spec.label),
    value,
    placeholder: asText(spec.placeholder),
    options,
    required: !!spec.required,
    rows: Number.isInteger(spec.rows) && (spec.rows as number) > 0 ? (spec.rows as number) : 4,
    full: !!spec.full || type === 'textarea' || type === 'list',
    browse: spec.browse === 'file' || spec.browse === 'folder' ? spec.browse : '',
    wide: !!spec.wide,
  };
}

/** Champs de toute la boîte : ceux du formulaire, puis ceux de chaque onglet. */
export function allFields(fields: Field[], tabs: Tab[]): Field[] {
  return [...fields, ...tabs.flatMap((tab) => tab.fields)];
}

/** Valeurs de départ des champs (images comprises : elles servent à l'aperçu). */
export function initialValues(fields: Field[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.id, Array.isArray(f.value) ? [...f.value] : f.value]));
}

/**
 * Valeurs rendues par la boîte, comme `openForm` : texte sans les espaces du début et de la fin, copie des listes,
 * interrupteurs en booléens ; les images n'y sont pas (l'appelant les reçoit par ses actions `pick:` et `clear:`).
 */
export function formValues(fields: Field[], values: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (f.type === 'image') continue;
    const v = values[f.id];
    if (f.type === 'list') out[f.id] = Array.isArray(v) ? [...v] : [];
    else if (f.type === 'toggle') out[f.id] = v === true;
    else out[f.id] = asText(Array.isArray(v) ? '' : v).trim();
  }
  return out;
}

/** Premier champ obligatoire laissé vide (texte, zone de texte, liste, interrupteur), ou `null`. */
export function missingRequired(fields: Field[], values: FormValues): string | null {
  for (const f of fields) {
    if (!f.required || f.type === 'image') continue;
    const v = values[f.id];
    const empty = Array.isArray(v) ? v.length === 0 : f.type === 'toggle' ? v !== true : asText(v).trim() === '';
    if (empty) return f.id;
  }
  return null;
}

/** Ajoute une entrée à une liste de sources (sans espaces autour, sans doublon, jamais vide) ; `null` si rien ne change. */
export function addToList(list: readonly string[], raw: string): string[] | null {
  const value = asText(raw).trim();
  return value && !list.includes(value) ? [...list, value] : null;
}

/** Retire une entrée d'une liste de sources, désignée par sa valeur (unique dans la liste). */
export function removeFromList(list: readonly string[], value: string): string[] {
  return list.filter((v) => v !== value);
}

/* ------------------------------------------------------------------ */
/* Actions des boutons                                                  */
/* ------------------------------------------------------------------ */

/** Actions des boutons des champs, traitées par le service sans fermer la boîte. */
export const FIELD_ACTIONS = ['browse-file', 'browse-folder', 'list-add', 'list-del', 'list-folder'] as const;
/** Actions des images, transmises à l'appelant comme dans `openForm` (`pick:<champ>`, `clear:<champ>`). */
export const IMAGE_ACTIONS = ['pick', 'clear'] as const;

/**
 * Argument de l'action `act` du contrôleur `mire-dialogs`, écrit par les `ds-trigger` des boîtes : la boîte et le
 * bouton par leur clé (`dialog`, `action`), le champ concerné (`field`), l'entrée d'une liste par sa valeur (`value`).
 */
export interface DialogActionArgs {
  dialog: string;
  action: string;
  field?: string;
  value?: string;
}

/** Lit l'argument d'une action ; `null` s'il ne désigne ni une boîte ni un bouton. */
export function parseDialogAction(args: unknown): DialogActionArgs | null {
  if (!args || typeof args !== 'object') return null;
  const { dialog, action, field, value } = args as Record<string, unknown>;
  if (typeof dialog !== 'string' || !dialog || typeof action !== 'string' || !action) return null;
  const out: DialogActionArgs = { dialog, action };
  if (typeof field === 'string' && field) out.field = field;
  if (typeof value === 'string') out.value = value;
  return out;
}

/** Valeur d'`action` d'un `ds-trigger` de boîte : `act:[{…}]`. */
export function dialogTrigger(args: DialogActionArgs): string {
  return `act:${JSON.stringify([args])}`;
}

/** Identifiant de l'action reçu par l'appelant, comme dans `openForm` : `save`, `pick:poster`, `clear:poster`. */
export function legacyActionId({ action, field }: Pick<DialogActionArgs, 'action' | 'field'>): string {
  return field ? `${action}:${field}` : action;
}

/** Ce que fait un bouton : action d'un champ, bouton qui valide (`submit`), fermeture (`cancel`) ou autre bouton. */
export type ActionKind = 'field' | 'submit' | 'cancel' | 'button';

export function actionKind(actions: readonly ActionSpec[], { action, field }: Pick<DialogActionArgs, 'action' | 'field'>): ActionKind {
  if (field && (FIELD_ACTIONS as readonly string[]).includes(action)) return 'field';
  if (action === 'cancel') return 'cancel';
  return actions.find((a) => a.id === action)?.kind === 'primary' ? 'submit' : 'button';
}

/* ------------------------------------------------------------------ */
/* Choisir la bonne fiche                                               */
/* ------------------------------------------------------------------ */

/** Fiche trouvée en ligne, telle que la donne l'appelant (`pickCandidate` de l'interface historique). */
export interface CandidateSpec {
  /** Clé stable de la fiche (son identifiant chez le fournisseur) ; à défaut, son rang dans la liste reçue. */
  key?: string;
  id?: string | number;
  title?: string;
  year?: string | number;
  sub?: string;
  image?: string;
  /** Image de secours, essayée si la première ne se charge pas. */
  fallback?: string;
}

export interface Candidate {
  key: string;
  title: string;
  sub: string;
  image: string;
  fallback: string;
}

/** Fiches complétées, chacune avec une clé unique (celle de la fiche, son identifiant, sinon son rang). */
export function normalizeCandidates(items: readonly CandidateSpec[]): Candidate[] {
  const seen = new Set<string>();
  return items.map((c, n) => {
    let key = asText(c.key ?? c.id ?? n) || String(n);
    if (seen.has(key)) key = `${key}#${n}`;
    seen.add(key);
    return {
      key,
      title: asText(c.title),
      sub: [c.year, c.sub].filter((x) => x != null && x !== '').join(', '),
      image: asText(c.image),
      fallback: asText(c.fallback),
    };
  });
}

/** Image à essayer après l'échec de `failed` : la vignette de secours une fois, puis aucune (l'initiale reste). */
export function nextCandidateImage(c: Pick<Candidate, 'image' | 'fallback'>, failed: string): string {
  return failed === c.image && c.fallback && c.fallback !== c.image ? c.fallback : '';
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

/** Durée d'une notification, comme `toast` : 3,8 s par défaut, au moins 7 s quand elle a un bouton. */
export function toastDuration({ duration, action }: { duration?: number; action?: string } = {}): number {
  const d = Number.isFinite(duration) && (duration as number) > 0 ? (duration as number) : 3800;
  return action ? Math.max(d, 7000) : d;
}
