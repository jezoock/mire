# ADR 0002 — Hôte isolé des plugins de code limité

- **État** : acceptée au point G4 (19/11/2026) ; 🧑 vérification de la sandbox sur une vraie machine encore à faire.
- **Contexte** : décisions D-07 et D-18 (`docs/analyse/ANALYSE.md` § 10), architecture cible (« Niveaux de sécurité
  et exécution », « Sécurité »), tâche P3-02. Electron 44.9.3 (castLabs), Chromium 152, Node 24.22.

## Contexte

D-18 place le code des plugins de niveau `code` dans un **hôte isolé** : un processus de rendu caché, sandboxé, sans
Node ni réseau, qui charge les plugins par `mire-plugin://<id>/…` et parle au processus principal par `MessagePort`.
L'autre voie étudiée est un `utilityProcess`. Avant de construire l'hôte (P3-03), P3-02 compare les deux sur un
prototype : ce qu'ils coûtent et ce qu'ils isolent réellement.

## Le prototype

- **Emplacement : `spikes/hote-isole/`, sur `main`.** L'ADR doit être sur `main` pour le point G4 et ses chiffres
  doivent pouvoir être reproduits à chaque montée de version d'Electron : le script est donc à côté, et non sur une
  branche qui vieillirait. Il reste hors de Mire : `scripts/build.mjs` ne le lit pas, l'installateur n'embarque que
  `dist/`, `src/` ne l'importe pas, `mire-plugin://` n'est pas enregistré dans l'application. ESLint et Prettier le
  vérifient (un bloc dans `eslint.config.js` pour ses globales : Electron, page, Worker, Node) ; le plugin d'essai a
  son propre `tsconfig.json`, hors de `npm run typecheck`, pour qu'une évolution du SDK ne casse pas la CI à cause
  d'un prototype. **Aucune dépendance ajoutée** (D-03).
- **Relancer** (mode d'emploi complet : `spikes/hote-isole/README.md`) :

  ```sh
  xvfb-run -a -s "-screen 0 1920x1080x24" npx electron spikes/hote-isole/main.mjs   # Linux sans écran
  npx electron spikes/hote-isole/main.mjs                                          # Windows, macOS
  ```

  Options : `--repetitions=10 --elements=20000 --lot=500 --seulement=mesures|verifications --sortie=<json>`.
  Code de sortie 1 si A laisse passer un essai.
- **Hôte A** : `BrowserWindow` cachée (`show: false`, `backgroundThrottling: false`), `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`, dans une **session en mémoire propre à l'hôte** :
  `webRequest` annule toute requête qui n'est pas `mire-plugin:`, permissions toutes refusées, nouvelles fenêtres
  refusées, navigation annulée. `mire-plugin://` est servi par `session.protocol.handle` de cette session seule : la
  page de l'hôte (`mire-plugin://hote/…`, quatre fichiers nommés) et les dossiers des plugins **de cet hôte**, en
  lecture (`GET`), chemin décodé refusé s'il contient `..`, `\` ou un octet nul, chemin réel (liens résolus) refusé
  hors du dossier du plugin. CSP de la page : `script-src mire-plugin:` (rien de plus, pour que les essais réseau
  éprouvent la session). Un preload de trois lignes reçoit le port par IPC **une fois** et le passe à la page ; il
  n'expose rien. **Le code des plugins tourne dans un Worker de la page**, d'où `WebTransport` et `Worker` sont
  retirés avant tout import (voir « Ce que `webRequest` ne voit pas »).
- **Hôte B** : `utilityProcess.fork`, environnement réduit à `NODE_OPTIONS` = modèle de permissions de Node
  (`--permission`, `--allow-fs-read` limité au runtime et aux dossiers de ses plugins). Electron **ignore**
  `--permission` dans `execArgv` (constaté : `process.permission` absent) ; il n'est pris en compte que par
  `NODE_OPTIONS` dans l'environnement de l'enfant.
- **Le même runtime** (`runtime.mjs`, `canal.mjs`) dans A et B, et **le même plugin d'essai chargé tel quel** :
  `plugins/essai/` (niveau `code`, accepté par `mire-plugin validate`, typé par le SDK), un tag automatique factice
  (année et définition tirées du nom) et des infos en ligne factices dont la recherche passe par `ctx.http`, relayé
  au processus principal qui répond par une fiche inventée.

## Mesures

**Méthode** : machine virtuelle Linux (Intel Xeon 2,1 GHz, 4 cœurs, 16 Go), Electron 44.9.3, xvfb, en root donc
`--no-sandbox` (voir « Limites »). Médianes de **10 répétitions**, A et B en alternance (A puis B, puis B puis A).
Chaque répétition crée un hôte neuf. Mémoire lue dans `/proc/<pid>/smaps_rollup` une seconde après chaque étape :
**PSS** (pages partagées réparties entre les processus qui les partagent, la mesure juste pour additionner) et RSS.
« Hausse de l'application » : somme des PSS de tous les processus d'Electron (`app.getAppMetrics()`), après moins
avant. Plusieurs hôtes : médianes de 5 répétitions. 20 000 éléments au format `Element` du SDK, aller et retour
compris (envoi, calcul, réponse, clonage des deux côtés).

| Mesure | A (WebContents + Worker) | B (utilityProcess) |
| --- | --- | --- |
| Démarrage d'un hôte vide, jusqu'au premier message | 55 ms | 45 ms |
| Chargement du plugin d'essai (deux contributions) | 4,9 ms | 2,6 ms |
| Mémoire, hôte vide (PSS / RSS) | 43,9 / 85,1 Mo | 38,7 / 93,2 Mo |
| Mémoire, plugin chargé (PSS / RSS) | 44,4 / 85,9 Mo | 40,0 / 95,6 Mo |
| Mémoire, après 20 000 éléments (PSS / RSS) | 118,8 / 162,7 Mo | 48,0 / 106,1 Mo |
| **20 000 éléments, par lots de 500** | **58 ms** | **54 ms** |
| 20 000 éléments, une requête par élément | 561 ms | 541 ms |
| Infos en ligne factices : un appel (relais `ctx.http` compris) | 0,22 ms | 0,22 ms |
| 1 hôte avec le plugin : PSS de l'hôte / hausse de l'application | 44,4 / 32,2 Mo | 40,2 / 23,1 Mo |
| 3 hôtes : PSS des hôtes / hausse de l'application | 83,8 / 67,9 Mo | 94,4 / 62,2 Mo |
| 6 hôtes : PSS des hôtes / hausse de l'application | 129,2 / 115,4 Mo | 160,9 / 119,0 Mo |
| Démarrage et chargement en parallèle : 1 / 3 / 6 hôtes | 55 / 89 / 153 ms | 49 / 53 / 95 ms |

Lecture :

- **Coûts comparables.** Un hôte coûte environ 20 à 35 Mo de plus à l'application (~40 Mo de PSS, dont une part de
  pages partagées avec les autres processus), un peu plus de 50 ms pour démarrer. Six hôtes (un officiel et cinq
  dépôts tiers) coûtent ~115 Mo dans les deux cas : un hôte par dépôt tiers est tenable pour quelques dépôts, pas
  pour des dizaines (voir P3-03).
- **20 000 éléments : 58 ms par lots, 561 ms un par un.** Le coût est dans le nombre de messages, pas dans le
  calcul : les tags automatiques doivent passer **par lots**.
- La mémoire de A après 20 000 éléments (119 Mo) est celle que le ramasse-miettes n'a pas encore reprise (les 20 000
  requêtes unitaires), pas une fuite : rien ne force le ramasse-miettes dans un processus de rendu.

## Vérifications d'isolement

Le **plugin sonde** essaie, depuis son propre code, tout ce qu'un plugin ne doit pas pouvoir faire. Le processus
principal juge avec ce qu'il observe lui-même : connexions et requêtes reçues par un serveur HTTP local, paquets
reçus par deux ports UDP locaux, résolutions de noms dans le journal réseau de la session (`netLog`, événements
`HOST_RESOLVER` et `DNS`), messages reçus de l'enfant, ouvertures de fenêtre et navigations interceptées. Un fichier
secret est posé hors du dossier du plugin, avec un lien symbolique vers lui dans le dossier.

| Essai depuis le plugin | A | B |
| --- | --- | --- |
| Lire un fichier hors de son dossier (`fetch`/`import()` de `file://` ; `fs`) | refusé | refusé (permissions de Node) |
| Sortir par `..`, `%2e%2e`, `..%2f` | refusé (404, 403) | refusé |
| Suivre un lien symbolique du dossier vers l'extérieur | refusé (403) | **lu** : le modèle de Node suit les liens |
| Lire un autre plugin (autre identifiant, autre dossier) | refusé (404 : absent de cet hôte) | refusé |
| HTTP, `XMLHttpRequest`, `EventSource`, image vers `127.0.0.1` | refusé, rien reçu | **connecté** (`fetch`) |
| WebSocket vers `127.0.0.1` | refusé, rien reçu | **reçu par le serveur** |
| TCP brut, UDP brut | sans objet (aucune API) | **connecté, paquet reçu** |
| `https://` vers un nom de domaine | refusé, aucune résolution | — |
| Résolution de nom | aucune (journal réseau vide) | **possible** (`dns.lookup`) |
| `sendBeacon` | absent du Worker | — |
| WebRTC (STUN vers `127.0.0.1`) | absent du Worker, 0 paquet | — |
| WebTransport (QUIC vers `127.0.0.1`) | retiré du Worker, 0 paquet | — |
| Module `net` d'Electron | — | **requête aboutie** |
| Node (`require`, `process`, `Buffer`) | absent | présent |
| API de la fenêtre, IPC (`window.api`, `ipcRenderer`) | absents | — |
| Canal vers le principal autre que le port | aucun | **`process.parentPort`** : message reçu |
| Signal au processus principal (`process.kill(ppid, 0)`) | — | **possible** |
| Lancer un programme | — | refusé (permissions de Node) |
| Ouvrir une fenêtre, naviguer | absents du Worker (dans la page : refusés) | — |
| Variables d'environnement | — | visibles (réduites à `NODE_OPTIONS` et `DBUS_SESSION_BUS_ADDRESS`) |
| **Boucle sans fin** | détectée en 750 ms, hôte arrêté en 7 ms | détectée en 752 ms, arrêté en 14 ms |
| **Mémoire épuisée** (chien de garde) | détectée en 750 ms, arrêté en 35 ms | détectée en 750 ms, arrêté en 36 ms |
| **Hôte qui plante seul** (mémoire, sans chien de garde) | `render-process-gone` (`crashed`) 2,8 s après l'appel | `exit` (code 5) 2,7 s après l'appel |
| Pendant ces trois pannes | autre hôte : tous ses pings répondus ; retard max. du principal < 1 ms | idem, retard max. < 5 ms |

Chien de garde : un ping toutes les 250 ms avec un délai de 500 ms ; au premier ping sans réponse, l'hôte est arrêté
(`forcefullyCrashRenderer`, `kill`). Une mémoire qui s'emballe bloque aussi la boucle d'événements : le chien de
garde la prend avant le plantage.

### Ce que `webRequest` ne voit pas (A)

Le script compare A à deux variantes : plugins **dans la page** (au lieu du Worker), avec et sans parades.

| Fuite constatée | Plugins dans la page, sans parade | Parade essayée | Résultat |
| --- | --- | --- | --- |
| UDP de WebRTC (STUN) | 4 paquets reçus | `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | 0 paquet |
| Résolution anticipée (`<link rel="dns-prefetch">`) | **vraies requêtes DNS** (A et HTTPS) | proxy SOCKS5 sur la session | aucun effet |
| WebTransport (QUIC) | 6 paquets reçus | `disableBlinkFeatures`, `--disable-quic`, gestionnaire de permissions | aucun effet |
| (les trois) | — | **code des plugins dans un Worker**, `WebTransport` et `Worker` retirés de sa portée | **0** |

Le Worker n'a ni DOM (donc ni `<link>`, ni image, ni fenêtre, ni navigation), ni `RTCPeerConnection`, ni
`sendBeacon`. `WebTransport` y existe : il est supprimé de la portée du Worker avant le premier import, avec `Worker`
(un Worker imbriqué serait un contexte neuf où il reviendrait). Un Worker n'a pas d'autre moyen de créer un contexte.
C'est une **liste de retrait**, donc à revérifier à chaque montée de version d'Electron : c'est le rôle du script.

## Choix

**Hôte A, avec le code des plugins dans un Worker de la page cachée.** D-18 est confirmée et précisée.

- A isole tout ce que la fiche demande : aucune lecture hors du dossier du plugin, aucune connexion, aucune
  résolution de nom, aucun accès à la fenêtre ou au principal autrement que par le port.
- B n'isole pas le réseau, et ne peut pas l'isoler avec les moyens d'Electron 44 : le modèle de permissions de
  Node 24 ne couvre pas le réseau, le module `net` d'Electron est disponible dans l'`utilityProcess` et sort par le
  réseau de l'application, `process.parentPort` et `process.kill(ppid)` restent accessibles au plugin, et le modèle
  de Node suit les liens symboliques. B reste la bonne place pour du code **sensible** qui a besoin de Node
  (alternative au processus principal pour D-07), pas pour du code tiers.
- Les coûts ne départagent pas : ~40 Mo et ~50 ms par hôte dans les deux cas, 58 ms contre 54 ms pour 20 000
  éléments par lots, pannes détectées et arrêtées dans les mêmes temps.

## Échanges (forme que P3-03 reprend)

`canal.mjs`, le même des deux côtés du port ; seulement des données (clonage structuré : ni fonctions, ni classes).

| Message | Forme |
| --- | --- |
| Requête | `{ t: 'req', id, cible, methode, args }` |
| Réponse | `{ t: 'res', id, ok: true, valeur }` ou `{ t: 'res', id, ok: false, erreur: { code, message } }` |
| Annulation | `{ t: 'cancel', id }` : le demandeur n'attend plus ; le traitant reçoit un `AbortSignal` |
| Événement | `{ t: 'evt', nom, donnees }`, sans réponse (`pret`, journal du plugin) |

- **Cibles** : `hote` (`ping`, `charger`, `calculerLot`) ; `<idPlugin>:<nature>/<idContribution>` pour une
  méthode d'une contribution ; dans l'autre sens, `ctx:<idPlugin>` pour un appel du contexte (`http.getJson`…).
- **Identité du plugin** : le principal reconnaît le plugin **par le port d'où vient la requête**, jamais par un
  champ du message. Dans le prototype, tous les plugins d'un hôte partagent un Worker et un seul canal : la cible
  `ctx:<idPlugin>` y est une chaîne que le code de l'hôte écrit, donc qu'un plugin peut forger (ou faire écrire en
  réécrivant `MessagePort.prototype.postMessage` ou `Map.prototype.get`) pour appeler le contexte au nom d'un autre
  plugin du même hôte, ou ses contributions. Les permissions par plugin deviendraient l'union de celles de l'hôte.
  D'où **un Worker (un contexte JavaScript à lui) et un port par plugin** ; la cible ne sert plus qu'à désigner la
  contribution à l'intérieur du plugin.
- **Méthodes appelables** : une fonction de l'objet rendu par la fabrique ; refusées : nom commençant par `_`,
  `constructor`, noms d'`Object.prototype`.
- **Codes d'erreur stables** : `timeout`, `cancelled`, `not-found`, `plugin-error`, `host-gone` (hôte arrêté : toutes
  les requêtes en attente échouent aussitôt).
- **Délais** : par requête (5 s par défaut, 0 pour aucun) ; à l'expiration, `cancel` est envoyé. Une requête longue
  légitime (analyse d'un dossier) se découpe ou prend un délai explicite.
- **Lots** : `calculerLot(cible, elements)` appelle `compute` pour chaque élément dans l'hôte et rend le tableau des
  résultats ; annulable entre deux éléments.
- **Chien de garde** : ping toutes les 250 ms, délai 500 ms, arrêt au premier ping manqué (≈ 750 ms pour détecter).

**Entrée du plugin** : la `ContributionFactory` de P3-01 est **confirmée** (export par défaut du `main`, appelée une
fois avec le `PluginContext`, synchrone ou asynchrone), avec trois précisions :

1. l'objet rendu doit porter l'`id` de la contribution déclarée dans le manifeste (sinon refus au chargement) ;
2. les interfaces qui reçoivent un contexte en paramètre (`MetadataProvider.collect(opts, ctx)`, `scrape(…, ctx)`,
   `requires(ctx)`, `SearchProvider.search(query, ctx)`) le reçoivent **de l'hôte**, qui passe le contexte local du
   plugin : le cœur n'en envoie jamais (un contexte n'est pas clonable, et le plugin n'a pas à en recevoir un
   autre). Le prototype ne l'a pas encore fait (son plugin d'infos utilise celui de la fabrique) ;
3. une méthode synchrone de l'interface (`Tagger.compute`) devient asynchrone vue du cœur : seul l'hôte l'appelle
   de façon synchrone, dans un lot.

## Conséquences

### Pour P3-03 (hôte de plugins)

- Reprendre `canal.mjs` et `runtime.mjs` en TypeScript dans `src/main/plugins/` (le runtime de l'hôte est construit
  à part par esbuild, servi par `mire-plugin://hote/`), avec des tests `node:test` du canal (délai, annulation,
  `host-gone`, méthodes refusées).
- **Enregistrer `mire-plugin`** comme schéma privilégié (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`)
  avant `ready` : c'est un ajout au démarrage de Mire, à relire comme un changement de sécurité. Le gestionnaire
  n'est installé **que sur les sessions des hôtes**, jamais sur celle de la fenêtre principale ni des vues web.
- Une session en mémoire par hôte ; `webRequest` qui annule tout sauf `mire-plugin:` ; permissions refusées ;
  `setWindowOpenHandler` refusé ; `will-navigate` annulé ; politique WebRTC sans UDP ; Worker avec la liste de
  retrait. Ajouter à la CSP `default-src 'none'` et `connect-src mire-plugin:` (non essayé ici, exprès : couche de
  plus) et vérifier qu'elle n'empêche pas l'import des modules.
- Chien de garde, arrêt et redémarrage de l'hôte sans le plugin fautif ; le plugin est désactivé avec un message
  clair (critères de P3-03).
- **Nombre d'hôtes** : ~40 Mo chacun. Démarrer un hôte à la première demande, l'arrêter s'il n'a rien fait depuis un
  moment, et regrouper les dépôts tiers si leur nombre grandit.
- **Un Worker et un port par plugin** dans un même hôte : c'est une **exigence** (voir « Identité du plugin »), plus
  une option. Le principal attribue chaque port à un plugin à sa création et ne lit jamais l'identité dans les
  messages. Bénéfice en plus : arrêter un seul plugin (`worker.terminate()`) sans redémarrer les autres. Le coût
  (mémoire et démarrage d'un Worker de plus par plugin) reste à mesurer dans P3-03.
- Rejouer `spikes/hote-isole/main.mjs` à chaque montée de version d'Electron ; une piste est d'en faire un job de CI.

### Pour P3-04 (contexte et permissions)

- Le plugin ne peut **rien** faire lui-même : tout passe par `ctx`, relayé par **son** port. C'est dans le processus
  principal, d'après le plugin auquel ce port est attribué (jamais d'après un identifiant porté par le message), que
  s'appliquent `permissions.hosts` (client HTTP du cœur), les dossiers accordés, `storage` et `settings`. Aucune
  vérification ne peut être laissée à l'hôte.
- Borner la taille des messages et des réponses relayées (un plugin peut demander un corps énorme) et le nombre de
  requêtes simultanées par plugin.

## Limites, et ce que G4 doit faire relire

- **La sandbox du système n'a pas été éprouvée** : les mesures ont tourné en root dans un conteneur, donc avec
  `--no-sandbox`. Les vérifications de A portent sur ce que le moteur de rendu et la session refusent, ce qui ne
  dépend pas de la sandbox du système ; mais un plugin qui exploiterait une faille du moteur ne serait plus
  contenu. 🧑 Relancer le script sur une vraie machine Windows ou macOS, sans `--no-sandbox`, au point G4.
- Mémoire mesurée sous Linux (PSS) ; Windows et macOS comptent autrement.
- Le prototype charge plusieurs plugins dans un même Worker, avec un seul canal, et **ne vérifie pas l'isolement entre
  plugins d'un même hôte** (voir « Identité du plugin ») : à faire dans P3-03, avec un port par plugin.
- Au démarrage, castLabs écrit « No component available » (composant Widevine absent hors ligne) : sans lien avec le
  prototype.
