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
| P0-05 | Correctif : portails TV web (SFR, B.tv, Molotov) | S | P0-03 | 🧑 | en revue | [#9](https://github.com/jezoock/mire/pull/9) |
| P0-06 | Correctif : contrôle du chemin avant suppression d'un jeu | S | P0-03 | | à faire | |
| P0-07 | Nettoyage du code mort et petites incohérences | S | P0-01, P0-03 | | à faire | |
| P0-08 | Mise à jour de sécurité d'Electron castLabs (pas avant le 5 nov. 2026) | S | — | 🧑 | à faire | |
| P0-09 | Test de fumée Electron et captures de référence | M | P0-03, P0-04 | | en revue | [#10](https://github.com/jezoock/mire/pull/10) |
| P0-10 | Correctif : titre de film qui commence par une année | S | P0-02 | | faite | [#6](https://github.com/jezoock/mire/pull/6) |
| P0-11 | Correctif : adresses complètes dans un `.m3u` distant | S | P0-02 | | à faire | |
| **G1** | **Point d'étape : fin de la phase 0** | | P0-01…P0-11 | | | |

## Phase 1 — Refacto modulaire

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | Squelette : arborescence, TypeScript, build | L | G1, D-01, D-02 | | à faire | |
| P1-02 | `@mire/shared` : texte, URL, identifiants | M | P1-01 | | à faire | |
| P1-03 | `@mire/shared` : formats et référentiel des systèmes | M | P1-02 | | à faire | |
| P1-04 | Client HTTP unique | M | P1-01 | | à faire | |
| P1-05 | Stockage JSON atomique | M | P1-01 | | à faire | |
| P1-06 | Service de configuration | L | P1-02, P1-05 | | à faire | |
| P1-07 | Identifiants stables des consoles (migration v6) | L | P1-06, P1-08 | | à faire | |
| P1-08 | Contrat IPC typé | M | P1-01 | | à faire | |
| P1-09 | Données d'usage côté processus principal | S | P1-05, P1-08, D-06 | | à faire | |
| P1-10 | Sécurité des chemins et protocole `media://` | M | P1-06 | | à faire | |
| P1-11 | Plateforme : lancement de programmes, lecteurs, navigateurs | S | P1-01 | 🧑 | à faire | |
| P1-12 | Vues web intégrées | L | P1-02, P1-08 | 🧑 | à faire | |
| P1-13 | Bloqueur de publicités en extension de vue web | M | P1-12 | 🧑 | à faire | |
| P1-14 | Bibliothèque : sources, parcours, sous-titres | M | P1-03, P1-04, P1-10 | | à faire | |
| P1-15 | Télévision | S | P1-04, P1-12, P1-14 | 🧑 | à faire | |
| P1-16 | Moteur de métadonnées et fournisseurs | L | P1-03, P1-04, P1-05 | 🧑 | à faire | |
| P1-17 | Recherche « où regarder » | S | P1-16 | | à faire | |
| P1-18 | Archives et boutique | M | P1-03, P1-04, P1-07 | 🧑 | à faire | |
| P1-19 | Téléchargements | L | P1-05, P1-07, P1-18 | 🧑 | à faire | |
| P1-20 | Jeux | L | P1-07, P1-10, P1-11, P1-14, P1-19 | 🧑 | à faire | |
| P1-21 | Racine de composition | M | P1-06…P1-20 | | à faire | |
| P1-22 | Renderer : modules, outils, état, client API | M | P1-01, P1-08 | | à faire | |
| P1-23 | Renderer : logique de domaine testée | M | P1-22, P1-03 | | à faire | |
| P1-24 | Renderer : navigation, clavier, manette, lecteurs | M | P1-22 | 🧑 | à faire | |
| P1-25 | Renderer : vues et actions par domaine | L | P1-23, P1-24, D-05 | | bloquée (D-05) | |
| P1-26 | Réglages déclaratifs | M | P1-25, P1-06, D-05 | | bloquée (D-05) | |
| P1-27 | Documentation d'architecture | S | P1-21 (P1-26 si lancée) | | à faire | |
| P1-28 | Localisation : socle (catalogues, langue de l'interface) | M | P1-01, P1-06, D-11 | | à faire | |
| P1-29 | Localisation du processus principal (français et anglais) | L | P1-28, P1-21 | | à faire | |
| **G2** | **Point d'étape : fin de la phase 1** | | P1-01…P1-29 | | | |

Pistes parallèles après P1-01 : processus principal (P1-02 → P1-21) et renderer (P1-22 → P1-25).

## Phase 2 — Frontend StencilJS

**Fiches provisoires** : la décision D-05 est reportée au point G2 (approche fondée sur ton toolkit et ton
set de composants). Cette phase sera réécrite avant d'être lancée ; les lignes ci-dessous sont indicatives.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 | Prototype et ADR : Stencil dans Electron | M | G2 | | à faire | |
| P2-02 | Jetons de design et thèmes en fichiers | M | P2-01 | | à faire | |
| P2-03 | Service de focus, clavier et manette compatibles Shadow DOM | L | P2-01, P1-24 | 🧑 | à faire | |
| **G2b** | **Point d'étape : ADR Stencil et service de focus** | | P2-01…P2-03 | | | |
| P2-04 | Primitives d'action et de formulaire | M | P2-02, P2-03 | | à faire | |
| P2-05 | Composants médias | M | P2-04 | | à faire | |
| P2-06 | Boîtes de dialogue et panneau de réglages | M | P2-04 | | à faire | |
| P2-07 | Coquille de l'application | L | P2-05, P2-06 | | à faire | |
| P2-08 | Section Accueil | S | P2-07 | | à faire | |
| P2-09 | Section Recherche globale | M | P2-07 | | à faire | |
| P2-10 | Section Vidéos | M | P2-07, P2-13 | | à faire | |
| P2-11 | Section Musique + mini-lecteur | M | P2-07 | | à faire | |
| P2-12 | Section Images + visionneuse | S | P2-07 | | à faire | |
| P2-13 | Lecteur vidéo | M | P2-07 | 🧑 | à faire | |
| P2-14 | Streaming et vue web | M | P2-07 | 🧑 | à faire | |
| P2-15 | Section Télévision | S | P2-07 | | à faire | |
| P2-16 | Section Jeux | L | P2-07 | | à faire | |
| P2-17 | Boutique | M | P2-07 | | à faire | |
| P2-18 | Section Téléchargements | S | P2-07 | | à faire | |
| P2-19 | Réglages | M | P2-07, P1-26 | | à faire | |
| P2-20 | Éditeurs | M | P2-06, P2-10, P2-16 | | à faire | |
| P2-21 | Retrait de l'interface historique et audits | M | P2-08…P2-20 | 🧑 | à faire | |
| P2-22 | Guide « Créer un thème » | S | P2-02, P2-21 | | à faire | |
| P2-23 | Sélecteur de langue et finitions de la localisation | S | P2-19, P1-28, P1-29 | | à faire | |
| **G3** | **Point d'étape : fin de la phase 2, ADR addons, dépôt `mire-addons`** | | P2-01…P2-23 | | | |

## Phase 3 — Addons

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P3-01 | ADR : architecture des addons | M | G3 | | à faire | |
| P3-02 | `@mire/plugin-sdk` | M | P3-01 | | à faire | |
| P3-03 | Hôte d'addons | L | P3-02 | | à faire | |
| P3-04 | Contributions d'interface | M | P3-03, P2-21 | | à faire | |
| P3-05 | Dépôt `mire-addons` | M | P3-02, D-09 | | à faire | |
| P3-06 | Client de registre et page « Modules » | L | P3-03, P3-04, P3-05 | 🧑 | à faire | |
| P3-07 | Continuité pour les installations existantes | M | P3-06 | | à faire | |
| P3-08 | Dépôts tiers | M | P3-06 | 🧑 | à faire | |
| P3-10 | Addons de thèmes | S | P3-04, P3-06 | | à faire | |
| P3-11 | Pack « Services de streaming » | S | P3-06 | | à faire | |
| P3-12 | Pack « Télévision en France » | S | P3-06 | | à faire | |
| P3-13 | Pack « Sites de jeux légaux » | S | P3-06 | | à faire | |
| P3-14 | Pack « Jeux libres » | S | P3-06 | | à faire | |
| P3-15 | Profils de manettes | S | P3-04, P3-06 | | à faire | |
| P3-16 | Métadonnées TMDB | M | P3-06 | | à faire | |
| P3-17 | Métadonnées MusicBrainz + Cover Art Archive | M | P3-06 | | à faire | |
| P3-18 | Métadonnées libretro | M | P3-06 | | à faire | |
| P3-19 | Métadonnées Steam | S | P3-06 | | à faire | |
| P3-20 | « Où regarder » (TMDB + JustWatch) | S | P3-16 | | à faire | |
| P3-21 | Sources « serveur web » et « liste M3U » | M | P3-06 | | à faire | |
| P3-22 | Télévision par playlist M3U | S | P3-06, P3-12 | | à faire | |
| P3-23 | Torrents | L | P3-06 | 🧑 | à faire | |
| P3-24 | Bloqueur de publicités (Ghostery) | M | P3-06 | 🧑 | à faire | |
| P3-25 | Compatibilité connexion Google | S | P3-06 | 🧑 | à faire | |
| P3-26 | Catalogue d'émulateurs | L | P3-06 | 🧑 | à faire | |
| P3-27 | Scanner de jeux PC | M | P3-06 | | à faire | |
| P3-28 | Lecteurs externes mpv et VLC | S | P3-06 | | à faire | |
| P3-29 | Packs de langue | M | P1-28, P3-04, P3-06 | | à faire | |

## Pistes repérées en cours de route

Améliorations notées dans les PR, à arbitrer (une piste retenue devient une tâche ou rejoint une fiche).

| Piste | Origine | Proposition |
| --- | --- | --- |
| `parseVideo` lit une année future dans le titre (`Blade Runner 2049` seul → « Blade Runner », 2049) | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | Ignorer une année postérieure à l'année en cours + 1 ; à arbitrer (changement de comportement) |
| `RETROARCH_SYSTEMS` n'est pas exporté : le test des catalogues le retrouve via l'émulateur RetroArch | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | À traiter dans P1-18 (catalogue en données) |
| `GAME_FILE_RE` ne reconnaît pas `jeu.zip?dl=1` | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | Sans effet aujourd'hui : `main.js` teste le seul chemin de l'adresse. À garder en tête dans P1-12 |
| Node 22 décode mal Windows-1252 (octets 0x80 à 0x9F : €, ’, œ) ; le Node d'Electron 44 (24.21) est correct, l'application n'est pas touchée. Le test de `decodeText` concerné est sauté sous Node 22 | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Dans P0-04 : lancer la CI avec Node ≥ 24 (ou le Node d'Electron) pour que ce test s'exécute |
| `migrateConfig` 1 → 2 cherche les valeurs par défaut dans `DEFAULT_CONFIG.web`, vide depuis que rien n'est installé d'office : `search`, `background` et `providers` ne sont plus complétés (le passage 2 → 3 compense pour les sites connus) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Chercher dans `DEFAULT_WEB` (ou `KNOWN_WEB`) ; à arbitrer (changement de comportement), avec mise à jour des fixtures de migration |
| `migrateConfig` 2 → 3 ajoute encore les 15 sites de `DEFAULT_WEB` à une config v1 ou v2, contrairement au commentaire de la v5 (« on garde ceux que l'utilisateur a réellement ») | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Décider du comportement voulu ; les résultats figés dans `test/fixtures/config-v*.migrated.json` décrivent l'actuel |
| `migrateConfig` v5 contient un `if` vide (`ui.home.services`) ; `KNOWN_WEB` est inutilisé (désormais dans `lib/config.js`) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | À retirer dans P0-07 (code mort) |
| `resolveLocation` simulant macOS ou Linux depuis Windows : `path.join` produit des barres obliques inverses (les tests passent par `path.join` pour rester portables) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Utiliser `path.posix` pour les branches macOS et Linux, dans la phase 1 (rangement de `lib/location.js`) |
