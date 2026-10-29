# Phase 3 — Addons et dépôt d'addons

But : un cœur minimal et des fonctionnalités installables depuis un dépôt dédié (`mire-addons`), dans l'esprit
de Mire (« rien n'est installé d'office »). Les points d'extension existent déjà sous forme d'interfaces internes
depuis la phase 1 ; cette phase les publie dans un SDK, ajoute l'hôte d'addons, le dépôt, puis déplace le code.

Prérequis : point d'étape **G3** : ADR P3-01 validée. Décisions déjà prises au point G0 : D-07 (code des addons
dans le processus principal derrière une API par messages), D-08 (dépôt officiel **et** dépôts tiers), D-09
(dépôt officiel `jezoock/mire-addons`, déjà créé, public).

Ordre : socle (P3-01 à P3-08), puis extractions — **addons de données d'abord** (aucun code exécuté, risque nul),
puis addons de code, du plus simple au plus lourd. Chaque extraction : le code ou les données quittent le cœur,
l'addon est publié dans `mire-addons`, une installation existante continue de fonctionner (P3-07).

Ces fiches seront affinées au point G3.

---

## Socle

### P3-01 — ADR : architecture des addons

- **Dépend de** : G3 · **Taille** : M (document)
- **À trancher et documenter** dans `docs/adr/0002-addons.md` :
  - natures d'addons : données (presets, catalogues, thèmes), code du processus principal (fournisseurs),
    contributions d'interface (composants de la phase 2) ; un addon peut combiner les trois ;
  - manifeste `mire-addon.json` : `id` (notation inversée, ex. `mire.scraper.tmdb`), `version` (semver),
    `engines.mire`, `contributes` (points d'extension et données), `settings` (rangés sous `addons.<id>` dans la
    config), `permissions` (hôtes réseau, lecture/écriture de dossiers, lancement de programmes, vues web) ;
  - liste des points d'extension et leur contrat (repris des interfaces de la phase 1) ;
  - exécution du code (D-07) : dans le processus principal au départ, derrière une API par messages qui permettra
    l'isolation en `utilityProcess` ; gestion des erreurs (un addon qui plante est désactivé, pas l'application) ;
  - confiance (D-08) : **plusieurs dépôts** dès la conception. Chaque dépôt publie un index signé (ed25519) ; la
    clé publique du dépôt officiel est intégrée à l'application, celle d'un dépôt tiers est fournie et acceptée
    par l'utilisateur à l'ajout du dépôt ; empreinte sha256 par paquet ; niveau de confiance (officiel / tiers)
    affiché partout ; règles en cas de conflit d'identifiant entre dépôts (un identifiant appartient au dépôt qui
    l'a installé ; préfixes réservés au dépôt officiel, par exemple `mire.*`) ;
  - versions et compatibilité, mises à jour, désinstallation (données de l'addon conservées ou non) ;
  - addons « intégrés » livrés avec l'application vs « installables ».

### P3-02 — `@mire/plugin-sdk`

- **Dépend de** : P3-01 · **Taille** : M
- **À faire** : types publics des points d'extension (`SourceProvider`, `MetadataProvider`, `SearchProvider`,
  `TvProvider`, `GameSourceProvider`, `Downloader`, `WebExtension`, `ExternalPlayer`, `EmulatorCatalog`, presets
  de sites et de services, `Theme`, `InputProfile`, contributions d'interface), contexte fourni aux addons
  (client HTTP, stockage de l'addon, réglages, journal, événements), JSON Schema du manifeste, outil
  `mire-addon validate`.
- **Critères d'acceptation** : les interfaces internes de la phase 1 sont remplacées par celles du SDK ; tests du
  validateur (manifestes valides et invalides).

### P3-03 — Hôte d'addons

- **Dépend de** : P3-02 · **Taille** : L
- **À faire** : `src/main/addons/` : découverte (addons intégrés + `userData/addons/<id>/<version>`), vérification
  du manifeste et de la compatibilité, activation et désactivation, registre des contributions consulté par les
  domaines (bibliothèque, métadonnées, recherche, TV, jeux, téléchargements, vue web, lecteurs), réglages par addon,
  permissions appliquées (le client HTTP de l'addon refuse un hôte non déclaré), journal d'erreurs par addon.
- **Critères d'acceptation** : un addon de test (fournisseur de métadonnées factice) installé à la main dans
  `userData/addons` est découvert, activé, utilisé, désactivé ; un addon qui lève une exception est désactivé
  avec un message clair.

### P3-04 — Contributions d'interface

- **Dépend de** : P3-03, P2-21 · **Taille** : M
- **À faire** : protocole `mire-addon://<id>/…` (lecture seule, limité au dossier de l'addon) ; CSP élargie à ce
  seul protocole ; chargement des composants d'interface d'un addon (préfixe de balise propre à l'addon) ; thèmes
  contribués (jetons + `theme.json`) ; onglets de réglages générés depuis les `settings` du manifeste (schéma de
  P1-26) ; widgets d'accueil.
- **Critères d'acceptation** : un addon de test ajoute un onglet de réglages et un thème ; aucun accès hors de
  son dossier par `mire-addon://`.

### P3-05 — Dépôt `mire-addons`

- **Dépend de** : P3-02, D-09 · **Taille** : M
- **À faire** (dans `jezoock/mire-addons`, déjà créé) : espace de travail npm (un dossier par addon), dépendance à
  `@mire/plugin-sdk` ; CI : validation des manifestes, build, tests, empaquetage (`.tgz`), sha256, signature de
  l'index, publication d'une Release GitHub et de `registry/index.json` ; README (publier un addon, conventions) ;
  `CLAUDE.md` du dépôt (même logique que celui de Mire). Le format de l'index et la chaîne de publication sont
  documentés de façon à pouvoir être repris par un dépôt tiers (modèle de dépôt d'addons).
- **Critères d'acceptation** : un addon d'exemple publié par la CI ; l'index signé est lisible publiquement.

### P3-06 — Client de registre et page « Modules »

- **Dépend de** : P3-03, P3-04, P3-05 · **Taille** : L · 🧑
- **À faire** : lecture des index de tous les dépôts configurés (cache hors ligne), vérification de la signature et des empreintes,
  installation, mise à jour, désinstallation ; page « Modules » dans Réglages (installés, disponibles, mises à
  jour, activer/désactiver, permissions demandées affichées avant installation) ; import de configuration :
  proposer d'installer les addons qu'elle utilise.
- **Critères d'acceptation** : installation et désinstallation de l'addon d'exemple depuis le dépôt réel ;
  paquet altéré refusé ; fonctionnement hors ligne avec les addons déjà installés.

### P3-07 — Continuité pour les installations existantes

- **Dépend de** : P3-06 · **Taille** : M
- **À faire** : à la première ouverture après la mise à jour, activer les addons correspondant à la configuration
  existante (clé TMDB → addon TMDB ; services configurés → pack de services ; sources web → fournisseur « serveur
  web » ; consoles de la boutique → catalogue d'émulateurs ; torrents utilisés → addon torrents…) ; migration de
  config v7 (réglages déplacés sous `addons.<id>`) ; message récapitulatif à l'utilisateur.
- **Critères d'acceptation** : tests avec les configurations de démonstration v1 à v6 ; aucune fonctionnalité
  perdue sans avertissement.

### P3-08 — Dépôts tiers

- **Dépend de** : P3-06 · **Taille** : M · 🧑
- **À faire** : ajouter et retirer un dépôt tiers (adresse de l'index + clé publique, empreinte de la clé affichée
  pour vérification) ; liste des dépôts dans la page « Modules » ; origine et niveau de confiance affichés sur
  chaque addon et avant chaque installation (avertissement renforcé pour un addon tiers qui demande l'exécution de
  programmes ou l'accès au disque) ; refus d'un addon tiers qui utilise un préfixe réservé ; mise à jour d'un addon
  uniquement depuis le dépôt qui l'a installé ; retrait d'un dépôt : ses addons restent installés mais ne se
  mettent plus à jour (ou sont désinstallés, au choix de l'utilisateur).
- **Critères d'acceptation** : un dépôt tiers de test (généré à partir du modèle de P3-05) ajouté, un addon
  installé depuis lui ; clé incorrecte ou index altéré refusés ; conflit d'identifiant avec le dépôt officiel refusé.

---

## Extractions — addons de données

Chaque fiche : déplacer les données hors du cœur vers un addon de `mire-addons`, garder dans le cœur seulement ce
qui est nécessaire au fonctionnement sans addon, tests de validation du contenu, entrée dans l'index.

| Tâche | Addon | Contenu actuel | Taille |
| --- | --- | --- | --- |
| P3-10 | Thèmes (un addon par thème ; « Écran éteint » reste intégré par défaut) | `themes/*.css` (P2-02) | S |
| P3-11 | Pack « Services de streaming » | `DEFAULT_WEB` : 15 services, couleurs, adresses de recherche, alias TMDB/JustWatch, lecture en fond | S |
| P3-12 | Pack « Télévision en France » | `DEFAULT_TV` : Freebox, Orange, SFR, B.tv, Molotov, adresses de détection | S |
| P3-13 | Pack « Sites de jeux légaux » | `romsites.js` : PDRoms, Homebrew Hub, Universal-DB, itch.io par système | S |
| P3-14 | Pack « Jeux libres » | `FREE_GAMES` (homebrew NES, Game Boy, Mega Drive…) | S |
| P3-15 | Profils de manettes | familles Xbox, PlayStation, Nintendo : détection et glyphes | S |

## Extractions — addons de code

| Tâche | Addon | Point d'extension | Contenu actuel | Taille |
| --- | --- | --- | --- | --- |
| P3-16 | Métadonnées TMDB | `MetadataProvider` | fournisseur TMDB + client (P1-16) | M |
| P3-17 | Métadonnées MusicBrainz + Cover Art Archive | `MetadataProvider` | fournisseur MusicBrainz | M |
| P3-18 | Métadonnées libretro (jaquettes, genres, années) | `MetadataProvider` | fournisseur libretro | M |
| P3-19 | Métadonnées Steam | `MetadataProvider` | fournisseur Steam | S |
| P3-20 | « Où regarder » (TMDB + JustWatch) | `SearchProvider` | P1-17 (dépend de P3-16) | S |
| P3-21 | Sources « serveur web » et « liste M3U » | `SourceProvider` | fournisseurs `http-index` et `m3u` (P1-14) | M |
| P3-22 | Télévision par playlist M3U | `TvProvider` | P1-15 | S |
| P3-23 | Torrents | `Downloader` | WebTorrent, `parse-torrent`, dossier `vendor/` et `overrides` quittent le cœur | L |
| P3-24 | Bloqueur de publicités (Ghostery) | `WebExtension` | P1-13, dépendances `@ghostery/*` | M |
| P3-25 | Compatibilité connexion Google | `WebExtension` | identité Electron sur `accounts.google.com` | S |
| P3-26 | Catalogue d'émulateurs | `EmulatorCatalog` | un émulateur = une entrée de données (sources, exécutables, arguments, BIOS) ; installateurs génériques restés dans le cœur (P1-18) | L |
| P3-27 | Scanner de jeux PC | `GameSourceProvider` | P1-20 | M |
| P3-28 | Lecteurs externes mpv et VLC | `ExternalPlayer` | détection et arguments (P1-11) | S |

🧑 pour P3-23 (torrents réels), P3-24 (YouTube sans publicité), P3-26 (installations réelles).

**Reste dans le cœur** : fenêtre, sécurité, configuration, stockage, IPC, protocoles, lecteurs intégrés, vue web
et Widevine (liés au binaire Electron castLabs, non extractibles), bibliothèque locale, téléchargements HTTP,
installateurs génériques de la boutique, extraction d'archives, navigation et manette, thème par défaut, hôte
d'addons.
