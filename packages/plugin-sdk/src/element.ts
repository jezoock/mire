/**
 * Modèle d'élément du catalogue (architecture cible, « Éléments, tags et infos ») : tout ce que Mire peut ouvrir
 * (fichier, site, jeu, programme, flux) devient un élément, avec des tags et des infos.
 * Types seulement, publiés dans le SDK (P3-01) : les plugins les reçoivent et les rendent ; `@mire/shared` les
 * réexporte pour le cœur et l'interface. Le catalogue vit dans le processus principal (`src/main/catalog/`).
 */

/**
 * Clé d'un élément : stable, préfixée par le genre de l'élément (`local:`, `remote:`, `web:`…). Elle ne dépend
 * jamais du rang d'un élément ni d'un nom affiché. Règles : `keys.ts` du catalogue de Mire.
 */
export type ElementKey = string;

/** Plugin et emplacement configuré qui ont fourni un élément. */
export interface ElementSourceRef {
  /** Identifiant du plugin source (en attendant les plugins, celui d'une source interne). */
  plugin: string;
  /** Emplacement configuré de ce plugin (dossier de la bibliothèque, console, service de télévision…). */
  instance: string;
}

/** Variante d'un flux (HD, SD, bas débit). */
export interface StreamVariant {
  label: string;
  url: string;
}

/** Comment ouvrir un élément. */
export type OpenSpec =
  /** Fichier : chemin local (ou partage réseau), ou adresse http(s) d'un fichier sur un serveur web. */
  | { kind: 'file'; path: string }
  /** Site ou page d'un site ; `site` : identifiant du site de la configuration (`WebSite.id`) qui l'ouvre. */
  | { kind: 'site'; url: string; site?: string }
  /** Jeu de console : console (`Emulator.id`) et fichier du jeu (chemin local ou adresse). */
  | { kind: 'game'; console: string; path: string }
  /** Programme à lancer (jeu PC, raccourci). */
  | { kind: 'program'; path: string; args?: string[] }
  /** Flux en direct : chaîne de télévision, entrée d'une liste M3U. */
  | { kind: 'stream'; url: string; variants?: StreamVariant[] };

export type OpenKind = OpenSpec['kind'];

/** Valeur d'une info : texte, nombre (année, saison, épisode), oui/non, ou liste de textes (genres). */
export type InfoValue = string | number | boolean | string[];

/**
 * Origine d'un tag ou d'une info : type de fichier (cœur), source qui fournit l'élément, tags automatiques,
 * infos en ligne, ou saisie à la main.
 */
export type ValueOrigin = 'file' | 'source' | 'tagger' | 'metadata' | 'user';

/** Images d'un élément (chemins locaux ou adresses). */
export interface ElementImages {
  poster?: string;
  background?: string;
  logo?: string;
}

/** Élément du catalogue. */
export interface Element {
  key: ElementKey;
  source: ElementSourceRef;
  name: string;
  open: OpenSpec;
  /** Tags effectifs, calculés. */
  tags: string[];
  /** Infos effectives, calculées. */
  infos: Record<string, InfoValue>;
  images: ElementImages;
  /** Première fois que le catalogue a vu l'élément (millisecondes depuis 1970). */
  added: number;
}

/** Type de valeur d'une info : texte, nombre, oui/non, liste de textes. */
export type InfoType = 'text' | 'number' | 'boolean' | 'list';
