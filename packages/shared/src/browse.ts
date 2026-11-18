/**
 * Parcours par source et par dossier (explorateur, P4-08) : les colonnes Sources et Dossiers. L'interface désigne un
 * dossier par l'identifiant de sa source (ou de son dossier autorisé) et un chemin relatif à celle-ci, jamais par un
 * chemin absolu ; le processus principal vérifie que ce chemin reste dans la source.
 */
import type { PageElement } from './pages.ts';

/** Source du catalogue, ou dossier autorisé, telle que l'explorateur la liste. */
export interface SourceSummary {
  /** Identifiant opaque, donné par le processus principal (`catalog.folder`). */
  id: string;
  /** Plugin de la source (`src-local`…) ; absent pour un dossier autorisé. */
  plugin?: string;
  /** Où elle se trouve, pour l'affichage : chemin, adresse, ou identifiant de l'emplacement. */
  place: string;
  /** Nombre d'éléments. */
  count: number;
}

/** Réponse de `catalog.sources` : les sources du catalogue, et les dossiers autorisés (gestion des fichiers). */
export interface CatalogSources {
  sources: SourceSummary[];
  folders: SourceSummary[];
}

/** Sous-dossier d'un dossier : son nom, son chemin relatif à la source (`a/b`), son nombre d'éléments. */
export interface FolderEntry {
  name: string;
  path: string;
  count: number;
}

/**
 * Réponse de `catalog.folder` : un dossier, par tranches. Les sous-dossiers viennent d'abord, puis les éléments ;
 * `total` les compte tous, et une tranche peut contenir les deux.
 */
export interface FolderLevel {
  source: string;
  /** Chemin relatif à la source ; `''` pour la source elle-même. */
  path: string;
  total: number;
  next: string | null;
  folders: FolderEntry[];
  elements: PageElement[];
}
