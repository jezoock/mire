/**
 * Logique sans DOM de l'explorateur (P4-08) : ce que `mire-explorer-view` affiche (colonnes, lignes, aperçu) et les
 * arguments de ses actions. Les textes arrivent déjà rédigés par la page (`src/renderer/explorer/`).
 */

/**
 * Ligne d'une colonne : une branche (`node` : la colonne qu'elle ouvre) ou un élément du catalogue (`key`). `id` est
 * unique dans la colonne et stable : le nœud ou la clé.
 */
export interface ExplorerRow {
  id: string;
  node?: string;
  key?: string;
  label: string;
  /** Nombre d'éléments d'une branche, s'il est connu. */
  count?: number;
  /** Élément d'une liste disparu du catalogue : il ne s'ouvre pas. */
  unavailable?: boolean;
}

/** Colonne : son nœud, son titre, ses lignes (chargées par tranches) et la ligne choisie. */
export interface ExplorerColumn {
  node: string;
  heading: string;
  rows: ExplorerRow[];
  /** Nombre total de lignes du niveau, et combien restent à charger. */
  total: number;
  remaining: number;
  /** Texte du bouton qui charge la tranche suivante (« Afficher plus (12 restants) ») ; vide s'il ne reste rien. */
  more: string;
  /** `id` de la ligne choisie (celle dont la colonne suivante ou l'aperçu est affiché). */
  selected: string | null;
}

/** Aperçu d'un élément : image, nom, infos, tags, source, emplacement, et ce qu'on peut en faire. */
export interface ExplorerPreview {
  key: string;
  name: string;
  /** Image (affiche, sinon fond) ; vide s'il n'y en a pas. */
  image: string;
  /** Infos : libellé et valeur, déjà rédigés. */
  facts: { label: string; value: string }[];
  tags: string[];
  source: string;
  /** Emplacement du fichier ou adresse ; vide s'il n'y en a pas. */
  location: string;
  /** Faux pour un élément indisponible. */
  playable: boolean;
  /**
   * Gestion du fichier (P4-09) : renommer, déplacer, supprimer ne sont permis que dans les dossiers autorisés ;
   * sinon les actions sont désactivées et `reason` dit pourquoi.
   */
  files?: { allowed: boolean; reason: string };
}

/** Barre de la sélection multiple (P4-09) : textes déjà rédigés. */
export interface ExplorerSelection {
  /** « 3 éléments choisis ». */
  count: string;
  /** Raison pour laquelle « Supprimer » est désactivé ; vide s'il est permis. */
  blocked: string;
  /** Contrôle des fichiers en cours : « Supprimer » attend. */
  checking?: boolean;
}

/** Textes de l'explorateur, tirés des catalogues par la page (attribut `labels`, JSON). */
export interface ExplorerLabels {
  /** Nom de la zone des colonnes, de l'aperçu, et texte d'une colonne vide. */
  columns?: string;
  preview?: string;
  empty?: string;
  /** Titres des parties de l'aperçu. */
  infos?: string;
  tags?: string;
  noTags?: string;
  source?: string;
  location?: string;
  /** Actions de l'aperçu. */
  play?: string;
  edit?: string;
  editTags?: string;
  addToList?: string;
  unavailable?: string;
  /** Gestion des fichiers (P4-09) : actions de l'aperçu et titre de la raison quand elles sont désactivées. */
  rename?: string;
  move?: string;
  remove?: string;
  filesBlocked?: string;
  /** Sélection multiple : nom de la barre, état d'une ligne choisie, actions. */
  selection?: string;
  picked?: string;
  addTag?: string;
  removeTag?: string;
  toList?: string;
  removePicked?: string;
  clearPicks?: string;
}

/** Arguments d'une action de l'explorateur : `[{"node":"pages"}]`, `[{"key":"local:/a.mkv"}]`. */
export const explorerArgs = (args: Record<string, string>): string => JSON.stringify([args]);
