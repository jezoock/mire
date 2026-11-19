/**
 * Erreurs du client des dépôts : un code stable (le message affiché est `repos.errors.<code>` dans les catalogues) et
 * un message technique en français pour le journal.
 */
export type RepoErrorCode =
  /** Adresse refusée (autre chose que `https:`), ou redirection vers une telle adresse. */
  | 'url'
  /** Pas de réponse, délai dépassé, code d'erreur HTTP. */
  | 'network'
  /** Réponse plus grosse que la limite (index, paquet), ou d'une autre taille que celle annoncée par l'index. */
  | 'too-big'
  /** Signature absente, faite par une autre clé, ou invalide. */
  | 'signature'
  /** Index illisible, d'un format inconnu ou mal formé. */
  | 'format'
  /** Index plus ancien que celui du cache (retour en arrière refusé). */
  | 'rollback'
  /** Empreinte sha256 ou taille du paquet différente de celle de l'index. */
  | 'checksum'
  /** Archive refusée : chemin dangereux, lien, fichier spécial, archive tronquée. */
  | 'archive'
  /** Manifeste du paquet absent, invalide, ou d'un autre identifiant ou d'une autre version que l'index. */
  | 'manifest'
  /** Plugin ou version inconnus des dépôts. */
  | 'unknown'
  /** Aucune version compatible avec cette version de Mire. */
  | 'engine'
  /** Dépendance introuvable, conflit de versions, dépendances circulaires. */
  | 'dependency'
  /** Le plugin installé est refusé par l'hôte de plugins (vérification au chargement). */
  | 'refused'
  /** Une installation est déjà en cours. */
  | 'busy'
  /** Écriture sur le disque impossible. */
  | 'disk';

export class RepoError extends Error {
  code: RepoErrorCode;
  vars: Record<string, string>;

  constructor(code: RepoErrorCode, message: string, vars: Record<string, string> = {}) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
    this.vars = vars;
  }
}

export const repoErrorCode = (err: unknown): RepoErrorCode => (err instanceof RepoError ? err.code : 'disk');
