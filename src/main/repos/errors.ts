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
  | 'disk'
  // Dépôts tiers et confiance (P3-08)
  /** Clé publique illisible : PEM d'une clé ed25519 attendu. */
  | 'key'
  /** L'empreinte confirmée par l'utilisateur n'est pas celle de la clé fournie. */
  | 'fingerprint'
  /** Ce dépôt (même clé ou même adresse) est déjà configuré, ou c'est le dépôt officiel. */
  | 'exists'
  /** Trop de dépôts tiers. */
  | 'limit'
  /** Dépôt inconnu (retrait d'un dépôt qui n'est pas configuré, ou dépôt officiel). */
  | 'repository'
  /** Le plugin est déjà installé depuis un autre dépôt : seul ce dépôt peut le mettre à jour ou le remplacer. */
  | 'owner'
  /** Plugin tiers de code sensible : l'accord de l'utilisateur est nécessaire pour cette version. */
  | 'consent';

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
