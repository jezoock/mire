/** Types du moteur de récupération d'infos (films, séries, albums, jeux) et de ses fournisseurs. */
import type { Config } from '@mire/shared';
import type { FetchLike } from '../net/http.ts';

/** Nature d'un élément à décrire (le `kind` des demandes de l'interface). */
export type ScrapeKind = 'video' | 'album' | 'rom' | 'pc';

/** Familles de la récupération groupée (`run`) : chaque fournisseur appartient à l'une d'elles. */
export type ScrapeGroup = 'videos' | 'music' | 'games';

/** Fiche produite par un fournisseur. Les champs absents ne sont pas écrits (format de `db.json` inchangé). */
export interface ScrapeFacts {
  title: string;
  year?: string;
  overview?: string;
  genre?: string;
  artist?: string;
  /** Chemin de l'image copiée dans le dossier d'images du moteur. */
  image: string | null;
  backdrop?: string | null;
  series?: boolean;
  source: string;
  /** Fiche choisie par l'utilisateur dans la liste des candidats. */
  picked?: boolean;
}

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

/** Fiche choisie par l'utilisateur (un des candidats). */
export interface ScrapePick {
  id: string;
  title?: string;
  sub?: string;
  year?: string;
}

/** Correction de l'utilisateur : autre titre (et type, année, artiste) ou fiche choisie. */
export interface ScrapeOverride {
  type?: string;
  title?: string;
  year?: string;
  artist?: string;
  pick?: ScrapePick;
}

/** Fiche proposée au choix de l'utilisateur. */
export interface ScrapeCandidate {
  id: string;
  title: string;
  year: string;
  sub: string;
  image: string | null;
  fallback?: string | null;
}

/** Élément à décrire, tel que l'envoie l'interface ou le service des jeux. */
export type ScrapeItem = Record<string, any>;

export interface CandidateQuery {
  item?: ScrapeItem;
  query: string;
  year?: string | number;
  artist?: string;
}

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

export type ScrapeConfig = Pick<Config, 'search' | 'games' | 'emulators'>;

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
export type ScrapeOutcome = ScrapeFacts | null | undefined;

/** Clé TMDB manquante, par exemple : la récupération groupée saute la famille, la recherche refuse. */
export interface MissingRequirement {
  /** Ligne de « skipped » dans le bilan de `run`. */
  skipped: string;
  /** Message d'erreur de `candidates`. */
  error: string;
}

/** Une source d'infos (TMDB, MusicBrainz, libretro, Steam). */
export interface MetadataProvider {
  id: string;
  /** Natures d'éléments décrites. */
  kinds: ScrapeKind[];
  /** Famille de la récupération groupée. */
  group: ScrapeGroup;
  /** Récupérations simultanées au plus pendant `run`. */
  concurrency: number;
  /** Ce qui manque pour interroger la source (clé…), ou `null`. */
  requires?(ctx: ProviderContext): MissingRequirement | null;
  /** Clé de la fiche d'un élément dans `db.json`. */
  key(item: ScrapeItem): string;
  /** Éléments à décrire pour `run`, d'après ses options ou la configuration. */
  collect(opts: RunOptions, ctx: ProviderContext): ScrapeItem[] | Promise<ScrapeItem[]>;
  /** Cherche la fiche d'un élément (d'après son nom, ou la correction `override`). */
  scrape(item: ScrapeItem, override: ScrapeOverride | undefined, ctx: JobContext): Promise<ScrapeOutcome>;
  /** Fiches correspondant à une recherche, pour laisser choisir la bonne. */
  candidates(query: CandidateQuery, ctx: ProviderContext): Promise<ScrapeCandidate[]>;
  /** Récupère la fiche choisie par l'utilisateur. */
  byId(pick: ScrapePick, item: ScrapeItem, ctx: JobContext): Promise<ScrapeOutcome>;
}
