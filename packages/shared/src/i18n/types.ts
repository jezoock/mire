/** Types des catalogues de textes et du moteur de traduction. */

/** Catégories de pluriel d'`Intl.PluralRules`. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Texte au pluriel : une forme par catégorie de la langue, `other` toujours présente. */
export type PluralMessage = Partial<Record<PluralCategory, string>> & { other: string };

/** Arbre de textes : clés hiérarchiques par domaine (`library.errors.folderNotFound`). */
export interface Messages {
  [key: string]: string | PluralMessage | Messages;
}

/** Métadonnées d'un catalogue, reprises telles quelles par les packs de langue. */
export interface CatalogMeta {
  /** Code BCP 47 de la langue (`fr`, `en`, `pt-BR`). */
  code: string;
  /** Nom de la langue dans cette langue (`Français`, `English`). */
  name: string;
  /** Version de Mire dont le catalogue couvre les textes. */
  app: string;
}

/** Catalogue d'une langue (`locales/<code>.json`). */
export interface Catalog {
  meta: CatalogMeta;
  messages: Messages;
}

/** Valeurs à insérer dans un texte (`{nom}`) ; `count` choisit aussi la forme du pluriel. */
export type Vars = Record<string, string | number>;

export interface I18nOptions {
  /** Langue choisie (code BCP 47). */
  locale: string;
  /** Catalogues disponibles, par code de langue. */
  catalogs: Record<string, Catalog>;
  /** Langues de repli, dans l'ordre ; par défaut l'anglais puis le français. */
  fallback?: string[];
  /** Clé absente de toutes les langues ; appelé une fois par clé. Par défaut : rien (production). */
  onMissing?: (key: string, locale: string) => void;
}

export interface I18n {
  /** Langue choisie. */
  readonly locale: string;
  /** Langues consultées, dans l'ordre (langue choisie, puis repli), sans doublon ni catalogue absent. */
  readonly chain: readonly string[];
  /** Texte de la clé, variables insérées ; la clé elle-même si aucune langue ne la connaît. */
  t(key: string, vars?: Vars): string;
  /** Vrai si une des langues de la chaîne connaît la clé. */
  has(key: string): boolean;
  /** Date (jour, mois, année), `Intl.DateTimeFormat` ; `options` remplace le style par défaut. */
  formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Heure (heures et minutes). */
  formatTime(date: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Nombre selon les conventions de la langue. */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** Taille en octets, en base 1024 (`1,5 Go`, `1.5 GB`). */
  formatSize(bytes: number): string;
  /** Durée en secondes (`1 h 5 min`, `1 hr 5 min`). */
  formatDuration(seconds: number): string;
  /** Comparaison pour le tri (`Intl.Collator`, numérique, sans tenir compte de la casse ni des accents). */
  compare(a: string, b: string): number;
}
