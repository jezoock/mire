// Canal de requêtes sur un MessagePort, le même des deux côtés (processus principal et hôte) : c'est la forme des
// échanges proposée à P3-03 (voir docs/adr/0002-hote-isole.md, « Échanges »).
//
//   requête    { t: 'req', id, cible, methode, args }
//   réponse    { t: 'res', id, ok: true, valeur } | { t: 'res', id, ok: false, erreur: { code, message } }
//   annulation { t: 'cancel', id }      (le demandeur n'attend plus ; le traitant reçoit un AbortSignal)
//   événement  { t: 'evt', nom, donnees } (sans réponse : journal, progression)
//
// Les messages passent par le clonage structuré : pas de fonctions, pas de classes, seulement des données.

/** Codes d'erreur stables du canal. */
export const ERREURS = {
  delai: 'timeout',
  annulee: 'cancelled',
  introuvable: 'not-found',
  plugin: 'plugin-error',
  hote: 'host-gone',
};

export class ErreurCanal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Adapte un port : `MessagePortMain` (processus principal, utilityProcess) ou `MessagePort` du navigateur (hôte A).
 * @returns {{ envoyer(m: unknown): void, ecouter(f: (m: any) => void): void, fermer(): void }}
 */
export function adapterPort(port) {
  if (typeof port.on === 'function') {
    return {
      envoyer: (m) => port.postMessage(m),
      ecouter: (f) => {
        port.on('message', (e) => f(e.data));
        port.start();
      },
      fermer: () => port.close(),
    };
  }
  return {
    envoyer: (m) => port.postMessage(m),
    ecouter: (f) => {
      port.onmessage = (e) => f(e.data);
    },
    fermer: () => port.close(),
  };
}

/**
 * Canal de requêtes. `traiter(cible, methode, args, signal)` répond aux requêtes reçues ; `surEvenement(nom,
 * donnees)` reçoit les événements.
 */
export function creerCanal(port, { traiter = null, surEvenement = null, delai = 5000 } = {}) {
  const p = adapterPort(port);
  const attente = new Map();
  const enCours = new Map();
  let suivant = 1;
  let ferme = null;

  const repondre = (id, ok, x) => p.envoyer(ok ? { t: 'res', id, ok: true, valeur: x } : { t: 'res', id, ok: false, erreur: x });

  async function recevoirRequete(m) {
    const ctrl = new AbortController();
    enCours.set(m.id, ctrl);
    try {
      if (!traiter) throw new ErreurCanal(ERREURS.introuvable, 'Ce côté ne traite aucune requête.');
      const valeur = await traiter(m.cible, m.methode, m.args ?? [], ctrl.signal);
      if (!ctrl.signal.aborted) repondre(m.id, true, valeur);
    } catch (err) {
      if (!ctrl.signal.aborted) repondre(m.id, false, { code: err?.code ?? ERREURS.plugin, message: String(err?.message ?? err) });
    } finally {
      enCours.delete(m.id);
    }
  }

  p.ecouter((m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'req') recevoirRequete(m);
    else if (m.t === 'res') {
      const a = attente.get(m.id);
      if (!a) return;
      attente.delete(m.id);
      clearTimeout(a.minuterie);
      if (m.ok) a.resoudre(m.valeur);
      else a.rejeter(new ErreurCanal(m.erreur?.code ?? ERREURS.plugin, m.erreur?.message ?? ''));
    } else if (m.t === 'cancel') enCours.get(m.id)?.abort();
    else if (m.t === 'evt') surEvenement?.(m.nom, m.donnees);
  });

  /**
   * Envoie une requête. `delai` : millisecondes avant abandon (0 : aucun) ; `signal` : annulation par le demandeur.
   * À l'abandon, l'autre côté reçoit `cancel`.
   */
  function demander(cible, methode, args = [], options = {}) {
    if (ferme) return Promise.reject(new ErreurCanal(ERREURS.hote, ferme));
    const id = suivant++;
    const ms = options.delai ?? delai;
    return new Promise((resoudre, rejeter) => {
      const abandonner = (code, message) => {
        if (!attente.delete(id)) return;
        clearTimeout(a.minuterie);
        if (!ferme) p.envoyer({ t: 'cancel', id });
        rejeter(new ErreurCanal(code, message));
      };
      const a = { resoudre, rejeter, abandonner, minuterie: null };
      if (ms > 0) a.minuterie = setTimeout(() => abandonner(ERREURS.delai, `Pas de réponse en ${ms} ms.`), ms);
      options.signal?.addEventListener('abort', () => abandonner(ERREURS.annulee, 'Requête annulée.'), { once: true });
      attente.set(id, a);
      p.envoyer({ t: 'req', id, cible, methode, args });
    });
  }

  return {
    demander,
    evenement: (nom, donnees) => p.envoyer({ t: 'evt', nom, donnees }),
    /** L'autre côté a disparu : toutes les requêtes en attente échouent avec `host-gone`. */
    rompre(raison) {
      ferme = raison;
      for (const a of [...attente.values()]) a.abandonner(ERREURS.hote, raison);
      for (const c of enCours.values()) c.abort();
    },
    fermer() {
      this.rompre('Canal fermé.');
      p.fermer();
    },
  };
}
