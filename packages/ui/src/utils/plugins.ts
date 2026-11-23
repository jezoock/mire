/**
 * Centre, plugins et dépôts (P4-19) : ce qu'affiche `mire-centre-view` dans ses onglets Plugins et Dépôts, déjà rédigé
 * par la page (`src/renderer/centre/plugins.ts`). Sans DOM. Tous les textes venus d'un index ou d'un manifeste sont
 * des textes : la vue les place comme contenu, jamais comme HTML, et n'en fait ni lien ni image.
 */
import type { AppProgress } from './centre.ts';

/** Une ligne d'une liste de la fiche : texte, et `sensitive` pour ce qui donne un accès étendu à l'ordinateur. */
export interface PluginLine {
  text: string;
  sensitive: boolean;
}

/** Actions des boutons d'une carte ou d'une fiche de plugin (méthodes du contrôleur `mire-centre`). */
export type PluginAction = 'openPlugin' | 'installPlugin' | 'updatePlugin' | 'enablePlugin' | 'disablePlugin' | 'uninstallPlugin';

/** Un bouton d'une carte ou d'une fiche : l'action du contrôleur `mire-centre` et ses arguments (JSON). */
export interface PluginButton {
  action: PluginAction;
  args: string;
  label: string;
  /** Style : `stl-1` (principal), `stl-2`, `stl-3` (discret). */
  style: 'stl-1' | 'stl-2' | 'stl-3';
  disabled: boolean;
}

/** Une carte des listes de plugins (mises à jour, installés, disponibles). */
export interface PluginCard {
  /** Clé stable : l'identifiant d'un plugin présent, `<dépôt>/<identifiant>` d'un plugin proposé. */
  key: string;
  name: string;
  /** Version, origine ou dépôt, niveau. */
  meta: string;
  desc: string;
  /** Badges : « Tiers », « Accès étendu »… */
  badges: string[];
  /** État (« Actif », « Désactivé », « Mise à jour : 1.2.0 »…) et son genre, pour la couleur. */
  status: string;
  tone: 'ok' | 'off' | 'warn' | 'error' | '';
  progress: AppProgress | null;
  buttons: PluginButton[];
}

/** Une ligne « intitulé : valeur » de la fiche. */
export interface PluginFact {
  label: string;
  value: string;
}

/** Fiche d'un plugin : tout ce qu'il faut savoir avant de l'installer, de le mettre à jour ou de le garder. */
export interface PluginSheet {
  key: string;
  name: string;
  desc: string;
  badges: string[];
  facts: PluginFact[];
  /** Ce que le plugin apporte (natures de contributions, rédigées). */
  contributes: string[];
  permissions: PluginLine[];
  dependencies: string[];
  /** Avertissement renforcé (plugin tiers de code sensible), sinon vide. */
  warning: string;
  /** Message d'erreur ou de refus du plugin présent, sinon vide. */
  message: string;
  progress: AppProgress | null;
  buttons: PluginButton[];
}

/** L'onglet des plugins : listes, ou la fiche ouverte. `null` tant que les listes ne sont pas lues. */
export interface PluginsView {
  /** Date de la dernière mise à jour des listes des dépôts, déjà rédigée (ou « jamais »). */
  checked: string;
  updates: PluginCard[];
  installed: PluginCard[];
  available: PluginCard[];
  /** Fonctions d'une installation existante reprises par des plugins (P5-01) : une ligne chacune, `sensitive` si
   *  la reprise est impossible. Vide : la partie n'est pas montrée. */
  continuity: PluginLine[];
  sheet: PluginSheet | null;
}

/** Une carte de dépôt. */
export interface RepoCard {
  id: string;
  name: string;
  badge: string;
  index: string;
  /** Empreinte de la clé, en groupes de quatre caractères. */
  fingerprint: string;
  /** Date de la liste des plugins utilisée, déjà rédigée. */
  date: string;
  /** Erreur de la dernière mise à jour (la liste en cache sert alors), sinon vide. */
  error: string;
  removable: boolean;
}

export interface ReposView {
  repos: RepoCard[];
}

/** Clé d'un plugin proposé par un dépôt (un même plugin peut être proposé par plusieurs dépôts). */
export const offerKey = (repository: string, id: string): string => `${repository}/${id}`;

/** Empreinte en groupes de quatre caractères, plus facile à comparer à l'œil : `8aaa 3d58 …`. */
export const groupFingerprint = (fingerprint: string): string => (fingerprint.match(/.{1,4}/g) ?? []).join(' ');

/** Arguments JSON d'une action à un seul objet. */
export const actionArgs = (arg: Record<string, string>): string => JSON.stringify([arg]);
