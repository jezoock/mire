/**
 * Refus d'un fournisseur, avec un message pour l'utilisateur (système de console inconnu, liste indisponible…).
 * Le moteur le rend en `{ ok: false, error }` au lieu de laisser l'erreur remonter.
 */
export class ScrapeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeRefusal';
  }
}
