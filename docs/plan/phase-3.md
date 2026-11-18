# Phase 3 — Socle des plugins et dépôts

But : la mécanique qui charge, isole, installe et met à jour les plugins, depuis le dépôt officiel
(`jezoock/mire-addons`) et des dépôts tiers. Architecture : `docs/architecture-cible.md` (sections « Plugins » et
« Dépôts et Centre ») ; décisions D-08, D-09, D-14, D-18, D-19.

Prérequis : point d'étape **G3** (fin de la phase 2). La phase 3 publie les interfaces posées en phase 1 et en
phase 2 ; elle ne déplace encore aucune fonctionnalité dans un plugin (phase 5) et n'ajoute aucun écran : le Centre
est construit en phase 4 (P4-18).

Principes :

- **Trois niveaux** (D-18) : données seules, code limité (hôte isolé), code sensible (processus principal). Le
  niveau déclaré dans le manifeste est vérifié, jamais supposé.
- **Le dépôt officiel et les dépôts tiers passent par le même code** ; seuls la clé et le niveau de confiance
  changent.
- **Tests sans réseau** : un dépôt de test local (index signé par une clé de test, paquets générés) sert à toutes les
  tâches.

À la fin de la phase, point d'étape **G4** : revue du prototype de l'hôte isolé (mesures, choix), du SDK et de la
chaîne de publication.

---

## P3-01 — `@mire/plugin-sdk` et manifeste

- **Dépend de** : G3 · **Taille** : M
- **Objectif** : le contrat public des plugins.
- **À faire**
  - paquet `packages/plugin-sdk` (`@mire/plugin-sdk`) : types publics des contributions de l'architecture cible
    (`sources`, `metadata`, `taggers`, `search`, `webApps`, `webExtensions`, `downloaders`, `apps`, `systems`,
    `packs`, `pages`, `themes`, `palettes`, `languages`, `gamepads`), repris des interfaces internes
    (`ElementSource`, `Tagger`, `MetadataProvider`, `SearchProvider`, `WebExtension`, `Downloader`…) ;
  - contexte fourni à un plugin de code : `http`, `files`, `storage`, `settings`, `log`, `events` ;
  - schéma JSON de `mire-plugin.json` (identifiant, version, `engines.mire`, `level`, `contributes`,
    `permissions`, `dependencies`, `settings`, `i18n`) ;
  - outil `mire-plugin validate <dossier>` : manifeste, cohérence entre niveau et contributions, fichiers déclarés
    présents, textes en anglais présents ;
  - les interfaces internes de `src/main/` importent désormais leurs types du SDK.
- **Critères d'acceptation** : tests du validateur (manifestes valides et invalides : niveau `data` avec du code,
  préfixe `mire.` hors dépôt officiel, permission inconnue…) ; `npm run typecheck` couvre le paquet.

---

## P3-02 — Prototype de l'hôte isolé

- **Dépend de** : P3-01 · **Taille** : M
- **Objectif** : valider le choix de D-18 avant de construire l'hôte, mesures à l'appui.
- **À faire**
  - prototype A : une `WebContents` cachée, `sandbox: true`, `contextIsolation`, sans Node, session au réseau
    entièrement refusé, protocole `mire-plugin://<id>/…` en lecture seule, échanges par `MessagePort` ;
  - prototype B : un `utilityProcess` avec les mêmes échanges (pour comparer l'isolement réellement obtenu) ;
  - un plugin d'essai (tags automatiques factices et infos en ligne factices) chargé dans chacun ;
  - mesures : mémoire, temps de démarrage, temps pour faire passer 20 000 éléments dans un tag automatique ;
    vérification qu'un plugin ne peut ni lire un fichier, ni ouvrir une connexion, ni atteindre l'API de la fenêtre ;
  - `docs/adr/0002-hote-isole.md` : résultats, choix, conséquences.
- **Critères d'acceptation** : mesures et choix dans l'ADR, relus au point G4 ; le prototype n'est pas fusionné
  dans le code de production (branche ou dossier `spikes/`, au choix de la PR).

---

## P3-03 — Hôte de plugins

- **Dépend de** : P3-02 · **Taille** : L
- **Objectif** : charger les plugins et brancher leurs contributions.
- **À faire** (`src/main/plugins/`)
  - découverte : plugins inclus (`resources/plugins/`) et installés (`userData/plugins/<id>/<version>/`) ;
  - vérification du manifeste (P3-01) et de la compatibilité (`engines.mire`) ; refus d'un plugin dont le niveau ne
    correspond pas à ce qu'il contient ;
  - activation et désactivation, sans redémarrage quand la contribution le permet ;
  - registre des contributions, consulté par le catalogue (sources, tags automatiques), les infos en ligne, la
    recherche, les vues web, les téléchargements, les apps, les consoles, les pages, les thèmes, les palettes, les
    langues et les manettes ;
  - exécution : données lues et validées par le cœur ; code limité dans l'hôte isolé retenu par P3-02 ; code sensible
    dans le processus principal, derrière la même API par messages (D-07) ;
  - textes des plugins chargés dans le moteur de traduction (`i18n` du manifeste) ;
  - erreurs : un plugin qui lève une exception, dépasse son délai ou fait planter son hôte est désactivé avec un
    message clair ; journal par plugin.
- **Critères d'acceptation** : un plugin de données et un plugin de code limité, posés à la main dans
  `userData/plugins`, sont découverts, activés, utilisés, désactivés ; un plugin qui plante est désactivé et Mire
  continue.

---

## P3-04 — Contexte et permissions des plugins

- **Dépend de** : P3-03 · **Taille** : M
- **Objectif** : un plugin n'a que ce qu'il a déclaré.
- **À faire**
  - `http` : le client HTTP du cœur (`src/main/net/http.ts`), refus de tout hôte absent de `permissions.hosts` ;
  - `files` : lecture des seuls dossiers accordés par l'utilisateur, par la politique d'accès ; `files.walk`
    parcourt un dossier dans le processus principal ; accord d'un dossier mémorisé par plugin ;
  - `storage` : dossier `userData/plugin-data/<id>/`, écriture sûre ;
  - `settings` : réglages sous `plugins.<id>` dans la configuration, décrits par le schéma de P1-26 ; réglages
    `secret` chiffrés par `safeStorage` quand le système le permet, jamais exportés en clair ;
  - permissions sensibles (réseau local, programmes, vues web, suppression) refusées à un plugin qui n'a pas le
    niveau code sensible ;
  - brancher au registre les contributions `sources` (catalogue), `metadata` (infos en ligne) et `search`
    (recherche), qui ont besoin du contexte (reporté de P3-03, PR #69).
- **Critères d'acceptation** : tests : hôte non déclaré refusé, dossier non accordé refusé, réglage secret absent de
  l'export, permission sensible refusée au code limité.

---

## P3-05 — Plugins inclus et dépendances

- **Dépend de** : P3-03 · **Taille** : M
- **Objectif** : livrer des plugins avec Mire et gérer ce qui dépend de quoi (D-19).
- **À faire**
  - `resources/plugins/` construit par `npm run build` et emporté par `electron-builder` ; installation au premier
    lancement ; un plugin inclus se met à jour par le dépôt comme les autres, et peut être désactivé ;
  - résolution des dépendances (plages de versions semver) : installation dans l'ordre, refus d'une dépendance
    circulaire ou introuvable, refus de désinstaller un plugin dont un autre a besoin (en disant lequel) ;
  - à la désinstallation, choix de garder ou non `userData/plugin-data/<id>/` ;
  - brancher `webExtensions` (vues web) et `downloaders` (téléchargements), contributions de code sensible des
    plugins inclus (reporté de P3-03, PR #69) ;
  - copier `resources/plugins/` dans l'installateur (`extraResources` d'electron-builder) : sinon
    `process.resourcesPath/plugins`, que l'hôte de plugins lit une fois Mire installé, sera vide.
- **Critères d'acceptation** : tests de la résolution (versions compatibles, conflits, cycles) ; un plugin d'exemple
  inclus présent après un `npm run dist` (vérifié dans le test de fumée).

---

## P3-06 — Dépôt `mire-addons` : structure et publication

- **Dépend de** : P3-01 · **Taille** : M · 🧑
- **Objectif** : la chaîne qui publie les plugins officiels, réutilisable par un dépôt tiers.
- **À faire** (dans `jezoock/mire-addons`) :
  - espace de travail npm, un dossier par plugin, dépendance à `@mire/plugin-sdk` ;
  - CI : validation des manifestes, build, tests, empaquetage (`.tgz`), sha256, index signé en ed25519, Release
    GitHub et `index.json` publié ;
  - README (publier un plugin, conventions, niveaux), `CLAUDE.md` du dépôt (même logique que celui de Mire) ;
  - le format de l'index et la chaîne de publication sont décrits pour pouvoir être repris par un dépôt tiers ;
  - un plugin d'exemple (données seules) publié.
- **Vérification manuelle** 🧑 : créer la paire de clés de signature et ranger la clé privée dans les secrets du
  dépôt (action de ta part) ; la clé publique est intégrée à Mire par P3-07.
- **Critères d'acceptation** : le plugin d'exemple est publié par la CI ; l'index signé est lisible publiquement.

---

## P3-07 — Client des dépôts

- **Dépend de** : P3-05, P3-06 · **Taille** : L
- **Objectif** : installer, mettre à jour et désinstaller depuis les dépôts (l'écran viendra en P4-18).
- **À faire** : lecture des index de tous les dépôts configurés, cache hors ligne ; vérification de la signature
  (clé du dépôt officiel intégrée) et des empreintes ; installation avec les dépendances, mise à jour, retour à la
  version précédente si l'installation échoue ; API pour l'interface : plugins installés, disponibles, mises à jour,
  permissions et origine de chaque plugin, progression.
- **Critères d'acceptation** : avec le dépôt de test local, installation, mise à jour et désinstallation ; paquet
  altéré et index mal signé refusés ; fonctionnement hors ligne avec les plugins installés ; installation réelle du
  plugin d'exemple depuis `mire-addons` (mentionnée dans la PR).

---

## P3-08 — Dépôts tiers et confiance

- **Dépend de** : P3-07 · **Taille** : M
- **Objectif** : ouvrir Mire à d'autres dépôts sans baisser la sécurité (D-08, D-18).
- **À faire** : ajouter et retirer un dépôt (adresse de l'index et clé publique, empreinte de la clé à vérifier) ;
  origine et niveau de confiance de chaque plugin ; refus du préfixe `mire.` ; mise à jour seulement depuis le dépôt
  qui a installé le plugin ; un plugin tiers de code sensible exige l'accord explicite de l'utilisateur, plugin par
  plugin, avec un avertissement renforcé ; un hôte isolé par dépôt tiers ; au retrait d'un dépôt, ses plugins restent
  installés sans mise à jour, ou sont désinstallés, au choix.
- **Critères d'acceptation** : un dépôt tiers de test (généré avec la chaîne de P3-06) ajouté et un plugin installé
  depuis lui ; clé incorrecte, index altéré, préfixe réservé refusés ; plugin sensible refusé sans accord.
