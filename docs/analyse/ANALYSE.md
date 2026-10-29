# Analyse du code de Mire

État analysé : commit `1330fc2` (dépôt `jezoock/mire`, branche `main`), 29 octobre 2026.

## 1. En bref

Mire est une application Electron riche et soignée (ergonomie salon, manette, accessibilité, messages clairs,
sécurité de la fenêtre bien pensée). Le code est lisible ligne à ligne, mais il est concentré dans trois
fichiers monolithiques qui mélangent données, constantes, logique métier, accès système et affichage :

| Fichier | Lignes | Ce qu'il contient |
| --- | ---: | --- |
| `main.js` | 2 313 | 17 domaines : identité navigateur, formats, configuration et migrations, protocole `media://`, bibliothèque, sous-titres, TV, lancement de programmes, vues web, recherche streaming, jeux, ROMs, métadonnées manuelles, dialogues, fenêtre, 85 canaux IPC, démarrage |
| `renderer/app.js` | 4 461 | toute l'interface : 224 fonctions, un état global `S` de 62 champs, 13 vues rendues en chaînes HTML, un `switch` de 120 actions, 3 lecteurs, navigation spatiale, manette |
| `renderer/styles.css` | 1 445 | jetons, 5 thèmes, tous les composants |
| `scraper.js` | 753 | 4 fournisseurs de métadonnées (TMDB, MusicBrainz, libretro, Steam) + orchestration |
| `store.js` | 494 | catalogue d'émulateurs (données) + installateurs + BIOS + extraction 7-Zip |
| `downloads.js` | 491 | téléchargements HTTP (session Chromium) + torrents (WebTorrent) + post-traitement |
| `adblock.js` | 275 | bloqueur Ghostery, scriptlets, liste d'exceptions |
| `preload.js`, `web-preload.js` | 151 | pont IPC (liste manuelle de ~100 fonctions), scripts d'avant-page des sites |
| `romsites.js`, `discfiles.js` | 194 | sites de ROMs légaux (données), lecture des index de jeux sur disque |

Aucun test, aucun lint, aucun typage, aucune CI. Un seul commit d'historique.

**Verdict** : la base fonctionnelle est solide et les modules secondaires (`scraper`, `store`, `downloads`,
`adblock`) sont déjà des fabriques à dépendances injectées (`createScraper({ getConfig, onProgress… })`), ce qui
est un excellent point de départ pour une architecture à addons. Le travail principal est de **découper
`main.js` et `app.js` par domaine**, de **séparer les données (catalogues) du code**, et de **poser des
interfaces** (fournisseurs de sources, de métadonnées, de recherche, de télé, téléchargeurs, extensions de vue
web) que les addons implémenteront ensuite.

## 2. Architecture actuelle

```
┌──────────────────────────── processus principal (main.js) ────────────────────────────┐
│ config.json ◄─ loadConfig/normalize/migrate ─ variable globale `config` (réassignée ~25×) │
│ createScraper  createStore  createDownloads  createAdblock   (fabriques, getConfig())   │
│ protocole media://  ── isAllowed() ── racines autorisées (recalculées à chaque requête)  │
│ WebContentsView ×N (partition persist:web) ── adblock, UA, téléchargements, magnet      │
│ ipcMain.handle ×85  ── logique métier parfois écrite directement dans les handlers      │
└──────────────┬─────────────────────────────────────────────────────────┬──────────────┘
               │ preload.js (window.api, liste manuelle)                  │ web-preload.js
┌──────────────▼───────────── renderer/app.js ──────────────┐   ┌─────────▼─────────────┐
│ état global S (62 champs) + Q (file audio) + V + I       │   │ pages des sites       │
│ render() → viewEl.innerHTML = views[section]()           │   │ (scriptlets, UA)      │
│ délégation : onActionClick → switch de 120 cas            │   └───────────────────────┘
│ localStorage : recent, resume:<chemin>, volume, queries  │
└──────────────────────────────────────────────────────────┘
```

Données persistées (sept emplacements distincts, chacun avec son propre code de lecture/écriture) :

| Emplacement (dans les données de l'app) | Écrit par | Remarque |
| --- | --- | --- |
| `config.json` | `main.js` | `writeFileSync` direct, non atomique |
| `meta/meta.json`, `meta/img/` | `main.js` | modifications manuelles des fiches |
| `scrape/db.json`, `scrape/img/`, `scrape/cache/` | `scraper.js` | écriture asynchrone non atomique, différée de 400 ms |
| `telechargements.json`, `torrents/` | `downloads.js` | |
| `emulators/installed.json`, `emulators/<id>/` | `store.js` | |
| `adblock/moteur.bin`, `adblock/listes.json` | `adblock.js` | |
| `cache/roms/`, `bin/7za` | `main.js`, `store.js` | |
| `localStorage` du renderer | `app.js` | « Reprendre », positions de reprise, volume, recherches : absents de l'export de configuration |

### Carte de `main.js`

| Lignes | Domaine |
| --- | --- |
| 1-60 | identité navigateur (UA « Chrome », exception connexion Google) |
| 62-93 | formats (extensions, MIME, motifs d'affiches) |
| 95-377 | configuration : valeurs par défaut (dont les catalogues `DEFAULT_TV`, `DEFAULT_WEB`), fusion, normalisation, migrations v1→v5, chargement |
| 379-499 | fichiers autorisés, protocole `media://` (plages HTTP) |
| 501-726 | bibliothèque : parcours local, index HTTP, M3U, analyse des sources, marque-pages |
| 728-776 | sous-titres (srt → vtt, Windows-1252) |
| 778-890 | télévision : M3U, qualité, regroupement des chaînes, détection de la box |
| 892-1025 | lancement de programmes, détection mpv/VLC et Edge/Chrome |
| 1027-1448 | Widevine, vues web intégrées, navigateur « Ajouter des jeux », session web |
| 1450-1518 | recherche dans les catalogues de streaming (TMDB + JustWatch) |
| 1520-1744 | jeux PC, ROMs, lancement, cache des jeux en ligne |
| 1746-1823 | métadonnées manuelles, dialogues |
| 1825-1878 | fenêtre principale |
| 1880-2215 | **335 lignes d'IPC**, dont de la logique métier inline (suppression et nettoyage des jeux, marque-pages, import/export de config, téléchargement de jeux sur disque) |
| 2217-2313 | démarrage, câblage des modules |

### Carte de `renderer/app.js`

| Lignes | Domaine |
| --- | --- |
| 1-97 | outils, 30 icônes SVG en chaînes |
| 99-273 | état, thèmes, menu principal (barre latérale / carrousel / rétractable) |
| 306-616 | navigation, outils d'en-tête, `render()`, briques d'affichage (`withScrape`, tuiles, grilles) |
| 618-1506 | 13 vues (accueil, vidéos, séries, musique, images, streaming, TV, jeux, ROMs, téléchargements, réglages…) |
| 1508-1910 | actions (analyse, ouverture, marque-pages, lancement, sources, enregistrement des réglages) |
| 1912-2088 | intégration de la vue web (synchronisation de la position de la `WebContentsView`) |
| 2090-2304 | recherche globale, état du bloqueur, état DRM |
| 2306-2603 | récupération d'infos, panneaux « réglages de la page » |
| 2603-3071 | boîtes de dialogue génériques, choix de fiche, éditeurs (média, console), fond d'écran |
| 3073-3184 | boutique |
| 3186-3668 | **délégation des clics : un `switch` de ~480 lignes** |
| 3670-4138 | lecteurs audio, vidéo, visionneuse d'images |
| 4140-4374 | navigation spatiale, clavier, manette |
| 4376-4461 | glisser-déposer, horloge, démarrage |

## 3. Points forts à conserver

- **Sécurité de la fenêtre** : `contextIsolation`, `sandbox`, `nodeIntegration: false` partout, CSP stricte
  (`script-src 'self'`), navigation et fenêtres surgissantes bloquées, sites dans une partition séparée sans
  accès disque, gestionnaire de permissions en liste blanche, protocole `media://` limité aux dossiers déclarés,
  chemins des index de disques contrôlés (`safeRel`), programmes d'installation lancés seulement s'ils ont été détectés.
- **Fabriques à dépendances injectées** pour les modules secondaires : base naturelle des futurs points d'extension.
- **Données déjà « déclaratives »** : catalogues de services, d'émulateurs, de sites, de jeux libres. Il suffit de
  les sortir du code pour en faire des packs d'addons.
- **Thèmes par jetons CSS** (`--bg`, `--surface`, `--bar-*`, `--ring`…) et attribut `data-theme` : le
  « skinnage » a déjà une bonne fondation.
- **Ergonomie salon** : navigation spatiale, contextes manette, rappel des boutons, reprise de lecture, messages
  d'erreur compréhensibles.
- **Philosophie « rien n'est installé d'office »** + import/export de configuration : colle parfaitement à un
  modèle où l'utilisateur choisit ses addons.

## 4. Problèmes structurels

### 4.1 Monolithes et mélange des genres

Un même fichier contient des catalogues de données (`DEFAULT_WEB` : 15 services, `DEFAULT_TV`, `EMULATORS`,
`FREE_GAMES`, `BIOS_HINTS`, `PDROMS`…), des constantes de formats, de la logique pure (parsing, scoring), des
accès système (fs, spawn, fetch) et du câblage. Conséquences : impossible de tester une fonction pure de
`main.js` sans charger Electron, revue difficile, conflits garantis si plusieurs personnes (ou sessions) y travaillent.

### 4.2 État global mutable

- Côté main : `config` est une variable globale réassignée dans une vingtaine d'endroits (`config = saveConfig(...)`),
  parfois sans réassignation (le résultat repose sur l'effet de bord de `saveConfig`). Les modules lisent la
  config par `getConfig()`, sans notification de changement.
- Côté renderer : `S` a 62 champs, dont plusieurs non déclarés à l'initialisation (`focusRef`, `romsWarnings`,
  `scrapeQuiet`) ; `P.lastSection` idem. Tout changement passe par `render()` qui reconstruit la vue entière.

### 4.3 Consoles référencées par leur position dans la liste

Une console est désignée par son index dans `config.emulators` : `emuIndex`, `console: i`, `rom:<i>` pour les
vues web, `S.localRoms[i]`, `S.romsCache[i]`, marque-pages de jeux, fiches de téléchargement (≈ 47 occurrences).
Supprimer une console décale toutes les suivantes : un marque-page ou un téléchargement en attente pointe alors
vers la mauvaise console. C'est aussi un frein aux addons (un addon doit référencer une console par identifiant).

### 4.4 Duplications

| Logique | Copies |
| --- | --- |
| Pliage des accents (`fold` / `foldText`) | `main.js`, `scraper.js`, `app.js` |
| Client TMDB (jeton long ou clé courte) | `main.js` (`tmdbFetch`), `scraper.js` (`tmdb`) |
| Requêtes HTTP avec délai et message d'erreur | `store.js` (`get`, `fetchText`, `download`), `adblock.js`, `downloads.js`, `scraper.js` (`getJson`, `getText`), `main.js` (`crawlHttp`…) |
| Détection d'épisode `S01E03` / `1x03` | `main.js`, `scraper.js` ×2, `app.js` |
| Nettoyage d'un nom de ROM (« (Europe) [!] ») | `main.js`, `scraper.js` ×3, `app.js` |
| Dossiers génériques (« Saison 1 », « CD1 ») | `scraper.js`, `app.js` |
| Noms de fichiers sûrs, identifiants aléatoires, hôte/site d'une URL | `main.js`, `downloads.js`, `adblock.js` |
| Référentiel des systèmes (noms libretro, extensions, alias) | `scraper.js`, `store.js`, `romsites.js`, `app.js` |
| Parcours récursif de dossiers | 5 variantes (`walkLibrary`, `listRoms`, `bestExecutable`, `findFile`, `findInstallers`) |
| Liste des thèmes, barres de l'accueil, couleur de fond par thème | `main.js` et `app.js` (et la couleur aussi dans `styles.css`) |
| Téléchargement d'un fichier | `store.download` (lancement d'un jeu en ligne) et gestionnaire de téléchargements (copie locale) |
| Réglages affichés deux fois | Réglages globaux et panneaux de page : clé TMDB, pays, bloqueur (×2), accueil (×2), lecteur externe (×3) |
| Suppression d'un jeu | `deleteGameRef()` et `case 'game-delete'` |

### 4.5 Contrat IPC maintenu à la main en trois endroits

85 canaux `ipcMain.handle` (plus 2 canaux synchrones pour les pages des sites) et 17 événements envoyés à
l'interface, recopiés dans `preload.js` (liste manuelle) puis utilisés
dans `app.js` (101 fonctions `api.*`). Aucun typage : un renommage casse silencieusement.

### 4.6 Rendu par chaînes HTML

30 affectations `innerHTML`, échappement manuel par `esc()` à chaque interpolation : un seul oubli suffit pour une
injection (et la fenêtre principale peut lancer des programmes). Chaque changement redessine toute la vue, d'où
des mécanismes de restauration du focus (`focusSelectorOf`) et des recalculs coûteux (`S.videos.map(withScrape)`
évalué 3 à 4 fois par rendu, sur des listes pouvant atteindre 150 000 éléments).

### 4.7 Absence de filet de sécurité

Pas de tests, pas de lint, pas de types, pas de CI. Le seul export « de test » (`scraper._test`) n'est utilisé
nulle part. Toute refacto sans tests de caractérisation préalables est risquée.

## 5. Anomalies relevées

| # | Constat | Où | Gravité | Tâche |
| --- | --- | --- | --- | --- |
| A1 | Les portails TV web (SFR TV, B.tv, Molotov) ne s'ouvrent pas : le renderer ouvre l'identifiant `tv:web`, que `webOpen` ne connaît pas (« Ce site n'existe plus dans la configuration ») ; `viewWeb` ne sait pas non plus l'afficher | `renderer/app.js:1696-1705`, `main.js:1227-1242`, `renderer/app.js:1929-1938` | Haute : 3 des 5 services TV livrés d'office sont inutilisables | P0-05 |
| A2 | `games:delete` supprime `ref.path` (récursivement si c'est un dossier) sans vérifier qu'il appartient aux dossiers d'une console | `main.js:1920-1940` | Sécurité (défense en profondeur) | P0-06 |
| A3 | Consoles référencées par index (voir 4.3) : supprimer une console décale marque-pages et téléchargements | `main.js`, `downloads.js`, `app.js` | Moyenne | P1-07 |
| A4 | Marque-page d'un jeu : les fiches trouvées en ligne sont ignorées, mais l'interface annonce « infos récupérées » | `main.js:2113-2124` | Faible | P0-07, P1-20 |
| A5 | Écritures non atomiques de `config.json` et `scrape/db.json` : une coupure pendant l'écriture laisse un fichier tronqué ; la config est alors mise de côté et réinitialisée | `main.js:307-312`, `scraper.js:188-192` | Moyenne | P1-05, P1-06 |
| A6 | `isAllowed()` recalcule toutes les racines autorisées à chaque requête `media://` (une par vignette) | `main.js:420-447` | Performance | P1-10 |
| A7 | Le nettoyage des jeux liste les ROMs de chaque console sans utiliser le résultat | `main.js:1950-1953` | Performance | P0-07 |
| A8 | Un jeu en ligne lancé directement est téléchargé hors du gestionnaire (pas d'annulation ni de suivi dans Téléchargements) | `main.js:1697-1744` | Incohérence | P1-20 |
| A9 | `case 'games-cleanup'` en double (le second est inaccessible) ; phases `start/progress/extract/cancelled/error` de `rom-download` jamais émises | `renderer/app.js:3229,3282,2360-2372` | Code mort | P0-07 |
| A10 | Electron castLabs `v44.5.1+wvcus` : faille GHSA-jr5w-w6x2-84p9, passage prévu à `v44.9.3+wvcus` à partir du 5 novembre 2026 (voir README) | `package.json` | Sécurité | P0-08 |

Code mort supplémentaire (sans effet, à retirer en P0-07) : `genreBar`, `gameGenrePool`, `KNOWN_WEB`,
`case 'scrape-fix'`, étiquette `case 'pc-sites'`, `foldersChanged`, `void online`, `void cosmetic`, alias
`gameEntries`, bloc vide de `migrateConfig` (`raw.ui.home.services`), `downloads.activeCount` (jamais appelé).

## 6. Cartographie domaines → modules → addons

Légende « Addon » : **D** = addon de données (aucun code exécuté), **C** = addon de code (processus principal),
**U** = contribution d'interface, **—** = reste dans le cœur.

| Domaine | Code actuel | Module cible (cœur) | Addon possible |
| --- | --- | --- | --- |
| Fenêtre, protocole `media://`, sécurité des chemins | `main.js` | `main/window`, `main/media-protocol`, `main/security` | — |
| Configuration, migrations, stockage | `main.js`, divers | `main/config`, `main/storage` | — |
| Pont IPC | `main.js`, `preload.js` | `main/ipc` + contrat partagé | — |
| Vues web intégrées, session, Widevine | `main.js` | `main/web` | — (Widevine est lié au binaire castLabs) |
| Identité navigateur / connexion Google | `main.js`, `web-preload.js` | `main/web/user-agent` | **C** compatibilité Google |
| Bloqueur de publicités | `adblock.js`, `web-preload.js` | interface « extension de vue web » | **C** Ghostery |
| Sources locales (dossiers, partages SMB) | `main.js` | `main/library` (fournisseur intégré) | — |
| Sources serveur web (index), listes M3U | `main.js` | interface `SourceProvider` | **C** |
| Sous-titres | `main.js` | `main/library/subtitles` | (plus tard : fournisseur de sous-titres) |
| Métadonnées TMDB / MusicBrainz / libretro / Steam | `scraper.js` | moteur `main/scrape` + interface `MetadataProvider` | **C** ×4 |
| Recherche « où regarder » (TMDB + JustWatch) | `main.js` | interface `SearchProvider` | **C** |
| Services de streaming (Netflix…) | `DEFAULT_WEB` dans `main.js` | — | **D** pack de services |
| Services TV (Freebox, Orange, SFR, B.tv, Molotov) | `DEFAULT_TV` dans `main.js` | interface `TvProvider` | **D** pack France + **C** moteur playlist M3U |
| Jeux PC (scan de dossiers, raccourcis) | `main.js` | interface « source de jeux » | **C** |
| ROMs, lancement, jeux sur disque | `main.js`, `discfiles.js` | `main/games` | — |
| Référentiel des systèmes | 4 fichiers | `shared/systems` | **D** |
| Sites de ROMs légaux | `romsites.js` | — | **D** |
| Boutique d'émulateurs, BIOS | `store.js` | installateurs génériques `main/store` | **D** catalogue (un émulateur = une entrée) |
| Jeux libres (homebrew) | `store.js` | — | **D** |
| Téléchargements HTTP | `downloads.js` | `main/downloads` + interface `Downloader` | — |
| Torrents (WebTorrent + `vendor/` + `overrides`) | `downloads.js`, `package.json` | — | **C** (allège fortement le cœur) |
| Extraction d'archives (7-Zip) | `store.js` | service `main/archive` | — |
| Lecteurs externes mpv / VLC, navigateur de secours | `main.js` | interface `ExternalPlayer` | **C** ou **D** (préréglages d'arguments) |
| Thèmes | `styles.css`, `main.js`, `app.js` | moteur de thèmes (jetons) | **D** un addon par thème |
| Profils de manettes (glyphes, détection) | `app.js` | service d'entrée | **D** |
| Widgets d'accueil, panneaux de réglages | `app.js` | points d'extension UI | **U** |

## 7. Architecture cible proposée

```
mire/                                paquet racine = l'application (electron-builder, overrides et vendor/ inchangés)
├─ src/main/
│  ├─ index.ts                       racine de composition : crée et relie les services
│  ├─ config/                        défauts, catalogues, migrations/v2..v6, normalisation, fusion, service observable
│  ├─ storage/                       JSON atomique + différé, arborescence des données
│  ├─ ipc/                           enregistrement générique à partir du contrat
│  ├─ security/                      racines autorisées (cache), contrôle des chemins
│  ├─ media-protocol/                media:// (plages)
│  ├─ platform/                      lancement de programmes, détection mpv/VLC/navigateurs
│  ├─ net/                           client HTTP unique (délais, messages, progression, débit limité), client TMDB
│  ├─ web/                           gestionnaire des vues web, session, identité, extensions (bloqueur…)
│  ├─ library/                       emplacements, fournisseurs de sources, sous-titres
│  ├─ tv/   games/   search/   scrape/   store/   downloads/   archive/   usage/
│  └─ addons/                        hôte d'addons (phase 3)
├─ src/preload/                      construit à partir du contrat IPC
├─ src/renderer/                     interface : modules (phase 1), puis coquille + composants Stencil (phase 2)
└─ packages/                         espaces de travail npm (décision D-02)
   ├─ shared/                        fonctions pures (texte, URL, formats, systèmes) + types + contrat IPC
   ├─ ui/                            composants StencilJS + jetons + thèmes (phase 2)
   └─ plugin-sdk/                    types des points d'extension, schéma du manifeste (phase 3)

mire-addons/                         nouveau dépôt (phase 3)
├─ addons/<id>/mire-addon.json       manifeste
├─ registry/index.json               index publié (versions, compatibilité, sha256, signature)
└─ .github/workflows/                validation, construction, publication
```

## 8. StencilJS : pertinence et points d'attention

**Pourquoi c'est un bon choix ici**

- Des composants web standards : utilisables tels quels dans les gabarits existants pendant la migration
  (une balise `<mire-tile>` fonctionne aussi dans une chaîne HTML), et par les addons (registre global des éléments).
- JSX + TypeScript : échappement automatique (fin du risque d'injection par `innerHTML`), propriétés typées.
- Mise à jour fine du DOM : plus de redessin complet ni de restauration manuelle du focus.
- Skinnage : les propriétés CSS personnalisées traversent le Shadow DOM ; `::part()` donne aux thèmes des points
  d'accroche explicites. Le système de jetons actuel se transpose presque tel quel.

**Points d'attention à traiter dès le prototype (P2-01)**

1. **Navigation spatiale** : `querySelectorAll('.focusable')` ne traverse pas les Shadow DOM. Il faut un
   service de focus (registre des éléments navigables, ou parcours des racines) — c'est le point le plus risqué.
2. **Chargement dans Electron** : la sortie « lazy » de Stencil charge des morceaux par `import()` ; à valider en
   `file://` avec la CSP actuelle, sinon sortie `dist-custom-elements` + bundler.
3. **Vue web native** : la `WebContentsView` est posée par-dessus la fenêtre ; le composant d'emplacement doit
   continuer à transmettre sa position (ResizeObserver) au processus principal.
4. **Contrat de skin** : avec Shadow DOM, un thème ne peut modifier que ce que les jetons et les `part` exposent.
   C'est voulu (contrat stable pour les thèmes-addons) mais demande de concevoir ce contrat (décision D-05).
5. **Outillage** : le renderer, aujourd'hui sans build, en aura un ; prévoir un mode « watch » confortable.

**Stratégie recommandée** : migration progressive (« étrangleur »). On découpe d'abord `app.js` en modules
(phase 1) sans changer l'affichage, puis on remplace les vues une par une par des composants Stencil, l'app
restant fonctionnelle et testable après chaque tâche.

## 9. Architecture des addons : principes proposés

- **Trois natures d'addons** : données (presets, thèmes, catalogues — aucun code exécuté, à privilégier),
  code du processus principal (fournisseurs), contributions d'interface (composants Stencil).
- **Manifeste** `mire-addon.json` : identifiant, version, compatibilité (`engines.mire` en semver), points
  d'extension contribués, réglages (stockés sous `addons.<id>` dans la config), permissions déclarées (hôtes
  réseau, accès disque, lancement de programmes).
- **Points d'extension** (contrats dans `plugin-sdk`) : `SourceProvider`, `MetadataProvider`, `SearchProvider`,
  `TvProvider`, `GameSourceProvider`, `Downloader`, `WebExtension`, `ExternalPlayer`, `EmulatorCatalog`,
  `Theme`, `InputProfile`, contributions UI (widgets d'accueil, onglets de réglages).
- **API asynchrone par messages dès le départ**, pour pouvoir isoler plus tard le code des addons dans un
  `utilityProcess` sans changer leur code (décision D-07).
- **Confiance** : index signé du dépôt officiel, empreinte sha256 de chaque paquet vérifiée à l'installation
  (décision D-08).
- **Rétrocompatibilité** : une installation existante active automatiquement les addons correspondant à sa
  configuration (une clé TMDB présente → addon TMDB actif, etc.).

## 10. Décisions à prendre

| # | Question | Recommandation |
| --- | --- | --- |
| D-01 | Langage | **TypeScript partout**, compilé par esbuild en CommonJS pour main et preload (le preload sandboxé ne charge pas d'ESM) ; Stencil impose TS côté UI ; contrat IPC et SDK d'addons typés |
| D-02 | Organisation du dépôt | **Paquet racine = l'application, code dans `src/`, plus des espaces de travail npm** pour `packages/shared`, `packages/ui`, `packages/plugin-sdk` (le dépôt d'addons consommera `shared` et `plugin-sdk`). Garder l'application à la racine évite les pièges d'electron-builder avec les espaces de travail et laisse `overrides`/`vendor/` en place |
| D-03 | Tests | **`node:test`** (aucune dépendance) pour la logique ; **Playwright `_electron`** pour un test de fumée et des captures de référence des écrans ; runner Stencil pour les composants |
| D-04 | Style et lint | ESLint (config « flat ») + Prettier calés sur le style actuel ; un seul commit de reformatage, isolé |
| D-05 | Stencil : encapsulation | **Shadow DOM + jetons + `::part`** (vrai contrat de skin pour les thèmes-addons), avec service de focus dédié |
| D-06 | « Reprendre », positions de reprise, volume, recherches | **Passer du `localStorage` au processus principal** (inclus dans l'export de configuration) |
| D-07 | Exécution du code des addons | **Dans le processus principal au début** pour les addons officiels signés, via une API par messages qui permettra l'isolation en `utilityProcess` ensuite |
| D-08 | Sources d'addons | **Dépôt officiel signé uniquement** dans un premier temps ; dépôts tiers éventuellement plus tard |
| D-09 | Dépôt d'addons | `jezoock/mire-addons`, à créer (action de ta part, ou autorisation de le créer) |
| D-10 | Mode de travail | **Une tâche = une branche = une PR vers `main`**, suivi dans `docs/plan/BACKLOG.md` ; issues GitHub en option |

## 11. Risques

| Risque | Parade |
| --- | --- |
| Régressions invisibles pendant la refacto (aucun test aujourd'hui) | Phase 0 : tests de caractérisation + test de fumée Electron + captures de référence avant de toucher au code |
| Conflits entre tâches menées en parallèle sur `main.js` | Découpage par domaine ; fusionner les PR une à une et rebaser les suivantes |
| Navigation manette cassée par le Shadow DOM | Service de focus prototypé dès P2-01, avant toute migration de vue |
| Fonctions impossibles à vérifier dans un conteneur (Widevine, box Freebox, vraie manette, Windows/macOS) | Marquées « validation manuelle » dans le backlog ; checklist fournie dans la PR |
| Surface d'attaque des addons (code exécuté avec les droits de l'app) | Addons de données d'abord, intégrité + signature, permissions déclarées, isolation possible (D-07) |
| Configurations existantes cassées | Migrations versionnées et testées (v5 → v6…), import d'anciennes configurations dans les tests |
