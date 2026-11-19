/**
 * Écran Réglages (P4-20), sans DOM : ce que la vue `mire-settings-view` reçoit, déjà rédigé par la page
 * (`src/renderer/settings/`) d'après le schéma des réglages (`@mire/shared/settings/schema`) et les manifestes des
 * plugins. Chaque champ est désigné par sa clé : le chemin de la configuration (`ui.home.clock`), ou
 * `plugin:<id>:<réglage>` pour le réglage d'un plugin.
 */

/** Option d'une liste de choix ; `group` : intitulé du groupe d'options (« Directement sur un service »). */
export interface SettingsOptionView {
  value: string;
  label: string;
  group?: string;
}

/** Palette proposée (aperçu dessiné avec ses propres jetons, `data-palette`). */
export interface PaletteView {
  id: string;
  name: string;
  /** Palettes de l'aperçu : une seule, ou les deux d'« Automatique » (sombre, clair). */
  preview: string[];
  current: boolean;
}

/** Thème des pages proposé. */
export interface PageThemeView {
  id: string;
  name: string;
  description: string;
  current: boolean;
}

/** Ligne d'une liste ordonnable : valeur, nom, couleur de la pastille, choisie ou non. */
export interface OrderItemView {
  id: string;
  label: string;
  color: string;
  on: boolean;
}

/**
 * Liste ordonnable (`ds-sortable`) : `kind` la désigne auprès du contrôleur (`rows`, `bars`, `sites` de l'accueil,
 * `providers` des infos). Avec `toggle`, les valeurs non choisies sont proposées à part, avec « Ajouter ».
 */
export interface OrderListView {
  kind: string;
  label: string;
  items: OrderItemView[];
  toggle: boolean;
}

export type SettingsFieldKind = 'text' | 'secret' | 'choice' | 'segmented' | 'toggle' | 'path' | 'list' | 'themes' | 'order' | 'entries' | 'link';

/** Ligne d'une liste d'éléments (source, site, jeu, service) ; `sub` : détail, `error` s'il signale un problème. */
export interface SettingsEntryView {
  id: string;
  label: string;
  sub?: string;
  error?: boolean;
  /** Liste à choix (`choose`) : la ligne choisie. */
  current?: boolean;
  /** Bouton « Revenir à l'origine » (`restoreEntry`) : une page prête à l'emploi modifiée (P4-21). */
  restore?: boolean;
  /** Pas de bouton « Retirer » sur cette ligne, même si la liste en a (un tag du cœur, P4-21). */
  keep?: boolean;
}

/** Actions des boutons d'une liste d'éléments (méthodes du contrôleur `mire-settings`, écrites telles quelles par la vue). */
export type SettingsEntryAction = 'addEntry' | 'addSourceFolder' | 'addSourceAddress' | 'addPcGame' | 'detectTvBox' | 'reloadTv' | 'createEntry';

export interface SettingsEntryButton {
  label: string;
  action: SettingsEntryAction;
  ghost?: boolean;
}

/** Champ à remplir avant « Ajouter » (`addEntry`) ; son brouillon a pour clé `<clé de la liste>.<id>`. */
export interface SettingsEntryInput {
  id: string;
  label: string;
  placeholder?: string;
}

/**
 * Liste d'éléments d'un bloc propre aux pages : `key` la désigne auprès du contrôleur (`sources:video`, `web`,
 * `games`, `pcSites`, `tv`). Avec `remove`, chaque ligne a son bouton « Retirer » (`removeEntry`) ; avec `choose`,
 * une ligne se choisit (bouton radio, `mireSettingChange` avec la clé `<key>.active`).
 */
export interface SettingsEntryGroup {
  key: string;
  label?: string;
  entries: SettingsEntryView[];
  empty: string;
  remove?: boolean;
  /** Chaque ligne a son bouton « Modifier » (`editEntry`), qui ouvre une boîte de dialogue (pages, P4-21). */
  edit?: boolean;
  choose?: boolean;
  inputs?: SettingsEntryInput[];
  buttons?: SettingsEntryButton[];
}

/** Lien vers un onglet du Centre (`openCentreTab`), là où un bloc se règle déjà. */
export interface SettingsLinkView {
  tab: string;
  label: string;
}

export interface SettingsFieldView {
  /** Clé du champ : chemin de la configuration, ou `plugin:<id>:<réglage>`. */
  key: string;
  kind: SettingsFieldKind;
  label: string;
  help?: string;
  placeholder?: string;
  /** Valeur : texte, oui ou non, liste de textes ; un secret saisi n'est jamais donné (`secretSet`). */
  value?: string | boolean | string[];
  secretSet?: boolean;
  options?: SettingsOptionView[];
  /** `path` : programme ou dossier. */
  pick?: 'program' | 'folder';
  /** `themes`. */
  palettes?: PaletteView[];
  pageThemes?: PageThemeView[];
  /** `order` : une ou plusieurs listes. */
  lists?: OrderListView[];
  /** `entries` : une ou plusieurs listes d'éléments. */
  groups?: SettingsEntryGroup[];
  /** `link` : lien vers un onglet du Centre. */
  link?: SettingsLinkView;
}

/** Actions des boutons d'un panneau (méthodes du contrôleur `mire-settings`, écrites telles quelles par la vue). */
export type SettingsPanelAction = 'rescan' | 'scrapeAll' | 'clearScrape' | 'updateFilterLists' | 'exportConfig' | 'importConfig' | 'revealConfig';

/** Bouton d'action d'un panneau ; `mode` : celui de `importConfig` (`replace` ou `merge`). */
export interface SettingsActionView {
  label: string;
  action: SettingsPanelAction;
  mode?: 'replace' | 'merge';
  /** Bouton secondaire (contour). */
  ghost?: boolean;
}

export interface SettingsPanelView {
  /** Identifiant du bloc (`appearance`), ou `plugin:<id>`. */
  id: string;
  title: string;
  help?: string;
  fields: SettingsFieldView[];
  /** Informations rédigées (état du bloqueur, de la lecture protégée, chemin du fichier de configuration). */
  notes?: string[];
  actions?: SettingsActionView[];
  /** Éditeur JSON « Sites, jeux et consoles » : son texte ; il garde son bouton « Enregistrer ». */
  json?: string;
}

/** Textes de la vue, tirés des catalogues (`settingsView`). */
export interface SettingsLabels {
  browse?: string;
  add?: string;
  remove?: string;
  edit?: string;
  restore?: string;
  empty?: string;
  secretSet?: string;
  current?: string;
  save?: string;
  show?: string;
  hide?: string;
  hidden?: string;
  /** Textes de `ds-sortable` (JSON). */
  sortable?: string;
}

/** Arguments d'une action `ds-trigger` vers `mire-settings` (`méthode:[argument]`). */
export const settingsArgs = (args: Record<string, unknown>): string => JSON.stringify([args]);

/** Identifiant d'élément tiré d'une clé (`ui.home.clock` → `set-ui-home-clock`), pour lier libellé et champ. */
export const settingsDomId = (key: string): string => `set-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** Clé du réglage d'un plugin ; et l'inverse (`null` pour un chemin de la configuration). */
export const pluginFieldKey = (plugin: string, key: string): string => `plugin:${plugin}:${key}`;
export function parsePluginFieldKey(key: string): { plugin: string; key: string } | null {
  const m = /^plugin:([^:]+):(.+)$/.exec(key);
  return m ? { plugin: m[1] as string, key: m[2] as string } : null;
}

/** Valeurs choisies d'une liste après un nouvel ordre des choisies (`ds-sortable`) : les autres ne bougent pas. */
export function reorder(items: readonly OrderItemView[], keys: readonly string[]): OrderItemView[] {
  const on = keys.map((k) => items.find((x) => x.id === k && x.on)).filter((x): x is OrderItemView => !!x);
  return [...on, ...items.filter((x) => !on.includes(x))];
}
