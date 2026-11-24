/** Types du moteur de récupération d'infos (films, séries, albums, jeux) et de ses fournisseurs. */
import type { Config } from '@mire/shared';
import type {
  MetadataCandidate,
  MetadataFacts,
  MetadataGroup,
  MetadataKind,
  MetadataOutcome,
  MetadataOverride,
  MetadataPick,
  MetadataProvider as SdkMetadataProvider,
  MissingRequirement as SdkMissingRequirement,
  MetadataQuery,
} from '@mire/plugin-sdk';
import type { FetchLike } from '../net/http.ts';

// Les types des fournisseurs sont publiés dans le SDK des plugins (contribution `metadata`) ; le moteur garde ses noms.
export type { MissingRequirement } from '@mire/plugin-sdk';

/** Nature d'un élément à décrire (le `kind` des demandes de l'interface). */
export type ScrapeKind = MetadataKind;

/** Familles de la récupération groupée (`run`) : chaque fournisseur appartient à l'une d'elles. */
export type ScrapeGroup = MetadataGroup;

/** Fiche produite par un fournisseur. Les champs absents ne sont pas écrits (format de `db.json` inchangé). */
export type ScrapeFacts = MetadataFacts;

/** Fiche enregistrée dans `db.json`, avec sa révision et sa date. */
export interface ScrapeRecord extends ScrapeFacts {
  rev: number;
  at: number;
}

/** Contenu de `<données>/scrape/db.json` : fiches et dates des derniers échecs, par clé (`v:`, `a:`, `r:`, `g:`, `b:`…). */
export interface ScrapeDb {
  items: Record<string, ScrapeRecord>;
  misses: Record<string, number>;
}

/**
 * Base des fiches vue par le moteur, sous les clés des fournisseurs (`v:<chemin>`, `a:<dossier>`…) : `db.json`
 * (`createDbFileStore`), ou la base du catalogue rangée par clé d'élément (`catalog/metadata.ts`).
 */
export interface ScrapeStore {
  get(key: string): ScrapeRecord | undefined;
  /** Enregistre une fiche ; l'échec noté pour cette clé est oublié. */
  set(key: string, record: ScrapeRecord): void;
  /** Oublie la fiche et l'échec d'une clé. */
  remove(key: string): void;
  /** Date du dernier échec, s'il y en a un. */
  missedAt(key: string): number | undefined;
  miss(key: string, at: number): void;
  /** Toutes les fiches, sous leurs clés (ce que l'interface historique lit). */
  all(): Record<string, ScrapeRecord>;
  clear(): void;
  flush(): Promise<void>;
}

/** Fiche choisie par l'utilisateur (un des candidats). */
export type ScrapePick = MetadataPick;

/** Correction de l'utilisateur : autre titre (et type, année, artiste) ou fiche choisie. */
export type ScrapeOverride = MetadataOverride;

/** Fiche proposée au choix de l'utilisateur. */
export type ScrapeCandidate = MetadataCandidate;

/** Élément à décrire, tel que l'envoie l'interface ou le service des jeux. */
export type ScrapeItem = Record<string, any>;

export type CandidateQuery = MetadataQuery<ScrapeItem>;

export interface RunOptions {
  kinds?: ScrapeGroup[];
  videos?: ScrapeItem[];
  albums?: ScrapeItem[];
  /** Jeux PC de l'interface ; à défaut, ceux de la configuration. */
  pcGames?: ScrapeItem[] | null;
  /** Récupère aussi les éléments déjà décrits ou en échec récent. */
  force?: boolean;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  total?: number;
  found?: number;
  missing?: number;
  skipped?: string[];
  cancelled?: boolean;
}

export interface ScrapeProgress {
  running: boolean;
  done: number;
  total: number;
  found?: number;
  missing?: number;
  skipped?: string[];
  cancelled?: boolean;
}

export type ScrapeConfig = Pick<Config, 'games' | 'emulators'>;

/** Liste des jeux d'une console (service des jeux). */
export type ListRoms = (consoleId: string) => Promise<{ ok: boolean; roms?: ScrapeItem[] } | null | undefined>;

/** Accès réseau des fournisseurs, avec les délais et messages habituels. */
export interface ScrapeIo {
  /** JSON d'une adresse ; 404 → `null` ; autre code → erreur « hôte : code N ». */
  getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T | null>;
  /** Texte d'une adresse ; un code d'erreur rend `null`. */
  getText(url: string): Promise<string | null>;
  /** Copie une image dans le dossier d'images, nommée d'après `key` ; `null` si ce n'est pas une image. */
  saveImage(url: string, key: string): Promise<string | null>;
  /** Fetch utilisé (injecté par les tests). */
  fetch?: FetchLike;
}

/** Ce que le moteur prête à ses fournisseurs. */
export interface ProviderContext {
  getConfig(): ScrapeConfig;
  io: ScrapeIo;
  /** Dossier de cache (index des jaquettes, genres…). */
  cacheDir: string;
  listRoms: ListRoms;
  /** Annulation demandée (bouton « Arrêter »). */
  cancelled(): boolean;
}

/** Contexte d'une récupération : celui du fournisseur, plus la clé sous laquelle la fiche sera enregistrée. */
export interface JobContext extends ProviderContext {
  key: string;
}

/**
 * Résultat d'une récupération : une fiche (enregistrée), `null` (rien trouvé : échec noté, nouvel essai dans
 * 14 jours) ou `undefined` (rien d'enregistré : annulation, fiche choisie introuvable).
 */
export type ScrapeOutcome = MetadataOutcome;

/**
 * Une source d'infos : l'interface du SDK, avec le contexte du moteur. `requires` peut répondre plus tard : celui d'un
 * plugin passe par son hôte (ponts des plugins).
 */
export type MetadataProvider = Omit<SdkMetadataProvider<ScrapeItem, ProviderContext, JobContext, RunOptions>, 'requires'> & {
  requires?(ctx: ProviderContext): SdkMissingRequirement | null | Promise<SdkMissingRequirement | null>;
};
