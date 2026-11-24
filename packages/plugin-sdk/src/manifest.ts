/**
 * Manifeste d'un plugin (`mire-plugin.json`, architecture cible, « Manifeste ») : types et listes fermées. Le schéma
 * JSON (`schema/mire-plugin.schema.json`) et le validateur (`validate.ts`) en découlent ; un test les garde d'accord.
 */
import type { InfoDeclaration } from './contributions.ts';

/** Nom du fichier du manifeste, à la racine du plugin. */
export const MANIFEST_FILE = 'mire-plugin.json';

/** Champs du manifeste, liste fermée. `$schema` sert seulement aux éditeurs. */
export const MANIFEST_FIELDS = ['$schema', 'id', 'version', 'engines', 'level', 'contributes', 'permissions', 'dependencies', 'settings', 'i18n'] as const;
export const REQUIRED_FIELDS = ['id', 'version', 'engines', 'level', 'contributes', 'i18n'] as const;

/**
 * Niveaux de sécurité (D-18) : `data`, rien ne s'exécute ; `code`, du JavaScript dans l'hôte isolé ; `privileged`,
 * du code dans le processus principal (dépôt officiel, ou accord explicite de l'utilisateur).
 */
export const PLUGIN_LEVELS = ['data', 'code', 'privileged'] as const;
export type PluginLevel = (typeof PLUGIN_LEVELS)[number];

/** Contributions de code : chaque entrée a un fichier `main`. */
export const CODE_CONTRIBUTIONS = ['sources', 'metadata', 'taggers', 'search', 'subtitles', 'webExtensions', 'downloaders'] as const;
/** Contributions de données : chaque entrée a un fichier `file` (JSON ou ressource), jamais de `main`. */
export const DATA_CONTRIBUTIONS = ['webApps', 'apps', 'systems', 'packs', 'pages', 'themes', 'palettes', 'languages', 'gamepads'] as const;
/** Toutes les contributions, liste fermée. */
export const CONTRIBUTION_KINDS = [...CODE_CONTRIBUTIONS, ...DATA_CONTRIBUTIONS] as const;

export type CodeContributionKind = (typeof CODE_CONTRIBUTIONS)[number];
export type DataContributionKind = (typeof DATA_CONTRIBUTIONS)[number];
export type ContributionKind = CodeContributionKind | DataContributionKind;

/**
 * Niveau minimal de chaque contribution de code : les extensions des vues web et les moteurs de téléchargement sont
 * du code sensible (D-18).
 */
export const CONTRIBUTION_LEVEL: Readonly<Record<CodeContributionKind, PluginLevel>> = {
  sources: 'code',
  metadata: 'code',
  taggers: 'code',
  search: 'code',
  subtitles: 'code',
  webExtensions: 'privileged',
  downloaders: 'privileged',
};

/**
 * Permissions, liste fermée : `hosts` (hôtes Internet), `folders` (dossiers demandés à l'utilisateur quand le plugin
 * en a besoin), puis les permissions sensibles, réservées au niveau `privileged` : réseau local, lancement de
 * programmes, vues web, suppression de fichiers.
 */
export const PERMISSIONS = ['hosts', 'folders', 'localNetwork', 'launch', 'webViews', 'deleteFiles'] as const;
export type PermissionName = (typeof PERMISSIONS)[number];
export const PRIVILEGED_PERMISSIONS = ['localNetwork', 'launch', 'webViews', 'deleteFiles'] as const satisfies readonly PermissionName[];

/** Types de réglage d'un plugin : ceux du schéma des réglages de Mire (P1-26), sans les composants du cœur. */
export const SETTING_TYPES = ['text', 'secret', 'choice', 'toggle', 'path', 'list'] as const;
export type PluginSettingType = (typeof SETTING_TYPES)[number];

/** Champs d'un réglage, liste fermée. */
export const SETTING_FIELDS = ['key', 'type', 'default', 'options'] as const;

/** Types de valeur d'une info (repris d'`InfoType`), et champs de sa déclaration (`InfoDeclaration`). */
export const INFO_TYPES = ['text', 'number', 'boolean', 'list'] as const;
export const INFO_FIELDS = ['type', 'searchable'] as const;

/**
 * Champs permis dans une entrée de `contributes`, par nature (liste fermée). Toutes ont un `id` ; les contributions
 * de code ont un `main`, celles de données un `file`. `tags` et `infos` déclarent les tags et les infos que la
 * contribution pose (nom affiché : `tags.<id>` et `infos.<id>` dans les textes du plugin).
 */
export const CONTRIBUTION_FIELDS: Readonly<Record<ContributionKind, readonly string[]>> = {
  sources: ['id', 'main', 'tags', 'infos'],
  metadata: ['id', 'main', 'kinds', 'infos'],
  taggers: ['id', 'main', 'tags', 'infos'],
  search: ['id', 'main'],
  subtitles: ['id', 'main'],
  webExtensions: ['id', 'main'],
  downloaders: ['id', 'main'],
  webApps: ['id', 'file'],
  apps: ['id', 'file'],
  systems: ['id', 'file'],
  packs: ['id', 'file'],
  pages: ['id', 'file'],
  themes: ['id', 'file'],
  palettes: ['id', 'file'],
  languages: ['id', 'file'],
  gamepads: ['id', 'file'],
};

/** Natures d'éléments qu'une contribution `metadata` peut décrire (`MetadataKind`). */
export const METADATA_KINDS = ['video', 'album', 'rom', 'pc'] as const;

/** Entrée d'une contribution de code. */
export interface CodeContribution {
  /** Identifiant de la contribution, unique dans sa nature (minuscules, chiffres, tirets). */
  id: string;
  /** Fichier JavaScript, relatif au dossier du plugin. */
  main: string;
}

export interface SourceContribution extends CodeContribution {
  /** Tags de source posés sur tous ses éléments. */
  tags?: string[];
  infos?: Record<string, InfoDeclaration>;
}

export interface MetadataContribution extends CodeContribution {
  kinds: (typeof METADATA_KINDS)[number][];
  infos?: Record<string, InfoDeclaration>;
}

export interface TaggerContribution extends CodeContribution {
  tags?: string[];
  infos?: Record<string, InfoDeclaration>;
}

/** Entrée d'une contribution de données. */
export interface DataContribution {
  id: string;
  /** Fichier de données, relatif au dossier du plugin. */
  file: string;
}

export interface PluginContributions {
  sources?: SourceContribution[];
  metadata?: MetadataContribution[];
  taggers?: TaggerContribution[];
  search?: CodeContribution[];
  subtitles?: CodeContribution[];
  webExtensions?: CodeContribution[];
  downloaders?: CodeContribution[];
  webApps?: DataContribution[];
  apps?: DataContribution[];
  systems?: DataContribution[];
  packs?: DataContribution[];
  pages?: DataContribution[];
  themes?: DataContribution[];
  palettes?: DataContribution[];
  languages?: DataContribution[];
  gamepads?: DataContribution[];
}

export interface PluginPermissions {
  /** Hôtes Internet joints (`api.themoviedb.org`, ou `*.example.com` pour ses sous-domaines). */
  hosts?: string[];
  /** Le plugin demandera à l'utilisateur l'accès à des dossiers. */
  folders?: boolean;
  localNetwork?: boolean;
  launch?: boolean;
  webViews?: boolean;
  deleteFiles?: boolean;
}

/** Réglage d'un plugin ; son libellé est `settings.<key>.label` dans les textes du plugin. */
export interface PluginSetting {
  key: string;
  type: PluginSettingType;
  default?: string | number | boolean | string[];
  /** Valeurs d'un réglage `choice` ; libellés : `settings.<key>.options.<valeur>`. */
  options?: string[];
}

export interface PluginManifest {
  $schema?: string;
  /** Identifiant en notation inversée (`org.exemple.radios`) ; le préfixe `mire.` est réservé au dépôt officiel. */
  id: string;
  /** Version du plugin (semver : `1.2.0`). */
  version: string;
  /** Versions de Mire compatibles (plage semver : `^1.0.0`). */
  engines: { mire: string };
  level: PluginLevel;
  contributes: PluginContributions;
  permissions?: PluginPermissions;
  /** Plugins requis : identifiant → plage de versions. */
  dependencies?: Record<string, string>;
  settings?: PluginSetting[];
  /**
   * Dossier des textes, relatif au plugin : un catalogue par langue (`en.json`, `fr.json`), au format de ceux de
   * Mire. L'anglais est obligatoire (avec `plugin.name`), le français aussi pour le dépôt officiel.
   */
  i18n: string;
}
