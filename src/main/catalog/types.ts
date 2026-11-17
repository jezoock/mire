/**
 * Types internes du catalogue d'éléments. Les types de l'élément lui-même (`Element`, `OpenSpec`, `InfoValue`…) sont
 * dans `@mire/shared` ; les interfaces des sources, des tags automatiques et des infos en ligne viendront ici
 * (phase 2), avant d'être publiées dans le SDK des plugins (phase 3).
 */
import type { Element, ElementKey, ElementSourceRef } from '@mire/shared';

/** Élément tel qu'une source le donne : le catalogue y ajoute sa source et sa date d'ajout. */
export type ElementInput = Omit<Element, 'source' | 'added'> & { added?: number };

/** Changements du catalogue après une analyse : clés des éléments ajoutés, changés et retirés. */
export interface CatalogChange {
  added: ElementKey[];
  changed: ElementKey[];
  removed: ElementKey[];
}

export type CatalogListener = (change: CatalogChange) => void;

/** Fichier d'un emplacement de source (`userData/catalog/sources/`) : résultat de sa dernière analyse. */
export interface SourceFile {
  version: number;
  source: ElementSourceRef;
  /** Date de la dernière analyse qui a changé l'emplacement (millisecondes depuis 1970). */
  scanned: number;
  elements: Element[];
}

/**
 * Source d'éléments (architecture cible, contribution `sources`) : ce qui trouve des éléments dans des emplacements
 * configurés (dossier, serveur, liste…) et les donne au catalogue. Elle reste du code interne en phase 2 ; la phase 3
 * la publiera dans le SDK des plugins.
 *
 * `Location` est l'emplacement tel que la source le reçoit de sa configuration.
 */
export interface ElementSource<Location> {
  /** Identifiant de la source : celui du plugin qu'elle deviendra (`src-local`, `src-http`…). */
  readonly id: string;
  /** Tags de source : posés sur tous les éléments de la source (`remote` pour un serveur web…). */
  readonly tags: readonly string[];
  /** Vrai si la source sait analyser cet emplacement (emplacements gérés). */
  handles(location: Location): boolean;
  /** Identifiant stable de l'emplacement : l'`instance` de la source des éléments. */
  instance(location: Location): string;
  /**
   * Analyse d'un emplacement : la liste complète de ses éléments. Lève une erreur au message affichable si
   * l'emplacement est inaccessible (le catalogue garde alors les éléments de l'analyse précédente).
   */
  scan(location: Location): Promise<ElementInput[]>;
}
