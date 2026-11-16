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
  /** Date de la dernière analyse (millisecondes depuis 1970). */
  scanned: number;
  elements: Element[];
}
