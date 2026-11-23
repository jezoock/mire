/**
 * Assistant du premier lancement (P4-23) : ce qu'affiche `mire-assistant-view`, déjà rédigé par la page
 * (`src/renderer/assistant/`). Sans DOM. Les noms et descriptions des plugins viennent d'un index : ce sont des textes,
 * que la vue place comme contenu, jamais comme HTML.
 */
import type { PluginLine } from './plugins.ts';

/** Choix d'une étape : une famille (`toggleUse`), une box (`chooseBox`, une seule), un service (`toggleService`). */
export type AssistantChoiceAction = 'toggleUse' | 'chooseBox' | 'toggleService';

export interface AssistantChoice {
  /** Clé stable : la famille, ou l'identifiant du plugin (`''` : aucune box). */
  key: string;
  label: string;
  description: string;
  pressed: boolean;
  action: AssistantChoiceAction;
}

/** Un plugin du récapitulatif ou de l'installation. */
export interface AssistantItem {
  /** Identifiant du plugin. */
  key: string;
  name: string;
  /** Pourquoi il est là (« Langue », « Nécessaire à … »). */
  reason: string;
  /** Ce qu'il demande (permissions), ou une ligne « aucune permission particulière ». */
  lines: PluginLine[];
  /** « Tiers », « Accès étendu, accord demandé »… */
  badges: string[];
  /** État pendant l'installation, sinon vide. */
  status: string;
  tone: 'ok' | 'error' | 'busy' | 'off' | '';
  /** Avancement du téléchargement (0 à 1), ou `null`. */
  progress: number | null;
}

/** Textes des boutons de l'étape (absent : bouton non affiché). */
export interface AssistantButtons {
  start?: string;
  back?: string;
  next?: string;
  install?: string;
  skip?: string;
  finish?: string;
  openCentre?: string;
}

export interface AssistantView {
  /** Étape affichée (`welcome`, `language`, `uses`, `box`, `services`, `summary`, `install`, `done`). */
  step: string;
  /** « Étape 2 sur 5 », ou vide. */
  progress: string;
  title: string;
  paragraphs: string[];
  /** Nom du groupe de choix (pour les lecteurs d'écran). */
  choicesLabel: string;
  /** `radio` : un seul choix (la box) ; `toggle` : plusieurs. */
  choiceMode: 'radio' | 'toggle';
  choices: AssistantChoice[];
  itemsLabel: string;
  items: AssistantItem[];
  /** Lecture ou installation en cours : texte affiché à la place des boutons de navigation. */
  busy: string;
  buttons: AssistantButtons;
}
