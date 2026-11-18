// Runtime de l'hôte, le même dans les deux prototypes : il reçoit le port du processus principal, charge les
// contributions des plugins (export par défaut du `main` : une `ContributionFactory` qui reçoit le contexte) et
// répond aux requêtes. Seul l'environnement change : A (WebContents cachée) ou B (utilityProcess).

import { creerCanal, ErreurCanal, ERREURS } from './canal.mjs';

const indisponible = (quoi) => () => Promise.reject(new ErreurCanal(ERREURS.introuvable, `${quoi} : hors du prototype (P3-04).`));

/** Contexte d'un plugin : `http` relayé au processus principal (factice ici), le reste viendra avec P3-04. */
function creerContexte(canal, plugin) {
  const relais =
    (methode) =>
    (...args) =>
      canal.demander(`ctx:${plugin.id}`, methode, args);
  const journal =
    (niveau) =>
    (message, ...details) =>
      canal.evenement('log', { plugin: plugin.id, niveau, message: String(message), details });
  return Object.freeze({
    id: plugin.id,
    version: plugin.version,
    locale: plugin.locale ?? 'fr',
    http: Object.freeze({ request: relais('http.request'), getJson: relais('http.getJson'), getText: relais('http.getText') }),
    files: Object.freeze({
      requestFolder: indisponible('files'),
      readText: indisponible('files'),
      readBytes: indisponible('files'),
      exists: indisponible('files'),
      walk: indisponible('files'),
    }),
    storage: Object.freeze({ get: indisponible('storage'), set: indisponible('storage'), delete: indisponible('storage'), keys: indisponible('storage') }),
    settings: Object.freeze({ get: () => undefined, onChange: () => () => {} }),
    log: Object.freeze({ info: journal('info'), warn: journal('warn'), error: journal('error') }),
    events: Object.freeze({ on: () => () => {} }),
  });
}

/** Méthode appelable d'une contribution : une fonction à elle, jamais une propriété héritée d'Object. */
function methode(instance, nom) {
  if (typeof nom !== 'string' || nom.startsWith('_') || nom === 'constructor') return null;
  if (Object.prototype.hasOwnProperty.call(Object.prototype, nom)) return null;
  const f = instance[nom];
  return typeof f === 'function' ? f : null;
}

/**
 * Démarre l'hôte sur `port`. `environnement` : 'A' ou 'B' (pour les mesures seulement).
 */
export function demarrerHote(port, environnement) {
  const contributions = new Map();
  let canal = null;

  async function charger(plugin) {
    const chargees = [];
    for (const c of plugin.contributions) {
      const module = await import(new URL(c.main, plugin.base).href);
      if (typeof module.default !== 'function') throw new ErreurCanal(ERREURS.plugin, `${c.main} : pas d'export par défaut.`);
      const instance = await module.default(creerContexte(canal, plugin));
      if (!instance || instance.id !== c.id) throw new ErreurCanal(ERREURS.plugin, `${c.main} : identifiant attendu « ${c.id} ».`);
      const cle = `${plugin.id}:${c.kind}/${c.id}`;
      contributions.set(cle, instance);
      chargees.push(cle);
    }
    return chargees;
  }

  /** Lot d'éléments pour un tag automatique : une requête pour `elements.length` appels, annulable entre deux. */
  function calculerLot(cle, elements, signal) {
    const instance = contributions.get(cle);
    if (!instance) throw new ErreurCanal(ERREURS.introuvable, cle);
    const sortie = new Array(elements.length);
    for (let i = 0; i < elements.length; i++) {
      if (signal.aborted) throw new ErreurCanal(ERREURS.annulee, 'Lot annulé.');
      sortie[i] = instance.compute(elements[i]);
    }
    return sortie;
  }

  async function traiter(cible, nom, args, signal) {
    if (cible === 'hote') {
      if (nom === 'ping') return environnement;
      if (nom === 'charger') return charger(args[0]);
      if (nom === 'calculerLot') return calculerLot(args[0], args[1], signal);
      throw new ErreurCanal(ERREURS.introuvable, `hote.${nom}`);
    }
    const instance = contributions.get(cible);
    const f = instance && methode(instance, nom);
    if (!f) throw new ErreurCanal(ERREURS.introuvable, `${cible}.${nom}`);
    return f.apply(instance, args);
  }

  canal = creerCanal(port, { traiter });
  canal.evenement('pret', { environnement });
}
