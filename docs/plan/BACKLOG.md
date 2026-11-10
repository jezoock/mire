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
| P1-02 | `@mire/shared` : texte, URL, identifiants | M | P1-01 | | en revue | [#18](https://github.com/jezoock/mire/pull/18) |
| P1-03 | `@mire/shared` : formats et référentiel des systèmes | M | P1-02 | | à faire | |
| P1-04 | Client HTTP unique | M | P1-01 | | faite | [#17](https://github.com/jezoock/mire/pull/17) |
| P1-05 | Stockage JSON atomique | M | P1-01 | | en revue | [#19](https://github.com/jezoock/mire/pull/19) |
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
| P1-25 | Renderer : vues et actions par domaine | L | — | | abandonnée (D-05 : remplacée par la phase 2) | |
| P1-26 | Schéma des réglages | M | P1-06 | | à faire | |
| P1-27 | Documentation d'architecture | S | P1-21, P1-26 | | à faire | |
| P1-28 | Localisation : socle (catalogues, langue de l'interface) | M | P1-01, P1-06, D-11 | | à faire | |
| P1-29 | Localisation du processus principal (français et anglais) | L | P1-28, P1-21 | | à faire | |
| **G2** | **Point d'étape : fin de la phase 1** | | P1-01…P1-29 (sauf P1-25) | | | |

Pistes parallèles après P1-01 : processus principal (P1-02 → P1-21) et renderer (P1-22 → P1-24).

## Phase 2 — Frontend avec dot-stash

Approche décidée le 10/11/2026 (D-05, `docs/analyse/D-05-dot-stash.md`) ; fiches dans `phase-2.md`.

| ID | Tâche | Taille | Dépend de | 🧑 | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| P2-01 | Intégration de dot-stash et `@mire/ui` | M | G2, DS-01, DS-02 | | à faire | |
| P2-02 | Habillage Mire et thèmes en jeux de jetons | M | P2-01 | | à faire | |
| P2-03 | Navigation clavier et manette sur les composants | L | P2-01, P1-24 | 🧑 | à faire | |
| P2-04 | Contrôleurs et actions (`ds-trigger`) | M | P2-01, P1-22, P1-23 | | à faire | |
| **G2b** | **Point d'étape : intégration, thèmes, navigation, contrôleurs** | | P2-01…P2-04 | | | |
| P2-05 | Composants médias | M | P2-02, P2-03, P2-04, DS-04, DS-05 | | à faire | |
| P2-06 | Boîtes de dialogue et formulaires | M | P2-02, P2-03 | | à faire | |
| P2-07 | Coquille de l'application | L | P2-05, P2-06 | | à faire | |
| P2-08 | Section Accueil | S | P2-07 | | à faire | |
| P2-09 | Section Recherche globale | M | P2-07 | | à faire | |
| P2-10 | Section Vidéos | M | P2-07, P2-13 | | à faire | |
| P2-11 | Section Musique + mini-lecteur | M | P2-07 | | à faire | |
| P2-12 | Section Images + visionneuse | S | P2-07 | | à faire | |
| P2-13 | Lecteur vidéo | M | P2-07, DS-03 | 🧑 | à faire | |
| P2-14 | Streaming et vue web | M | P2-07 | 🧑 | à faire | |
| P2-15 | Section Télévision | S | P2-07 | | à faire | |
| P2-16 | Section Jeux | L | P2-07 | | à faire | |
| P2-17 | Boutique | M | P2-07 | | à faire | |
| P2-18 | Section Téléchargements | S | P2-07 | | à faire | |
| P2-19 | Réglages | M | P2-07, P1-26, DS-06 | | à faire | |
| P2-20 | Éditeurs | M | P2-06, P2-10, P2-16 | | à faire | |
| P2-21 | Retrait de l'interface historique et audits | M | P2-08…P2-20 | 🧑 | à faire | |
| P2-22 | Guide « Créer un thème » | S | P2-02, P2-21 | | à faire | |
| P2-23 | Sélecteur de langue et finitions de la localisation | S | P2-19, P1-28, P1-29 | | à faire | |
| **G3** | **Point d'étape : fin de la phase 2, ADR addons, dépôt `mire-addons`** | | P2-01…P2-23 | | | |

### Dans dot-stash (dépôt `jezoock/dot-stash`)

Pull requests sur le dépôt de dot-stash, chacune validée par toi, au contrat de dot-stash (habillage du thème
`default`, accessibilité, textes traduisibles, tests unitaires et navigateur, readme, CHANGELOG). Elles peuvent
avancer dès maintenant, en parallèle de la phase 1. La colonne « dot-stash » donne la tâche du backlog de dot-stash.

| ID | Tâche | Taille | Dépend de | dot-stash | Statut | PR |
| --- | --- | --- | --- | --- | --- | --- |
| DS-00 | Poser le tag `v0.1.0` sur le commit de fusion de la 0.1.0 (action de ta part) | XS | — | B-117 | à faire | |
| DS-01 | Release : archive construite attachée à la release GitHub, installation par adresse | S | DS-00 | B-119, B-120 | à faire | |
| DS-02 | Moteur SCSS dans le paquet (`scss/` dans `files` et `exports`) | XS | — | à créer | à faire | |
| DS-03 | `ds-range` : curseur habillé, remplissage jusqu'à la valeur | M | — | à créer | à faire | |
| DS-04 | `ds-thumb` : image à proportions fixes, chargement différé, carton de remplacement | M | — | à créer | à faire | |
| DS-05 | `ds-scroller` : rangée défilante qui garde l'élément focalisé visible | M | — | à créer | à faire | |
| DS-06 | `ds-sortable` : liste ordonnable au clavier | M | — | à créer | à faire | |
| DS-07 | Imports par composant (`dist-custom-elements`), si P2-01 en a besoin | S | — | B-122, B-123 | selon P2-01 | |

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
| `parseVideo` lit une année future dans le titre (`Blade Runner 2049` seul → « Blade Runner », 2049) | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | ✅ Retenue au point G1 : intégrée à P1-16 |
| `RETROARCH_SYSTEMS` n'est pas exporté : le test des catalogues le retrouve via l'émulateur RetroArch | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | Intégrée à P1-18 (catalogue en données) |
| `GAME_FILE_RE` ne reconnaît pas `jeu.zip?dl=1` | P0-02 ([#3](https://github.com/jezoock/mire/pull/3)) | Sans effet aujourd'hui : `main.js` teste le seul chemin de l'adresse. Notée dans P1-12 |
| Node 22 décode mal Windows-1252 (octets 0x80 à 0x9F : €, ’, œ) ; le Node d'Electron 44 (24.21) est correct, l'application n'est pas touchée. Le test de `decodeText` concerné est sauté sous Node 22 | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Close : la CI (P0-04) exécute ce test sous Node 22 et 24 ; le défaut venait du Node du conteneur de développement |
| `migrateConfig` 1 → 2 cherche les valeurs par défaut dans `DEFAULT_CONFIG.web`, vide depuis que rien n'est installé d'office : `search`, `background` et `providers` ne sont plus complétés (le passage 2 → 3 compense pour les sites connus) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Retenue au point G1 : intégrée à P1-06 |
| `migrateConfig` 2 → 3 ajoute encore les 15 sites de `DEFAULT_WEB` à une config v1 ou v2, contrairement au commentaire de la v5 (« on garde ceux que l'utilisateur a réellement ») | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Retenue au point G1 : ne plus ajouter de sites ; intégrée à P1-06 |
| `migrateConfig` v5 contient un `if` vide (`ui.home.services`) ; `KNOWN_WEB` est inutilisé (désormais dans `lib/config.js`) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | ✅ Traitée dans P0-07 ([#11](https://github.com/jezoock/mire/pull/11)) |
| `resolveLocation` simulant macOS ou Linux depuis Windows : `path.join` produit des barres obliques inverses (les tests passent par `path.join` pour rester portables) | P0-03 ([#4](https://github.com/jezoock/mire/pull/4)) | Intégrée à P1-14 |
| `adblock.start()` télécharge les listes de filtres au démarrage même quand le bloqueur est désactivé (`adblock.enabled: false`) ; le test de fumée dépose un moteur vide en cache pour l'éviter | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | ✅ Retenue au point G1 : intégrée à P1-13 |
| Le test de fumée ne tourne que sous Linux (Xvfb) | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | L'ajouter à des runners CI Windows et macOS quand la phase 1 sera avancée ; Widevine reste à vérifier à la main |
| Les captures de référence varient de quelques pixels d'une exécution à l'autre (lissage des bords, écart de 16/255 au plus) | P0-09 ([#10](https://github.com/jezoock/mire/pull/10)) | Comparaison automatique avec seuil de tolérance, dans P2-21 |
