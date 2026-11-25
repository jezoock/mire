# Backlog de la refonte

Statuts : `à faire`, `en cours`, `en revue`, `faite`, `bloquée`, `abandonnée`. 🧑 = vérification manuelle sur
une vraie machine nécessaire. Tailles : S, M, L (voir `README.md`).

Mettre à jour la ligne de la tâche dans la PR qui la réalise (colonne Statut, et lien vers la PR).

## Point d'étape G0 — validé

| Élément | Statut |
| --- | --- |
| Analyse (`docs/analyse/ANALYSE.md`) | faite (validée le 29/10/2026) |
| Décisions D-01 à D-10 (`ANALYSE.md` § 10) | faite, sauf D-05 (frontend) reportée au point G2 |
| Découpage en tâches (ce fichier et les fiches) | faite ; phase 2 à réécrire au point G2 |

## Phase 0 — Filet de sécurité

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P0-01 | Outillage : lint, formatage, éditeur | S | — | | faite | [#2](https://github.com/jezoock/mire/pull/2) |
| P0-02 | Tests des modules déjà testables | M | P0-01 | | faite | [#3](https://github.com/jezoock/mire/pull/3) |
| P0-03 | Extraction mécanique des fonctions pures de `main.js` + tests | M | P0-01 | | faite | [#4](https://github.com/jezoock/mire/pull/4) |
| P0-04 | Intégration continue | S | P0-02, P0-03 | | faite | [#7](https://github.com/jezoock/mire/pull/7) |
| P0-05 | Correctif : portails TV web (SFR, B.tv, Molotov) | S | P0-03 | 🧑 | faite | [#9](https://github.com/jezoock/mire/pull/9) |
| P0-06 | Correctif : contrôle du chemin avant suppression d'un jeu | S | P0-03 | | faite | [#12](https://github.com/jezoock/mire/pull/12) |
| P0-07 | Nettoyage du code mort et petites incohérences | S | P0-01, P0-03 | | faite | [#11](https://github.com/jezoock/mire/pull/11) |
| P0-08 | Mise à jour de sécurité d'Electron castLabs (pas avant le 5 nov. 2026) | S | — | 🧑 | faite | [#14](https://github.com/jezoock/mire/pull/14) |
| P0-09 | Test de fumée Electron et captures de référence | M | P0-03, P0-04 | | faite | [#10](https://github.com/jezoock/mire/pull/10) |
| P0-10 | Correctif : titre de film qui commence par une année | S | P0-02 | | faite | [#6](https://github.com/jezoock/mire/pull/6) |
| P0-11 | Correctif : adresses complètes dans un `.m3u` distant | S | P0-02 | | faite | [#13](https://github.com/jezoock/mire/pull/13) |
| **G1** | **Point d'étape : fin de la phase 0** — ✅ validé le 10/11/2026 (P0-08 menée en parallèle de la phase 1) | | P0-01…P0-11 | | | |

## Phase 1 — Refacto modulaire

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | Squelette : arborescence, TypeScript, build | L | G1, D-01, D-02 | | faite | [#16](https://github.com/jezoock/mire/pull/16) |
| P1-02 | `@mire/shared` : texte, URL, identifiants | M | P1-01 | | faite | [#18](https://github.com/jezoock/mire/pull/18) |
| P1-03 | `@mire/shared` : formats et référentiel des systèmes | M | P1-02 | | faite | [#24](https://github.com/jezoock/mire/pull/24) |
| P1-04 | Client HTTP unique | M | P1-01 | | faite | [#17](https://github.com/jezoock/mire/pull/17) |
| P1-05 | Stockage JSON atomique | M | P1-01 | | faite | [#19](https://github.com/jezoock/mire/pull/19) |
| P1-06 | Service de configuration | L | P1-02, P1-05 | | faite | [#22](https://github.com/jezoock/mire/pull/22) |
| P1-07 | Identifiants stables des consoles (migration v6) | L | P1-06, P1-08 | | faite | [#23](https://github.com/jezoock/mire/pull/23) |
| P1-08 | Contrat IPC typé | M | P1-01 | | faite | [#21](https://github.com/jezoock/mire/pull/21) |
| P1-09 | Données d'usage côté processus principal | S | P1-05, P1-08, D-06 | | faite | [#36](https://github.com/jezoock/mire/pull/36) |
| P1-10 | Sécurité des chemins et protocole `media://` | M | P1-06 | | faite | [#25](https://github.com/jezoock/mire/pull/25) |
| P1-11 | Plateforme : lancement de programmes, lecteurs, navigateurs | S | P1-01 | 🧑 | faite | [#30](https://github.com/jezoock/mire/pull/30) |
| P1-12 | Vues web intégrées | L | P1-02, P1-08 | 🧑 | faite | [#32](https://github.com/jezoock/mire/pull/32) |
| P1-13 | Bloqueur de publicités en extension de vue web | M | P1-12 | 🧑 | faite | [#33](https://github.com/jezoock/mire/pull/33) |
| P1-14 | Bibliothèque : sources, parcours, sous-titres | M | P1-03, P1-04, P1-10 | | faite | [#29](https://github.com/jezoock/mire/pull/29) |
| P1-15 | Télévision | S | P1-04, P1-12, P1-14 | 🧑 | faite | [#34](https://github.com/jezoock/mire/pull/34) |
| P1-16 | Moteur de métadonnées et fournisseurs | L | P1-03, P1-04, P1-05 | 🧑 | faite | [#35](https://github.com/jezoock/mire/pull/35) |
| P1-17 | Recherche « où regarder » | S | P1-16 | | faite | [#37](https://github.com/jezoock/mire/pull/37) |
| P1-18 | Archives et boutique | M | P1-03, P1-04, P1-07 | 🧑 | faite | [#26](https://github.com/jezoock/mire/pull/26) |
| P1-19 | Téléchargements | L | P1-05, P1-07, P1-18 | 🧑 | faite | [#28](https://github.com/jezoock/mire/pull/28) |
| P1-20 | Jeux | L | P1-07, P1-10, P1-11, P1-14, P1-19 | 🧑 | faite | [#31](https://github.com/jezoock/mire/pull/31) |
| P1-21 | Racine de composition | M | P1-06…P1-20 | | faite | [#41](https://github.com/jezoock/mire/pull/41) |
| P1-22 | Renderer : modules, outils, état, client API | M | P1-01, P1-08 | | faite | [#38](https://github.com/jezoock/mire/pull/38) |
| P1-23 | Renderer : logique de domaine testée | M | P1-22, P1-03 | | faite | [#40](https://github.com/jezoock/mire/pull/40) |
| P1-24 | Renderer : navigation, clavier, manette, lecteurs | M | P1-22 | 🧑 | faite | [#43](https://github.com/jezoock/mire/pull/43) |
| P1-25 | Renderer : vues et actions par domaine | L | — | | abandonnée (D-05 : remplacée par la phase 2) | |
| P1-26 | Schéma des réglages | M | P1-06 | | faite | [#27](https://github.com/jezoock/mire/pull/27) |
| P1-27 | Documentation d'architecture | S | P1-21, P1-26 | | faite | [#44](https://github.com/jezoock/mire/pull/44) |
| P1-28 | Localisation : socle (catalogues, langue de l'interface) | M | P1-01, P1-06, D-11 | | faite | [#39](https://github.com/jezoock/mire/pull/39) |
| P1-29 | Localisation du processus principal (français et anglais) | L | P1-28, P1-21 | | faite | [#42](https://github.com/jezoock/mire/pull/42) |
| **G2** | **Point d'étape : fin de la phase 1** — ✅ validé le 12/11/2026 (décisions D-12 et D-13, fiches de la phase 2 complétées) | | P1-01…P1-29 (sauf P1-25) | | | |

Pistes parallèles après P1-01 : processus principal (P1-02 → P1-21) et renderer (P1-22 → P1-24).

## Point d'étape G2c — nouvelle architecture

| Élément | Statut | PR |
| --- | --- | --- |
| Tri de tous les éléments de Mire (`inventaire-plugins.md`) | fait le 16/11/2026 | [#46](https://github.com/jezoock/mire/pull/46) |
| Architecture cible (`docs/architecture-cible.md`) et décisions D-14 à D-22 | faite (validée le 16/11/2026) | [#46](https://github.com/jezoock/mire/pull/46) |
| Q-01 : thèmes avec leur propre code | tranchée le 16/11/2026 : oui, avec une API large (D-23) | |
| Fiches des phases 2 à 6 et ce backlog | en revue | |

Les phases 2 et 3 d'origine (« Frontend avec dot-stash », « Addons ») sont remplacées : correspondance dans
`README.md`.

## Phase 2 — Éléments, tags et pages

Fiches dans `phase-2.md`.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 | Modèle d'élément et catalogue | M | G2c |  | faite | [#48](https://github.com/jezoock/mire/pull/48) |
| P2-02 | Sources de la bibliothèque → éléments | M | P2-01 |  | faite | [#50](https://github.com/jezoock/mire/pull/50) |
| P2-03 | Jeux, télévision et sites → éléments | M | P2-02 |  | faite | [#56](https://github.com/jezoock/mire/pull/56) |
| P2-04 | Moteur de tags et d'infos | L | P2-02 |  | faite | [#52](https://github.com/jezoock/mire/pull/52) |
| P2-05 | Tags automatiques existants | M | P2-04 |  | faite | [#54](https://github.com/jezoock/mire/pull/54) |
| P2-06 | Infos en ligne dans le catalogue | M | P2-04 |  | faite | [#55](https://github.com/jezoock/mire/pull/55) |
| P2-07 | Pages et regroupements | L | P2-03, P2-05, P2-06 |  | faite | [#58](https://github.com/jezoock/mire/pull/58) |
| P2-08 | Listes | S | P2-07 |  | faite | |
| P2-09 | Recherche dans le catalogue | M | P2-07 |  | faite | |
| P2-10 | Gestion des fichiers | M | P2-02 |  | faite | |
| P2-11 | Migration de la configuration (v9) | M | P2-07, P2-08 |  | faite | |
| **G3** | **Point d'étape : fin de la phase 2 (modèle, IPC, mesures)** | | P2-01…P2-11 | | | |
| P2-12 | Finitions du modèle | S | G3 |  | faite | |

## Phase 3 — Socle des plugins et dépôts

Fiches dans `phase-3.md`.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P3-01 | `@mire/plugin-sdk` et manifeste | M | G3 |  | faite | [#65](https://github.com/jezoock/mire/pull/65) |
| P3-02 | Prototype de l'hôte isolé | M | P3-01 |  | faite | [#67](https://github.com/jezoock/mire/pull/67) |
| P3-03 | Hôte de plugins | L | P3-02 |  | faite | [#69](https://github.com/jezoock/mire/pull/69) |
| P3-04 | Contexte et permissions des plugins | M | P3-03 |  | faite | |
| P3-05 | Plugins inclus et dépendances | M | P3-03 |  | faite | |
| P3-06 | Dépôt `mire-addons` : structure et publication | M | P3-01 | 🧑 | faite | [mire-addons#1](https://github.com/jezoock/mire-addons/pull/1) |
| P3-07 | Client des dépôts | L | P3-05, P3-06 |  | faite | [#95](https://github.com/jezoock/mire/pull/95) |
| P3-08 | Dépôts tiers et confiance | M | P3-07 |  | faite | [#97](https://github.com/jezoock/mire/pull/97) |
| **G4** | **Point d'étape : fin de la phase 3 (hôte isolé, SDK, publication)** — ✅ validé le 19/11/2026 (🧑 vérification de la sandbox de l'hôte isolé sur une vraie machine encore à faire) | | P3-01…P3-08 | | | |

## Phase 4 — Interface : dot-stash, explorateur et thèmes

Fiches dans `phase-4.md`. P4-01 à P4-04 ne dépendent pas des phases 2 et 3.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P4-01 | Intégration de dot-stash et `@mire/ui` | M | G2c, DS-01, DS-02, DS-08 |  | faite | [#49](https://github.com/jezoock/mire/pull/49) |
| P4-02 | Habillage du cœur et palettes | M | P4-01 |  | faite | [#51](https://github.com/jezoock/mire/pull/51) |
| P4-03 | Navigation clavier et manette sur les composants | L | P4-01, P1-24 | 🧑 | faite | |
| P4-03b | Navigation : attente du rendu des composants | S | P4-03 |  | faite | [#64](https://github.com/jezoock/mire/pull/64) |
| P4-04 | Contrôleurs, actions et traduction | M | P4-01, P1-22, P1-23 |  | faite | [#53](https://github.com/jezoock/mire/pull/53) |
| **G5** | **Point d'étape : intégration, palettes, navigation, contrôleurs** | | P4-01…P4-04 | | | |
| P4-05 | Composants d'éléments | M | P4-02, P4-03, P4-04 |  | faite | [#66](https://github.com/jezoock/mire/pull/66) |
| P4-06 | Boîtes de dialogue et formulaires | M | P4-02, P4-03 |  | faite | [#68](https://github.com/jezoock/mire/pull/68) |
| P4-07 | Coquille de l'application | L | P4-05, P4-06, P2-07 |  | faite | [#70](https://github.com/jezoock/mire/pull/70) |
| P4-08 | Explorateur | L | P4-07, P2-08, P2-09 | 🧑 | faite ([#79](https://github.com/jezoock/mire/pull/79), [#82](https://github.com/jezoock/mire/pull/82)) | |
| P4-09 | Gérer ses fichiers et sélection multiple | M | P4-08, P2-10 |  | faite | [#87](https://github.com/jezoock/mire/pull/87) |
| P4-10 | Mode secours | S | P4-08, P4-11 | 🧑 | faite | |
| P4-11 | Moteur de thèmes et vue de page | L | P4-05, P4-07, P2-07 |  | faite | [#73](https://github.com/jezoock/mire/pull/73) |
| P4-12 | Accueil | M | P4-11 |  | faite | [#74](https://github.com/jezoock/mire/pull/74) |
| P4-13 | Recherche | M | P4-11, P2-09 |  | faite | [#77](https://github.com/jezoock/mire/pull/77) |
| P4-14 | Lecteur vidéo | M | P4-07 | 🧑 | faite | [#83](https://github.com/jezoock/mire/pull/83) |
| P4-15 | Lecteurs de musique et d'images | M | P4-14 |  | faite | [#90](https://github.com/jezoock/mire/pull/90) |
| P4-16 | Vue web et télévision | M | P4-11 | 🧑 | faite | [#85](https://github.com/jezoock/mire/pull/85) |
| P4-17 | Jeux : consoles et émulateurs | M | P4-11, P4-06 | 🧑 | faite | [#84](https://github.com/jezoock/mire/pull/84) |
| P4-18 | Centre : téléchargements et apps | M | P4-07, P4-06 |  | faite | [#75](https://github.com/jezoock/mire/pull/75) |
| P4-19 | Centre : plugins et dépôts | M | P4-18, P3-07, P3-08 | 🧑 | faite | [#99](https://github.com/jezoock/mire/pull/99) |
| P4-20 | Réglages | M | P4-07, P3-04, P1-26, DS-06 |  | faite ([#80](https://github.com/jezoock/mire/pull/80), [#86](https://github.com/jezoock/mire/pull/86)) | |
| P4-21 | Administration des tags, des pages et des listes | M | P4-20, P2-07, P2-08 |  | faite ([#91](https://github.com/jezoock/mire/pull/91), [#93](https://github.com/jezoock/mire/pull/93)) | |
| P4-22 | Éditeurs | M | P4-06, P4-11 |  | faite | [#78](https://github.com/jezoock/mire/pull/78), [#81](https://github.com/jezoock/mire/pull/81) |
| P4-23 | Assistant du premier lancement | M | P4-19, P4-20 | 🧑 | faite | [#106](https://github.com/jezoock/mire/pull/106) |
| P4-24a1 | Retrait de l'interface historique : vues, pont, panneau, boîtes, styles | M | P4-08…P4-23, P4-29 | 🧑 | faite | [#119](https://github.com/jezoock/mire/pull/119) |
| P4-24a2 | Retrait de l'interface historique : racine de composition, méthodes IPC, `domain/` | M | P4-24a1 | 🧑 | à faire | |
| P4-24b | Audits : accessibilité, performance, comparaison des captures | M | P4-24a2 |  | à faire | |
| P4-25 | Guide « Créer un thème » | S | P4-11, P4-24a2 |  | à faire | |
| P4-26 | Sélecteur de langue et finitions de la localisation | S | P4-20, P4-24a2, P1-28, P1-29 |  | à faire | |
| P4-27 | Thèmes avec leur propre code : cadre et API | L | P4-11, P4-24a2, P3-04 | 🧑 | à faire | |
| P4-28 | Thème d'exemple avec code et guide | M | P4-27, P4-25 |  | à faire | |
| P4-29 | Fonctions manquantes de la nouvelle interface | M | P4-17, P4-13, P4-21 |  | faite | [#120](https://github.com/jezoock/mire/pull/120) |
| **G6** | **Point d'étape : fin de la phase 4** | | P4-01…P4-28 | | | |

### Dans dot-stash (dépôt `jezoock/dot-stash`)

Pull requests sur le dépôt de dot-stash, chacune validée par toi, au contrat de dot-stash (habillage du thème
`default`, accessibilité, textes traduisibles, tests unitaires et navigateur, readme, CHANGELOG). Elles peuvent
avancer en parallèle des tâches de Mire. La colonne « dot-stash » donne la tâche du backlog de dot-stash.

| ID | Tâche | Taille | Dépend de | dot-stash | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| DS-00 | Poser le tag `v0.1.0` sur le commit de fusion de la 0.1.0 (action de ta part) | XS | — | B-117 | faite (tag `v0.1.0` posé sur dot-stash) | |
| DS-01 | Release : archive construite attachée à la release GitHub, installation par adresse | S | DS-00 | B-119, B-120 | faite | [dot-stash#4](https://github.com/jezoock/dot-stash/pull/4) |
| DS-02 | Moteur SCSS dans le paquet (`scss/` dans `files` et `exports`) | XS | — | B-142 | faite (version 0.2.0) | [dot-stash#5](https://github.com/jezoock/dot-stash/pull/5) |
| DS-03 | `ds-range` : curseur habillé, remplissage jusqu'à la valeur | M | — | à créer | faite | [dot-stash#3](https://github.com/jezoock/dot-stash/pull/3) |
| DS-04 | `ds-thumb` : image à proportions fixes, chargement différé, carton de remplacement | M | — | à créer | faite | [dot-stash#3](https://github.com/jezoock/dot-stash/pull/3) |
| DS-05 | `ds-scroller` : rangée défilante qui garde l'élément focalisé visible | M | — | à créer | faite | [dot-stash#3](https://github.com/jezoock/dot-stash/pull/3) |
| DS-06 | `ds-sortable` : liste ordonnable au clavier | M | — | à créer | faite | [dot-stash#3](https://github.com/jezoock/dot-stash/pull/3) |
| DS-07 | Imports par composant (`dist-custom-elements`), si P4-01 en a besoin | S | — | B-122, B-123 | abandonnée | P4-01 : le chargeur paresseux suffit |
| DS-08 | Rendre le dépôt public (action de ta part, D-13) : l'archive de la release s'installe par son adresse sans jeton | XS | DS-01 | — | faite (dépôt public, release [v0.2.0](https://github.com/jezoock/dot-stash/releases/tag/v0.2.0) avec `dot-stash-0.2.0.tgz`) | |

## Phase 5 — Extraction en plugins

Fiches dans `phase-5.md`. Chaque tâche publie un ou plusieurs plugins dans `jezoock/mire-addons`.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P5-01 | Continuité pour les installations existantes | M | P3-07, P2-11 |  | faite | [#98](https://github.com/jezoock/mire/pull/98) |
| P5-02 | Palettes Plein jour, Minuit, Velours | S | P5-01, P4-02 |  | faite | |
| P5-03 | Pages prêtes à l'emploi | S | P5-01, P2-07 |  | faite | |
| P5-04 | Profils de manettes | S | P5-01, P4-03 |  | faite | |
| P5-05 | Services de streaming | M | P5-01 | 🧑 | faite | |
| P5-06 | Télévision : liste M3U, portail web, packs des box | M | P5-01, P3-05 | 🧑 | à faire | |
| P5-07 | Sites de jeux légaux, jeux libres | S | P5-01 |  | faite | |
| P5-08 | Langue française et packs de langue | M | P5-01, P4-26 |  | à faire | |
| P5-09 | Tags automatiques | M | P5-01, P2-05, P2-06 |  | faite | [#108](https://github.com/jezoock/mire/pull/108) |
| P5-10 | Thème Mire | S | P4-11, P4-24a2 |  | à faire | |
| P5-11a | Socle des sources de fichiers | M | P5-01, P3-04 |  | faite | [#107](https://github.com/jezoock/mire/pull/107) |
| P5-11b | Sous-titres | S | P5-11a |  | faite | |
| P5-11c | Dossier local | M | P5-11a |  | faite | |
| P5-11d | Partage réseau | S | P5-11a, P5-11c | 🧑 | faite | [#115](https://github.com/jezoock/mire/pull/115) |
| P5-12 | Serveur web, liste M3U | M | P5-11a |  | faite | [#117](https://github.com/jezoock/mire/pull/117) |
| P5-13a | Jeux PC : dossiers de jeux | M | P5-01, P5-11a | 🧑 | faite | [#111](https://github.com/jezoock/mire/pull/111) |
| P5-13b | Jeux PC : jeu ajouté à la main | M | P5-13a | 🧑 | à faire | |
| P5-14a | Jeux de console : dossiers d'une console | M | P5-01, P5-11a |  | faite | |
| P5-14b | Jeux de console : sources en ligne d'une console | S | P5-14a, P5-12 |  | à faire | |
| P5-14c | Marque-pages de jeux (reportée : SDK des téléchargements, avec P5-18) | M | P5-14a, P5-18 |  | à faire | |
| P5-15 | Infos en ligne TMDB et « Où regarder » | M | P5-01, P2-06 |  | faite | [#101](https://github.com/jezoock/mire/pull/101) |
| P5-16 | Infos en ligne MusicBrainz, libretro, Steam | M | P5-01, P2-06 |  | faite | [#112](https://github.com/jezoock/mire/pull/112) |
| P5-17 | Bloqueur de publicités, connexion Google | M | P5-01 | 🧑 | à faire | |
| P5-18 | Torrents | L | P5-01 | 🧑 | à faire | |
| P5-19a | Émulateurs : socle, RetroArch, DuckStation | M | P5-01, P4-17 | 🧑 | faite | [#118](https://github.com/jezoock/mire/pull/118) |
| P5-19b | Émulateurs : PCSX2, PPSSPP, Dolphin, melonDS, Azahar, Cemu | M | P5-19a | 🧑 | à faire | |
| P5-20 | Lecteurs externes mpv et VLC | S | P5-01 |  | faite | |
| P5-21 | Bilan du cœur | S | P5-02…P5-20 |  | à faire | |
| **G7** | **Point d'étape : fin de la phase 5, bilan du cœur** | | P5-01…P5-21 | | | |

## Phase 6 — Nouveaux plugins

Fiches dans `phase-6.md`. Publiés dans `jezoock/mire-addons` ; elles peuvent commencer dès que leurs dépendances
sont faites.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P6-01 | Infos des fichiers audio | M | P5-09 |  | à faire | |
| P6-02 | Infos des photos | S | P5-09 |  | à faire | |
| P6-03 | ARTE, TF1+, M6+, TV5MONDEplus, Auvio, Play RTS, ICI TOU.TV | S | P5-05 | 🧑 | à faire | |
| P6-04 | ADN, Rakuten TV, MUBI, Pluto TV, Twitch, Dailymotion | S | P5-05 | 🧑 | à faire | |
| P6-05 | YouTube Music, Apple Music, Tidal, Qobuz, SoundCloud, Radio France | S | P5-05 | 🧑 | à faire | |
| P6-06 | Xbox Cloud Gaming, GeForce NOW, Boosteroid | M | P5-05 | 🧑 | à faire | |
| P6-07 | Radios du monde | M | P5-11 |  | à faire | |
| P6-08 | Podcasts | M | P5-11 |  | à faire | |
| P6-09 | Serveur Jellyfin ou Emby | M | P5-12 | 🧑 | à faire | |
| P6-10 | Serveur Plex | M | P5-12 | 🧑 | à faire | |
| P6-11 | Partages DLNA | M | P5-12 | 🧑 | à faire | |
| P6-12 | Stockage WebDAV | S | P5-12 |  | à faire | |
| P6-13 | TVmaze, TheTVDB, AniList | M | P5-15 |  | à faire | |
| P6-14 | fanart.tv, OMDb, Wikipédia et Wikidata | M | P5-15 |  | à faire | |
| P6-15 | Trakt | M | P5-15 |  | à faire | |
| P6-16 | OpenSubtitles | M | P5-11 |  | à faire | |
| P6-17 | Last.fm, Discogs, pochettes Deezer | M | P5-16 |  | à faire | |
| P6-18 | Paroles synchronisées | M | P5-16, P4-15 |  | à faire | |
| P6-19 | ScreenScraper | M | P5-16 |  | à faire | |
| P6-20 | IGDB, TheGamesDB, SteamGridDB | M | P5-16 |  | à faire | |
| P6-21 | LaunchBox Games DB | M | P5-16 |  | à faire | |
| P6-22 | RetroAchievements | M | P5-16 |  | à faire | |
| P6-23 | Lieux des photos | S | P6-02 |  | à faire | |
| P6-24 | Programme TV | M | P5-06 |  | à faire | |
| P6-25 | Mesen, Snes9x, mGBA, Rosalie's Mupen GUI | M | P5-19 | 🧑 | à faire | |
| P6-26 | ares, BlastEm, Mednafen, Flycast | M | P5-19 | 🧑 | à faire | |
| P6-27 | MAME, Stella, DOSBox Staging, ScummVM | M | P5-19 | 🧑 | à faire | |
| P6-28 | RPCS3, shadPS4, Vita3K | M | P5-19 | 🧑 | à faire | |
| P6-29 | xemu, Xenia, émulateur Switch | M | P5-19 | 🧑 | à faire | |
| P6-30 | Thèmes Mur d'affiches, Salon, Liste compacte | M | P4-25, P4-28 |  | à faire | |

## Pistes repérées en cours de route

Améliorations notées dans les PR, à arbitrer (une piste retenue devient une tâche ou rejoint une fiche).

| Piste | Origine | Proposition |
| --- | --- | --- |
| `parseVideo` lit une année future dans le titre (`Blade Runner 2049` seul → « Blade Runner », 2049) | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | ✅ Retenue au point G1, traitée dans P1-16 |
| `RETROARCH_SYSTEMS` n'est pas exporté : le test des catalogues le retrouve via l'émulateur RetroArch | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | ✅ Traitée par P1-18 : `RETROARCH_SYSTEMS` exporté par `src/main/store/catalog/` |
| `GAME_FILE_RE` ne reconnaît pas `jeu.zip?dl=1` | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | ✅ Traitée dans P1-12 : `windowOpenAction` teste le chemin de l'adresse, test ajouté pour `jeu.zip?dl=1` |
| Node 22 décode mal Windows-1252 (octets 0x80 à 0x9F : €, ’, œ) ; le Node d'Electron 44 (24.21) est correct, l'application n'est pas touchée. Le test de `decodeText` concerné est sauté sous Node 22 | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Close : la CI (P0-04) exécute ce test sous Node 22 et 24 ; le défaut venait du Node du conteneur de développement |
| `migrateConfig` 1 → 2 cherche les valeurs par défaut dans `DEFAULT_CONFIG.web`, vide depuis que rien n'est installé d'office : `search`, `background` et `providers` ne sont plus complétés (le passage 2 → 3 compense pour les sites connus) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Retenue au point G1 : intégrée à P1-06 |
| `migrateConfig` 2 → 3 ajoute encore les 15 sites de `DEFAULT_WEB` à une config v1 ou v2, contrairement au commentaire de la v5 (« on garde ceux que l'utilisateur a réellement ») | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Retenue au point G1 : ne plus ajouter de sites ; intégrée à P1-06 |
| `migrateConfig` v5 contient un `if` vide (`ui.home.services`) ; `KNOWN_WEB` est inutilisé (désormais dans `lib/config.js`) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Traitée dans P0-07 ([#11](https://github.com/jezoock/mire/pull/11)) |
| `resolveLocation` simulant macOS ou Linux depuis Windows : `path.join` produit des barres obliques inverses (les tests passent par `path.join` pour rester portables) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Intégrée à P1-14 ([#29](https://github.com/jezoock/mire/pull/29)) |
| `adblock.start()` télécharge les listes de filtres au démarrage même quand le bloqueur est désactivé (`adblock.enabled: false`) ; le test de fumée dépose un moteur vide en cache pour l'éviter | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | ✅ Traitée dans P1-13 : listes chargées seulement une fois le bloqueur activé ; le test de fumée ne dépose plus de moteur vide |
| Le test de fumée ne tourne que sous Linux (Xvfb) | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | L'ajouter à des runners CI Windows et macOS quand la phase 1 sera avancée ; Widevine reste à vérifier à la main |
| Les captures de référence varient de quelques pixels d'une exécution à l'autre (lissage des bords, écart de 16/255 au plus) | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | Comparaison automatique avec seuil de tolérance, dans P2-21 |
| Un lien symbolique placé dans un dossier autorisé est servi par `media://` (comparaison du chemin tel quel) ; risque faible : il faut déjà pouvoir écrire dans la bibliothèque | P1-10 ([#25](https://github.com/jezoock/mire/pull/25)) | Durcissement par `fs.realpath` (racines et fichier) dans une tâche dédiée, à tester sous Windows (`subst`, lecteurs réseau, lien vers un autre disque) ; variante : refuser seulement si le chemin réel sort des racines réelles et que `lstat` montre un lien |
| `fetchToCache` attend sans fin si le téléchargement ne démarre jamais | P1-19 ([#28](https://github.com/jezoock/mire/pull/28)) | ✅ Traitée dans P1-20 ([#31](https://github.com/jezoock/mire/pull/31)) |
| Deux demandes pour la même adresse en même temps : la seconde remplace la première dans `pendingUrls`, la première ne se résout jamais | P1-19 ([#28](https://github.com/jezoock/mire/pull/28)) | ✅ Traitée dans P1-20 ([#31](https://github.com/jezoock/mire/pull/31)) |
| La copie dans le cache déclenche `download-finished`, donc le message « X est téléchargé » | P1-19 ([#28](https://github.com/jezoock/mire/pull/28)) | ✅ Traitée dans P1-20 ([#31](https://github.com/jezoock/mire/pull/31)) |
| Passer au lecteur externe les sous-titres trouvés (`--sub-file=`, variable `{sub}`) | P1-11 ([#30](https://github.com/jezoock/mire/pull/30)) | À arbitrer |
| Jeux PC : une extension en capitales (`Jeu.AppImage`) n'est pas retirée du nom affiché | P1-20 ([#31](https://github.com/jezoock/mire/pull/31)) | À arbitrer |
| Retirer un marque-page de jeu oublie sa fiche mais pas son image (comme `forget` du scraper) | P1-20 ([#31](https://github.com/jezoock/mire/pull/31)) | À arbitrer |
| Vue web fermée (Ctrl+W) pendant le plein écran du lecteur vidéo : l'état « plein écran de la page » n'est pas remis à zéro, la fenêtre peut rester en plein écran | P1-12 ([#32](https://github.com/jezoock/mire/pull/32)) | À arbitrer (remise à zéro dans `close` du gestionnaire) |
| Configuration enregistrée : seuls les sites enregistrés ouverts reprennent leur entrée à jour ; un marque-page, un portail TV ou une console renommés gardent l'ancien nom tant que la vue est ouverte | P1-12 ([#32](https://github.com/jezoock/mire/pull/32)) | À arbitrer (résoudre de nouveau toutes les vues ouvertes par le registre d'entrées) |
| L'interface (`viewWeb`) reconstitue le nom et la couleur des vues `rom:`, `bm:` et `tv:` avec ses propres couleurs, en double de `lib/web-entry.js` ; l'état publié (`web-state`) les contient déjà | P1-12 ([#32](https://github.com/jezoock/mire/pull/32)) | ✅ Intégrée à P2-14 au point G2 |
| Réglages du bloqueur désactivé et jamais chargé : le texte d'état annonce « Les listes se téléchargent au premier lancement », alors qu'elles se téléchargent à l'activation | P1-13 ([#33](https://github.com/jezoock/mire/pull/33)) | ✅ Intégrée à P2-19 au point G2 (texte de l'interface) |
| Activer le bloqueur la première fois attend les listes dix secondes au plus ; au-delà, les sites rechargés peuvent montrer des publicités jusqu'à la fin du téléchargement | P1-13 ([#33](https://github.com/jezoock/mire/pull/33)) | À arbitrer (recharger les vues ouvertes une fois les listes prêtes) |
| `MainContext` garde `any` pour `scraper`, `store`, `downloads`, `adblock` : les typer fait apparaître des écarts avec le contrat IPC (`downloadsList`, `adblockStatus`, `scrape`…) | P1-21 ([#41](https://github.com/jezoock/mire/pull/41)) | À arbitrer (avec P1-29 ou une petite tâche dédiée) |
| Les types « Like » des vues web (`WindowLike`, `ViewLike`) ne sont pas compatibles avec ceux d'Electron : `index.ts` passe par deux conversions `as unknown as` | P1-21 ([#41](https://github.com/jezoock/mire/pull/41)) | À arbitrer (assouplir les types « Like ») |
| ESLint ne vérifie que les fichiers `.js` : le processus principal, désormais tout en TypeScript, n'est plus linté | P1-21 ([#41](https://github.com/jezoock/mire/pull/41)) | ✅ Décidée au point G2 (D-12) : options de vérification du compilateur dans `tsconfig.base.json`, sans typescript-eslint |
| Menu macOS : uniquement des rôles Electron (`appMenu`, `editMenu`, `windowMenu`), dont Electron fixe les libellés en anglais ; les traduire changerait ce que voit un utilisateur en français | P1-29 ([#42](https://github.com/jezoock/mire/pull/42)) | ✅ Intégrée à P2-23 au point G2 |
| Les fiches déjà récupérées (genres, résumés TMDB et Steam) et les erreurs gardées dans la liste des téléchargements restent dans la langue du moment où elles ont été produites | P1-29 ([#42](https://github.com/jezoock/mire/pull/42)) | À arbitrer (proposer de récupérer de nouveau les fiches après un changement de langue) |
| Les annonces (« jeu ajouté », service de télévision détecté, progression de la boutique) sont rédigées par l'interface à partir des données du processus principal | P1-29 ([#42](https://github.com/jezoock/mire/pull/42)) | ✅ Intégrée aux points particuliers de P2-08 à P2-18 au point G2 |
| `search.language` n'a pas de réglage dans l'interface (vide = langue de l'interface) | P1-29 ([#42](https://github.com/jezoock/mire/pull/42)) | ✅ Intégrée au point G2 : réglage dans le schéma (P2-19), choix dans Réglages (P2-23) |
| `onInjectCosmeticFilters` et le compteur de cadres masqués restent propres au bloqueur ; l'interface `WebExtension` n'a pas de point d'entrée pour le CSS injecté | P1-13 ([#33](https://github.com/jezoock/mire/pull/33)) | Dans P3-24 (bloqueur en addon), si un autre addon en a besoin |
| Le handler `tvDetect` refait lui-même l'enregistrement du service trouvé et la recherche de son nom, en double de `detectOnce` du service de télévision ; le contexte IPC expose deux fonctions (`detectTvService`, `fetchChannels`) au lieu du service | P1-15 ([#34](https://github.com/jezoock/mire/pull/34)) | À arbitrer (le contexte expose `tv`, le service gagne une commande « détecter et choisir ») |
| Le choix de la variante d'une chaîne selon la qualité préférée du service (`hd` par défaut) est fait par l'interface (`app.js`) | P1-15 ([#34](https://github.com/jezoock/mire/pull/34)) | ✅ Intégrée à P2-15 au point G2 |
| Navigation spatiale : un élément est écarté s'il est masqué ou si sa propriété `disabled` est vraie ; un composant personnalisé désactivé par l'attribut `disabled` ou par `aria-disabled` (sans propriété `disabled`) resterait une destination | P1-24 ([#43](https://github.com/jezoock/mire/pull/43)) | ✅ Intégrée à P2-03 au point G2 |
| Seule la première manette connectée est lue (`getGamepads()[0]`) : une seconde manette branchée est ignorée | P1-24 ([#43](https://github.com/jezoock/mire/pull/43)) | À arbitrer |
| Les modules `nav/` et `players/` reçoivent les actions de l'interface (retour, modifier, lecteur externe, vue web…) par des objets de rappels fournis par `app.js` | P1-24 ([#43](https://github.com/jezoock/mire/pull/43)) | ✅ Intégrée à P2-04 au point G2 |
| Textes des lecteurs et de la manette écrits en dur (affichage sur la vidéo, rappel des boutons, messages) ; déplacés tels quels | P1-24 ([#43](https://github.com/jezoock/mire/pull/43)) | ✅ Intégrée à P2-13 au point G2 |
| Détection SFR par `http://192.168.1.1/` : n'importe quelle box ou routeur à cette adresse répond, et SFR TV peut être choisi à tort au premier lancement (Freebox et Livebox ont un nom d'hôte propre et sont essayées avant) | P1-15 ([#34](https://github.com/jezoock/mire/pull/34)) | À arbitrer (adresse propre à la box SFR, ou contrôle du contenu de la réponse) |
| Après une récupération groupée annulée, l'annulation reste active : « Rechercher en ligne » d'un album (sans fiche choisie) ou d'un jeu de console sans liste de jaquettes s'arrête aussitôt, jusqu'à la récupération groupée suivante | P1-16 ([#35](https://github.com/jezoock/mire/pull/35)) | Remettre l'annulation à zéro à la fin de `run` (ou annulation propre à chaque récupération) |
| Si la lecture des jeux d'une console échoue pendant la préparation de `run`, la récupération reste marquée « en cours » et toute nouvelle récupération groupée est refusée jusqu'au redémarrage | P1-16 ([#35](https://github.com/jezoock/mire/pull/35)) | Remettre `running` à faux en cas d'erreur (`try`/`finally`) |
| « Effacer les infos » (`clear`) vide la base et les images, mais pas les caches en mémoire des fournisseurs : une série déjà vue dans la session reprend le chemin d'une affiche effacée ; la liste des genres TMDB vide (TMDB injoignable au premier essai) est gardée jusqu'au redémarrage | P1-16 ([#35](https://github.com/jezoock/mire/pull/35)) | `clear` vide aussi les caches des fournisseurs (méthode `reset` facultative de `MetadataProvider`) ; ne pas garder une liste de genres vide |
| Deux clients TMDB sont créés avec la même clé : celui du moteur de récupération (`scrape/index.ts`) et celui de la recherche « où regarder » (`index.js`) | P1-17 ([#37](https://github.com/jezoock/mire/pull/37)) | Un seul client TMDB, prêté aux deux services quand le câblage de `index.js` sera regroupé |
| L'en-tête de `packages/shared/src/ipc.ts` cite les canaux synchrones `mire:scriptlets` et `mire:signin-ua`, remplacés par `mire:before-page` (`src/main/web/session.ts`) ; le type de l'événement `onWebAdblocked` (`{ host }`) ne dit pas que `id` est aussi envoyé | P1-27 ([#44](https://github.com/jezoock/mire/pull/44)) | Corriger le commentaire et le type (petite tâche, ou avec la prochaine modification du contrat) |
| `.prettierignore` liste encore des fichiers qui n'existent plus (`src/main/store.js`, `src/main/downloads.js`, `src/main/discfiles.js`) | P1-27 ([#44](https://github.com/jezoock/mire/pull/44)) | Retirer ces lignes (petite tâche) |
