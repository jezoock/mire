# P4-24a — Inventaire de l'interface historique et de ses remplaçants

Établi avant tout retrait (consigne de P4-24a), sur `main` au commit `9ae1e05`. Pour chaque écran, panneau, boîte,
raccourci et action encore servi par `app.js`, `mire-legacy-view` (`#view` pour les sections, `#legacy-layers` pour
`legacy-markup.ts`) ou le pont `data-action` (`controllers/bridge.ts`), son remplaçant dans la nouvelle interface.

Légende : ✅ remplaçant en place ; 🔧 remplaçant en place, il reste à rebrancher un appel (aucun écran nouveau) ;
⚠️ remplaçant partiel ; ❌ aucun remplaçant.

## 1. Sections historiques (« Ancienne vue » de la vue de page, `mire-page.openLegacy`)

| Section (`app.js`) | Ce qu'elle montre ou fait | Remplaçant | État |
| --- | --- | --- | --- |
| `videos` (`viewVideos`) | grille des vidéos, fiche en haut (`focus-info`), fond d'écran | pages Films et Séries (`mire-page-view`, P4-11), `mire-focus-info`, `mire-backdrop` | ✅ |
| `videos` (`viewSeries`) | une série, ses saisons, ses épisodes, retours | regroupements de la page Séries (Séries › Friends › Saison 1, chemin) | ✅ |
| `music` (`viewMusic`) | albums et morceaux, « Lire l'album », « Modifier » l'album | page Musique (regroupement par album), lecture d'un morceau dans son dossier (`openCatalogElement`), éditeur de regroupement (P4-22) | ⚠️ pas d'action « Lire l'album » depuis le début sur un regroupement |
| `images` (`viewImages`) | grille des images | page Images, `mire-image-viewer` (P4-15) | ✅ |
| `streaming` (`viewStreaming`) | services, marque « ouvert », renvoi aux réglages s'il n'y en a pas | page Streaming (éléments `site`), sites ouverts dans `mire-rail` (P4-16), Réglages › Sites (P4-20) | ✅ |
| `tv` (`viewTv`) | chaînes, chargement, erreur et « Réessayer », « Détecter ma box », portail web | page Télévision (chaînes du catalogue, portail `tv:`, P4-16), Réglages › Télévision (`detectTvBox`, `reloadTv`, `setTvService`) | ✅ |
| `games` (`viewGames`) | liste unifiée (jeux PC, jeux de console, marque-pages), fiche, « Ouvrir les apps du Centre » | page Jeux, `mire-games` (`gameOptions`, `bookmark`, P4-17), Centre › Apps (P4-18) | ✅ |
| `games` + console (`viewRoms`) | jeux d'une console, « Modifier la console », « Ajouter des jeux » (sites) | regroupement par console de la page Jeux, `mire-games.editConsole` et `openSites` (Centre › Consoles) | ✅ |
| `games` + console (`viewRoms`) | **jeux en ligne** : « Afficher les jeux en ligne », choix de la source, « Télécharger sur cet ordinateur », « Tout télécharger » | les jeux des sources en ligne sont au catalogue (`jeux-roms`) et se lancent, mais rien ne les télécharge sur l'ordinateur ni ne choisit la source | ❌ |
| `games` + console (`viewRoms`) | « Chercher « … » sur » un site de jeux de la console (recherche en cours) | `mire-games.openSites` ouvre les sites, sans la recherche | ⚠️ |
| `demo` (`#demo`, P4-01) | page cachée de démonstration (`viewDemo`, composants `mire-demo`) | reste ; il lui faut un hôte qui ne soit plus `mire-legacy-view` | 🔧 |

## 2. En-tête des sections historiques (`headerTools`, `headerToolsRight`)

| Outil | Remplaçant | État |
| --- | --- | --- |
| Champ de recherche de la section (filtre du texte, `S.query`), recherche de chaîne | écran Recherche (P4-13), résultats groupés par page, chaînes comprises | ⚠️ pas de filtre sur place dans une page |
| Filtre par genre, par source, tri des vidéos, filtre par système de jeux, source de recherche | conditions, ordre et regroupements d'une page (Réglages › Pages, P4-21) : remplaçant de conception, pas d'équivalent sur place | ⚠️ |
| Service de télévision (liste déroulante) | Réglages › Télévision (`setTvService`) | ✅ |
| « Télécharger des jeux » | `mire-games.openSites`, Centre | ✅ |

## 3. Panneau « Réglages de la page » (`#panel`, ouvert par le rouage de `mire-header` → `mire-app.openPageSettings`)

| Onglet | Remplaçant | État |
| --- | --- | --- |
| Accueil : démarrage, ordre, menu | Réglages (`ui.start`, `moveHomeItem`, `toggleHomeItem`, `setMenuPosition`) | ✅ |
| Recherche : effacer les recherches récentes | `mire-search-view` (`mire-search.clearQueries`) | ✅ |
| Sources (vidéos, musique, images), « Analyser à nouveau » | explorateur (P4-08) et Réglages (`addSourceFolder`, `addSourceAddress`, `rescan`) | ✅ |
| Infos et affiches / pochettes / jaquettes : récupérer, tout reprendre, **pour un seul type** | Réglages : `scrapeAll` et `clearScrape`, tous types ensemble | ⚠️ |
| Affichage : fond d'écran, lecteur externe | schéma des Réglages (`ui.backdrop`, `externalPlayer.path`) | ✅ |
| Bloqueur de pubs | Réglages (`adblock.enabled`, `updateFilterLists`, listes) | ✅ |
| Ajouter un site | Réglages › Sites (entrées de `web`) | ✅ |
| Télévision | Réglages (`tv`, `tv.playlist`, détection, rechargement) | ✅ |
| Téléchargements : client torrent, partage, dossier | schéma des Réglages (`downloads.*`, `chooseDownloadFolder`) | ✅ |
| Jeux › Consoles | Centre › Consoles, `mire-games` | ✅ |
| Jeux › Jeux PC : dossiers, ajout à la main, sites | Réglages (sources `game`, `addPcGame`, `pcSites`) | ✅ |
| Jeux › Entretien : jeux en ligne d'emblée | schéma des Réglages (`gamesOpts.autoOnline`) | ✅ |
| Jeux › Entretien : **« Nettoyer la base de jeux »** (`cleanupGames`, `api.gamesCleanup`) | aucun | ❌ |
| Le rouage lui-même (`mire-app.openPageSettings`) | à rebrancher : vers les Réglages (sur la partie de la page ?) ou retiré — change le comportement d'un composant de la nouvelle interface | ⚠️ décision |

## 4. Boîtes de dialogue historiques (`#dlg`, `#pick`, `confirmDialog`, `openForm`, `pickCandidate` de `app.js`)

| Utilisée par | Remplaçant | État |
| --- | --- | --- |
| `editRef` (ancien éditeur d'infos, `#pick`) | éditeurs de P4-22 (`mire-editor`, `pickCandidate` de `ui/dialogs.ts`) | ✅ |
| `editConsole` (ancien éditeur de console) | `mire-games.editConsole` (P4-17) | ✅ |
| `deleteGameRef`, `cleanupGames` | `mire-games.deleteGame` ; nettoyage : voir § 3 | ✅ / ❌ |
| `askSourceAddress` | `mire-settings.addSourceAddress`, explorateur | ✅ |
| `bookmarkCurrentPage`, `bookmarkCurrentGame`, `askBookmarkConsole` (barre du site, `mire-webbar`) | formulaires sur `ds-modal` (`dialogs.openForm`, P4-06) ; textes à mettre aux catalogues | 🔧 |
| `ui.confirm` des contrôleurs (Centre, page, Réglages…) | `dialogs.openForm` (P4-06) | 🔧 |

## 5. Couches et messages (`legacy-markup.ts`, `mire-app`)

| Élément | Remplaçant | État |
| --- | --- | --- |
| `#toast` (`ui/toast.ts`) | `ds-toaster` de `mire-dialogs` (`toastWithAction`, P4-06) | 🔧 |
| `#drop` (« Déposez vos fichiers pour les lire ») | rien d'autre ne le montre : à placer dans la coquille, texte aux catalogues (pas un écran) | 🔧 |
| `#backdrop` (fond des tuiles historiques, `onHoverItem`) | `mire-backdrop` (cartes du catalogue) | ✅ |
| Icônes `data-icon` dessinées au démarrage | composants (`ICON` passé en propriété) | ✅ |

## 6. Raccourcis et gestes

| Geste | Remplaçant | État |
| --- | --- | --- |
| Retour (Échap, B) dans une console, une série | chemin de la vue de page (`pages.back`) | ✅ |
| Modifier (E, Y) | `mire-app.editSelection` : cartes et regroupements du catalogue (P4-22) | ✅ |
| Clic droit sur une tuile : modifier | `initEditors` (clic droit sur une carte du catalogue) | ✅ |
| **Suppr sur un jeu** (`mire-page.deleteSelection`) | ne connaît que les éléments historiques ; sur une carte du catalogue, rien (la boîte du jeu propose « Supprimer ») | ❌ |
| Glisser-déposer de fichiers, touches multimédias (`mediaSession`) | indépendants des vues : gardés | ✅ |

## 7. Actions du pont `data-action` (`LEGACY_ACTIONS`, 58 entrées)

Toutes viennent des gabarits des sections, de l'en-tête et du panneau ci-dessus ; leur remplaçant est celui de la
ligne correspondante. Celles qui n'en ont pas : `rom-online`, `rom-source`, `rom-dl`, `rom-dl-all` (§ 1),
`rom-site-search` (partiel, § 1), `games-cleanup` (§ 3), `genre`, `video-source`, `video-sort`, `game-system`
(§ 2, remplaçant de conception), `scrape-section` pour un seul type (§ 3, partiel), `play-album` (§ 1, partiel).

## Manques à trancher avant le retrait

1. ❌ Jeux en ligne d'une console : afficher, choisir la source, télécharger un jeu ou tous sur l'ordinateur.
2. ❌ « Nettoyer la base de jeux ».
3. ❌ Touche Suppr sur une carte de jeu du catalogue.
4. ⚠️ Filtres et tri sur place (genre, source, tri, système, source de recherche) et champ de recherche de la section :
   les pages (P4-21) et la Recherche (P4-13) suffisent-elles ?
5. ⚠️ Récupérer les infos d'un seul type, et « tout reprendre » pour ce type.
6. ⚠️ Recherche en cours sur un site de jeux d'une console.
7. ⚠️ « Lire l'album » depuis le début.
8. ⚠️ Où mène le rouage de l'en-tête une fois le panneau retiré.
