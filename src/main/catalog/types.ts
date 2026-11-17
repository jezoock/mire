/**
 * Types internes du catalogue d'éléments. Les types de l'élément lui-même (`Element`, `OpenSpec`, `InfoValue`…) sont
 * dans `@mire/shared` ; la source d'éléments (`ElementSource`, contribution `sources`) et l'élément qu'elle donne
 * (`ElementInput`) sont publiés dans le SDK des plugins (P3-01), d'où ils sont repris ici.
 */
import type { Element, ElementKey, ElementSourceRef } from '@mire/shared';

export type { ElementInput, ElementSource } from '@mire/plugin-sdk';

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
