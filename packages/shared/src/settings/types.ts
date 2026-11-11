/**
 * Types du schéma des réglages (`@mire/shared/settings/schema`). Fichier sans code : il est ré-exporté par
 * `export type *` (un `export *` le chargerait comme module CommonJS sous Node 24).
 */

/**
 * Texte affiché à l'utilisateur. En français tant que la localisation (P1-28) n'existe pas ; il sera ensuite
 * remplacé par la clé de catalogue tirée des identifiants (voir `settingsTextKey`).
 */
export type SettingsText = string;

/** Types de champ admis. */
export type SettingsFieldType = 'text' | 'secret' | 'choice' | 'toggle' | 'path' | 'list' | 'custom';

interface FieldBase {
  /** Identifiant stable dans son bloc (sert aussi de clé de catalogue). */
  id: string;
  label: SettingsText;
  help?: SettingsText;
}

/** Champ lié à un chemin de la configuration (`ui.home.clock`), avec sa valeur par défaut. */
interface PathField<T> extends FieldBase {
  path: string;
  /** Doit être la valeur de `DEFAULT_CONFIG` au même chemin (vérifié par les tests). */
  default: T;
}

export interface TextField extends PathField<string> {
  type: 'text';
  placeholder?: SettingsText;
}

/** Texte masqué à la saisie (clé, jeton). */
export interface SecretField extends PathField<string> {
  type: 'secret';
  placeholder?: SettingsText;
}

export interface ChoiceOption {
  value: string;
  label: SettingsText;
}

/** Liste de choix. `optionsFrom` : options ajoutées selon la configuration (identifiant connu de l'interface). */
export interface ChoiceField extends PathField<string> {
  type: 'choice';
  options: ChoiceOption[];
  optionsFrom?: string;
}

/** Case à cocher. */
export interface ToggleField extends PathField<boolean> {
  type: 'toggle';
}

/** Chemin sur l'ordinateur : programme à lancer ou dossier, avec un bouton « Parcourir ». */
export interface PathPickerField extends PathField<string> {
  type: 'path';
  pick: 'program' | 'folder';
  placeholder?: SettingsText;
}

/** Liste de textes (adresses, sites) qu'on ajoute ou retire un à un. */
export interface ListField extends PathField<string[]> {
  type: 'list';
  placeholder?: SettingsText;
}

/**
 * Bloc personnalisé : rendu par un composant de l'interface désigné par son identifiant (thèmes, listes
 * ordonnables, sources, boutique, consoles…). `paths` : chemins de la configuration qu'il modifie.
 */
export interface CustomField extends FieldBase {
  type: 'custom';
  component: string;
  paths: string[];
}

export type SettingsField = TextField | SecretField | ChoiceField | ToggleField | PathPickerField | ListField | CustomField;

/** Bloc de réglages : un titre, un texte d'aide, des champs. */
export interface SettingsBlock {
  id: string;
  title: SettingsText;
  help?: SettingsText;
  fields: SettingsField[];
}

export type SettingsSchema = readonly SettingsBlock[];
