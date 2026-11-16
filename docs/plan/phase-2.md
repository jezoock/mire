# Phase 2 — Éléments, tags et pages

But : remplacer les sections fixes par le modèle de l'architecture cible (`docs/architecture-cible.md`, D-15).
Tout ce que Mire peut ouvrir devient un **élément** du catalogue, avec des **tags** et des **infos**. Les **pages**
et les **listes** décrivent ce qu'on affiche et comment on le regroupe. Tout vit dans le processus principal et
dans `@mire/shared`, derrière le contrat IPC.

Prérequis : point d'étape **G2c** validé (décisions D-14 à D-22).

Principes :

- **L'interface ne change pas dans cette phase.** L'interface historique continue d'utiliser les méthodes IPC
  actuelles, qui restent servies jusqu'à son retrait (P4-23). Les nouvelles méthodes (`catalog.*`, `pages.*`,
  `lists.*`, `files.*`) sont testées sans interface. Exception : P2-04 fait passer les infos modifiées à la main par
  le nouveau stockage, derrière l'API actuelle.
- **Sources, tags automatiques et infos en ligne restent du code interne.** Leurs interfaces (`ElementSource`,
  `Tagger`, `MetadataProvider`) sont posées dans `src/main/catalog/types.ts` ; la phase 3 les publiera dans le SDK,
  et la phase 5 les déplacera dans des plugins.
- **Logique déplacée = logique testée** : ce qui quitte `src/renderer/domain/` ou `app.js` (regroupement des
  séries, des albums, des photos, recherche) garde ses tests et en gagne pour le nouveau comportement.
- **Performance** : objectif de l'architecture cible, une page calculée en moins de 50 ms pour 20 000 éléments.
  Un générateur de catalogue factice (`test/fixtures/catalog-factice.ts`) sert à le mesurer, dès P2-04.
- **Documentation** : chaque tâche met à jour `docs/architecture.md` (modules, flux, contrat IPC) pour ce qu'elle
  ajoute.

À la fin de la phase, point d'étape **G3** : bilan du modèle (types, IPC, mesures) avant de construire les plugins
et l'interface dessus.

---

## P2-01 — Modèle d'élément et catalogue

- **Dépend de** : G2c · **Taille** : M
- **Objectif** : poser le type `Element` et le catalogue qui les garde, avant d'y brancher les sources.
- **À faire**
  - types dans `@mire/shared` : `Element`, `OpenSpec` (fichier, site, jeu, programme, flux), `InfoValue`, origine
    d'un tag ou d'une info (`file`, `source`, `tagger`, `metadata`, `user`) ;
  - règles des **clés stables** pour chaque genre d'élément actuel : fichier local, fichier d'un serveur web, entrée
    d'une liste M3U, jeu de console, jeu PC, chaîne de télévision, site, marque-page. Une clé ne dépend jamais du
    rang d'un élément ni d'un nom affiché ;
  - `src/main/catalog/` : stockage en mémoire, persistance par emplacement de source dans `userData/catalog/`
    (écriture sûre de `src/main/storage/json-store.ts`), événements « éléments ajoutés, changés, retirés » ;
  - `catalog.element(key)` dans le contrat IPC.
- **Critères d'acceptation** : tests des règles de clés (mêmes clés après une nouvelle analyse, après un
  redémarrage, pour un chemin Windows et un chemin POSIX) ; aller-retour de la persistance ; aucun changement
  visible.

---

## P2-02 — Sources de la bibliothèque → éléments

- **Dépend de** : P2-01 · **Taille** : M
- **Objectif** : les fichiers trouvés par la bibliothèque deviennent des éléments.
- **À faire**
  - interface `ElementSource` (`src/main/catalog/types.ts`) : identifiant, emplacements gérés, analyse qui produit
    des éléments, **tags de source** déclarés (par exemple `remote` pour un serveur web) ;
  - adaptateurs pour les fournisseurs actuels de `src/main/library/providers/` (dossier local et partage réseau,
    serveur web, liste M3U), sous-titres compris ;
  - chaque analyse de la bibliothèque alimente aussi le catalogue ; `library.scan` et les méthodes actuelles
    continuent de renvoyer les `LibraryItem` attendus par l'interface historique.
- **Critères d'acceptation** : tests avec les dossiers de test existants ; un élément par fichier, avec ses tags de
  source ; analyses répétées sans doublon.

---

## P2-03 — Jeux, télévision et sites → éléments

- **Dépend de** : P2-02 · **Taille** : M
- **Objectif** : le reste de ce que Mire ouvre devient aussi des éléments.
- **À faire** : adaptateurs `ElementSource` pour
  - les jeux de console (`src/main/games/roms/`, jeux sur disque compris) : tag `game`, info `system` ;
  - les jeux PC (`src/main/games/pc/`) et les jeux ajoutés à la main : tag `game`, info `system` = `pc` ;
  - les marque-pages de jeux à télécharger (`src/main/games/bookmarks.ts`) ;
  - les chaînes de télévision (`src/main/tv/`) : tag `tv` ;
  - les sites et marque-pages de sites (`src/main/web/entries.ts`) : tag `stream`, info `category` (vidéo,
    musique, jeux…).
- **Critères d'acceptation** : tests par adaptateur ; le catalogue contient toutes les sortes d'éléments de la
  configuration de démonstration ; aucun changement visible.

---

## P2-04 — Moteur de tags et d'infos

- **Dépend de** : P2-02 · **Taille** : L
- **Objectif** : calculer les tags et les infos effectifs de chaque élément, et les retrouver vite.
- **À faire**
  - tags selon le type de fichier, tirés des formats reconnus (`KIND`, `EXT` de `@mire/shared`) : `video`, `audio`,
    `image` ; règles par extension gardées dans la configuration, modifiables ;
  - fusion des origines et **priorités** de l'architecture cible (à la main, puis infos en ligne, puis tags
    automatiques, puis source) ; un **retrait** à la main l'emporte sur l'automatique et survit aux analyses ;
  - stockage des modifications faites à la main (`userData/catalog/overrides.json`) qui reprend
    `src/main/meta/user-meta.ts` : l'API actuelle des infos modifiées à la main devient une façade sur ce stockage,
    pour que l'interface historique continue de fonctionner ;
  - registre des tags et des infos : identifiants du cœur (anglais, stables), noms affichés par les catalogues de
    textes (français et anglais), type de valeur d'une info ; tags créés par l'utilisateur ;
  - index en mémoire (tag → clés ; info → valeurs → clés) mis à jour par les événements du catalogue ;
  - générateur de catalogue factice pour les mesures ;
  - IPC : `catalog.setTags`, `catalog.setInfos`, `tags.list`.
- **Critères d'acceptation** : tests des priorités et des retraits ; migration des infos modifiées à la main sans
  perte ; requête « tous les éléments qui portent `video` et `series` » en moins de 50 ms sur 20 000 éléments
  factices (mesure dans la PR).

---

## P2-05 — Tags automatiques existants

- **Dépend de** : P2-04 · **Taille** : M
- **Objectif** : ce que l'interface devine aujourd'hui d'après les noms et les dossiers devient des tags et des
  infos, calculés dans le processus principal.
- **À faire**
  - interface `Tagger` : reçoit un élément, renvoie des tags et des infos ; rapide, sans réseau ;
  - cinq tags automatiques internes (ils deviendront les plugins inclus de la phase 5) :
    - séries : `series`, infos `series`, `season`, `episode` (`parseVideo`) ;
    - films : `movie`, infos `title`, `year` (`parseVideo`) ;
    - musique : infos `artist`, `album`, `track` d'après les dossiers (logique de `src/renderer/domain/items.ts`) ;
    - consoles : info `system` (`guessSystem`) ;
    - photos : info `folder` (regroupement par dossier de `app.js`) ;
  - le sixième de l'inventaire (genres et années) vient des infos en ligne : P2-06 ;
  - la logique reprise de `src/renderer/domain/` passe dans `@mire/shared` ou `src/main/catalog/` ; l'interface
    historique continue d'utiliser ses fonctions jusqu'à P4-23 (pas de copie : elle importe la version déplacée).
- **Critères d'acceptation** : tests de chaque tag automatique, en reprenant les cas des tests actuels
  (`test/renderer/`, `test/shared/`) ; « Friends S01E03.mkv » porte `video`, `series`, `series` = « Friends »,
  `season` = 1, `episode` = 3.

---

## P2-06 — Infos en ligne dans le catalogue

- **Dépend de** : P2-04 · **Taille** : M
- **Objectif** : les fiches des fournisseurs d'infos (`src/main/scrape/`) alimentent les infos et les images des
  éléments.
- **À faire** : base des fiches indexée par clé d'élément (migration des clés actuelles : chemin, `scrapeKey`,
  `metaKey`) ; une fiche devient des infos d'origine `metadata` (titre, année, genres, résumé) et des images
  (affiche, fond, logo) ; ordre de priorité des fournisseurs dans la configuration ; les recherches en cours et
  l'annulation restent celles du moteur actuel.
- **Critères d'acceptation** : tests de la migration des clés (aucune fiche perdue) ; une fiche TMDB factice se
  retrouve dans les infos de l'élément, sous la valeur saisie à la main si elle existe.

---

## P2-07 — Pages et regroupements

- **Dépend de** : P2-03, P2-05, P2-06 · **Taille** : L
- **Objectif** : le moteur qui calcule ce qu'une page affiche.
- **À faire**
  - type `PageDefinition` et son schéma JSON dans `@mire/shared` (exemple de l'architecture cible) ;
  - `userData/catalog/pages.json` ; les sept pages prêtes à l'emploi (Films, Séries, Musique, Images, Streaming,
    Télévision, Jeux) en données intégrées (elles deviendront un plugin inclus en P5-03) ;
  - calcul d'une page : `require`, `exclude`, `where` (égal, contient, entre deux valeurs), regroupements sur
    plusieurs niveaux (`groupBy`), groupe « Autres » pour les éléments sans l'info, tri, résultats par tranches
    (curseur) ;
  - IPC : `pages.list`, `pages.get`, `pages.save`, `pages.remove`, `catalog.page(pageId, path, cursor)` ; événement
    quand le contenu d'une page change.
- **Critères d'acceptation** : tests de chaque option ; Séries → Friends → Saison 1 → épisodes dans l'ordre ;
  page Jeux groupée par console ; mesure sur 20 000 éléments factices dans la PR.

---

## P2-08 — Listes

- **Dépend de** : P2-07 · **Taille** : S
- **Objectif** : les regroupements faits à la main, ordonnés.
- **À faire** : `userData/catalog/lists.json` ; créer, renommer, supprimer une liste ; ajouter, retirer, déplacer
  des éléments ; un élément disparu du catalogue reste dans la liste, marqué indisponible, jusqu'à ce qu'il revienne
  ou qu'on le retire ; une liste utilisable comme page (`catalog.page` sur une liste) ; IPC `lists.*`.
- **Critères d'acceptation** : tests (ordre gardé, élément disparu puis revenu).

---

## P2-09 — Recherche dans le catalogue

- **Dépend de** : P2-07 · **Taille** : M
- **Objectif** : chercher dans tous les éléments, leurs infos et leurs tags, côté processus principal.
- **À faire** : `catalog.search(query, options)` (noms, infos texte, noms des tags ; sans tenir compte des accents
  ni de la casse, en reprenant `src/renderer/domain/search.ts`) ; résultats groupés par page ; les fournisseurs
  `SearchProvider` (« Où regarder ») restent interrogés à part, comme aujourd'hui.
- **Critères d'acceptation** : tests repris de la recherche actuelle ; mesure sur 20 000 éléments factices.

---

## P2-10 — Gestion des fichiers

- **Dépend de** : P2-02 · **Taille** : M
- **Objectif** : le service qui permettra à l'explorateur de renommer, déplacer et supprimer (D-16).
- **À faire** : `src/main/fs/` ou `src/main/files/` : renommer, déplacer, supprimer un fichier ou un dossier
  **uniquement dans les dossiers autorisés**, par la politique d'accès (`src/main/security/`) et le contrôle de
  chemin de la suppression des jeux (`src/main/games/delete.ts`, P0-06) ; refus d'un chemin hors des dossiers, d'un
  lien symbolique qui en sort, d'un dossier racine ; le catalogue suit (clé mise à jour au renommage, modifications
  faites à la main conservées) ; IPC `files.rename`, `files.move`, `files.remove`. La confirmation est demandée par
  l'interface (P4-09).
- **Critères d'acceptation** : tests de sécurité (chemins hors des dossiers, `..`, liens symboliques, racines) ;
  tests du suivi par le catalogue.

---

## P2-11 — Migration de la configuration (v9)

- **Dépend de** : P2-07, P2-08 · **Taille** : M
- **Objectif** : une installation existante retrouve ses sections sous forme de pages.
- **À faire** : migration v8 → v9 dans `src/main/config/` : chaque section devient la page prête à l'emploi
  correspondante ; une section masquée devient une page non épinglée ; l'ordre et la position du menu sont gardés ;
  « Vos services » et les rangées de l'accueil deviennent des réglages de l'accueil ; les positions de reprise et les
  recherches récentes sont rattachées aux clés d'éléments. Les réglages qui iront aux plugins ne bougent pas ici
  (P5-01).
- **Critères d'acceptation** : tests avec `test/fixtures/config-v*.json` et une configuration v8 complète ; aucune
  donnée perdue ; la configuration migrée se réimporte.
