# Phase 0 — Filet de sécurité

But : pouvoir refactorer sans casser. On ajoute l'outillage, on fige le comportement actuel par des tests et
des captures, on corrige les anomalies urgentes. Aucune réorganisation de l'architecture ici.

Ordre conseillé : P0-01 → P0-02 et P0-03 (en parallèle) → P0-04 → P0-09 ; les correctifs P0-05 à P0-07
peuvent démarrer dès que P0-03 est fusionnée (ils s'appuient sur ses modules et ses tests). P0-08 est datée.
Les correctifs P0-10 et P0-11, révélés par les tests de P0-02, peuvent démarrer tout de suite.

---

## P0-01 — Outillage : lint, formatage, éditeur

- **Dépend de** : — · **Taille** : S
- **Objectif** : disposer de `npm run lint` et d'un formatage cohérent, sans reformater tout le code existant.
- **Constat** : aucun outil ; style homogène mais lignes très longues (jusqu'à 472 caractères dans `renderer/app.js`).
  Un reformatage complet produirait un diff illisible et inutile, puisque ces fichiers seront découpés en phase 1.
- **À faire**
  1. Ajouter en `devDependencies` (versions exactes, comme le reste du `package.json`) : `eslint`, `@eslint/js`,
     `globals`, `prettier`.
  2. `eslint.config.js` (format « flat ») : globals Node pour les fichiers du processus principal et
     `scripts/`, globals navigateur pour `renderer/`, Node **et** navigateur pour `preload.js` et
     `web-preload.js` (ils utilisent `require` et `location`), `api` déclaré en global en lecture seule pour
     `renderer/app.js`. Règles : `@eslint/js` recommandées, plus `no-duplicate-case`, `no-unused-vars`
     (arguments préfixés `_` ignorés), `eqeqeq` en mode `smart`.
  3. Les violations existantes sont mises en « suppressions » (suppressions groupées d'ESLint 9.24 et plus :
     `eslint --suppress-all`, fichier `eslint-suppressions.json` versionné ; à défaut, désactivations ciblées
     commentées) : la CI ne tolère plus de **nouvelles** erreurs. Lister dans la PR les violations supprimées
     (elles seront traitées par P0-07 ou la phase 1).
  4. `.prettierrc` calé sur le style actuel (2 espaces, guillemets simples, points-virgules, virgules finales,
     `printWidth: 160`) et `.prettierignore` listant les fichiers historiques (`main.js`, `renderer/app.js`,
     `renderer/styles.css`, `scraper.js`, `store.js`, `downloads.js`, `adblock.js`, `preload.js`) : seuls les
     fichiers nouveaux ou déplacés sont formatés.
  5. `.editorconfig` (utf-8, LF, 2 espaces, retour final).
  6. Scripts : `lint`, `lint:fix`, `format`, `format:check`.
- **Hors périmètre** : corriger les violations, reformater les fichiers historiques.
- **Critères d'acceptation**
  - [ ] `npm run lint` et `npm run format:check` passent sur un dépôt propre.
  - [ ] Ajouter une erreur volontaire (variable inutilisée) dans `main.js` fait échouer `npm run lint`.
  - [ ] `npm start` fonctionne comme avant ; `npm run dist` n'embarque pas les fichiers de configuration d'outils
        (la liste `build.files` de `package.json` reste inchangée).
- **Vérification** : `npm ci && npm run lint && npm run format:check`.

---

## P0-02 — Tests des modules déjà testables

- **Dépend de** : P0-01 · **Taille** : M
- **Objectif** : figer le comportement des fonctions pures qui ne dépendent pas d'Electron.
- **Constat** : `scraper.js` n'importe pas Electron et expose déjà `_test` (`scraper.js:749`), inutilisé ;
  `discfiles.js` et `romsites.js` sont purs ; `store.js` exporte ses catalogues `EMULATORS`, `FREE_GAMES`.
- **À faire**
  1. Runner `node:test` (aucune dépendance) : script `test` → `node --test test/`, dossier `test/` à la racine.
  2. `test/scraper.test.js` : `parseVideo` (film avec année, nom « scène » `Le.Fabuleux.Destin.2001.1080p…`,
     épisode `S01E03` dans `Série/Saison 1`, `1x03`, dossier générique), `cleanTitle`, `romKey`, `bestMatch`
     (correspondance exacte avec préférence de région, approchée au-dessus de 0,82, rejet en dessous),
     `guessSystem` (par `system`, par nom/émulateur, par extension), `rankByTitle` (le cas « Replaced » du README).
     Exposer pour cela `guessSystem` et `parseVideo` (déjà exportés) et utiliser `createScraper(...)._test`
     avec un dossier temporaire (`os.tmpdir()`), sans réseau.
  3. `test/discfiles.test.js` : `safeRel` (absolu, `..`, lettre de lecteur, antislashs), `parseRefs` pour `.cue`,
     `.toc`, `.gdi` (noms avec et sans guillemets), `.m3u`, `.ccd`, `.mds`, `decode` (UTF-8 avec BOM, Latin-1),
     `refUrl` (encodage par segment), `resolveRemote` avec un `fetchText` factice (récursion `.m3u` → `.cue` →
     `.bin`, refus d'une autre origine, limite `maxFiles`), `missingLocal` sur un dossier temporaire.
  4. `test/romsites.test.js` : `defaultRomSites` pour un système couvert par les quatre sites, par un seul, par
     aucun ; `GAME_FILE_RE`.
  5. `test/store-catalog.test.js` : cohérence des catalogues (identifiants uniques, chaque système a `libretro`
     et des extensions en minuscules commençant par un point, chaque `FREE_GAMES[].system` existe dans
     `RETROARCH_SYSTEMS`, motifs `exe` présents pour chaque plateforme proposée par `source`).
- **Hors périmètre** : modifier le code testé. Si un test révèle un bug, le décrire dans la PR (le test peut
  être marqué `todo`), ne pas corriger.
- **Critères d'acceptation**
  - [ ] `npm test` passe, sans accès réseau (le vérifier en coupant le réseau ou en simulant `fetch`).
  - [ ] Chaque fonction listée a au moins un cas nominal et un cas limite.
- **Vérification** : `npm test`.

---

## P0-03 — Extraction mécanique des fonctions pures de `main.js` + tests de caractérisation

- **Dépend de** : P0-01 · **Taille** : M
- **Objectif** : rendre testables les fonctions pures de `main.js` (qui importe Electron dès la ligne 6) en les
  déplaçant **telles quelles** dans des modules, puis les couvrir.
- **Constat** : fonctions pures mêlées au reste de `main.js`.
- **À faire**
  1. Créer `lib/` (emplacement provisoire ; P1-01 le rangera dans l'arborescence finale), en CommonJS, et y
     déplacer par copier-coller, sans réécriture :
     - `lib/formats.js` : `EXT`, `KIND`, `NATIVE`, `MIME`, `COVER_RE`, `ART_RE`, `FANART_RE`, `MEDIA_KINDS` (`main.js:66-93`) ;
     - `lib/config.js` : `CONFIG_VERSION`, `HOME_BARS`, `THEMES`, `THEME_BG`, `DEFAULT_TV`, `DEFAULT_WEB`,
       `DEFAULT_CONFIG`, `NESTED`, `slug`, `newId`, `mergeConfig`, `normalizeConfig`, `migrateConfig`
       (`main.js:99-362`) — `saveConfig` et `loadConfig` restent dans `main.js` ;
     - `lib/m3u.js` : `parseM3U`, `qualityOf`, `groupChannels` (`main.js:782-843`) ;
     - `lib/location.js` : `resolveLocation` (`main.js:401-415`), avec un second paramètre facultatif
       `{ platform = process.platform, uid }` pour pouvoir tester les trois systèmes (seul écart autorisé) ;
     - `lib/args.js` : `substitute`, `isUrlTarget` (`main.js:897-913`) ;
     - `lib/text.js` : `decodeText`, `srtToVtt` (`main.js:730-737`), `foldText`, `providerMatches`
       (`main.js:1452-1476`), `episodeNumbers` (`main.js:646-649`), `cleanRomName` (`main.js:1600-1603`),
       `similarity` (`main.js:1537-1544`).
  2. `main.js` importe ces modules ; **ajouter `lib/**/*` à `build.files`** dans `package.json` (sinon
     l'installateur est cassé).
  3. Tests (`test/lib/*.test.js`) :
     - `normalizeConfig` : config vide, config complète, valeurs invalides (thème inconnu, position de menu
       inconnue, sources sans emplacement, sites sans URL, services TV utilisateur fusionnés avec ceux par défaut,
       service actif inexistant) ;
     - `migrateConfig` : un fichier de fixtures par version d'origine (`test/fixtures/config-v1.json` …
       `config-v5.json`, construits d'après le code de migration), résultat attendu figé (snapshot JSON relu à la main) ;
     - `mergeConfig` : pas de doublon (sites par `id`, consoles et jeux par `path`, sources par emplacement),
       rien de supprimé ;
     - `parseM3U` (titre après la première virgule hors guillemets, attributs, lignes sans `#EXTINF`),
       `qualityOf`, `groupChannels` (numéro dans `tvg-chno` ou dans le titre, variantes « (HD) », tri) ;
     - `resolveLocation` : chemins, `\\NAS\Films`, `//NAS/Films`, `smb://` sous Windows, macOS, Linux (gvfs) ;
     - `substitute` (argument retiré quand sa variable est vide), `providerMatches` (alias `=max`),
       `srtToVtt`, `decodeText` (Windows-1252), `episodeNumbers`, `cleanRomName`, `similarity`.
- **Hors périmètre** : renommer, dédoublonner, typer (c'est la phase 1).
- **Critères d'acceptation**
  - [ ] Le diff de `main.js` ne contient que des suppressions et des `require`.
  - [ ] `npm test` passe ; `npm start` fonctionne (accueil, réglages, ajout d'une source).
  - [ ] `npm run dist` produit un installateur qui démarre (au moins sous Linux : AppImage).
- **Vérification** : `npm test`, `npm start`, `npm run dist` (Linux).

---

## P0-04 — Intégration continue

- **Dépend de** : P0-02, P0-03 · **Taille** : S
- **Objectif** : lint et tests à chaque push et à chaque PR.
- **À faire**
  1. `.github/workflows/ci.yml` : déclenché sur `push` et `pull_request` ; `ubuntu-latest`, Node 22 ;
     cache npm ; `npm ci` avec `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (vérifier que le paquet castLabs respecte
     cette variable ; sinon documenter le temps de téléchargement) ; `npm run lint` ; `npm run format:check` ; `npm test`.
  2. Badge CI dans le README (section en tête).
- **Critères d'acceptation**
  - [ ] Le workflow passe sur la PR elle-même.
  - [ ] Une PR de test contenant une erreur de lint échoue (à montrer dans la description, puis fermer).
- **Vérification** : onglet Actions de la PR.

---

## P0-05 — Correctif : portails TV web (SFR TV, B.tv, Molotov)

- **Dépend de** : P0-03 · **Taille** : S · 🧑
- **Objectif** : les services TV de type « web » s'ouvrent dans la vue intégrée.
- **Constat** : `openTvWeb` (`renderer/app.js:1696-1705`) ouvre l'identifiant `tv:web` ; `webOpen`
  (`main.js:1227-1242`) ne gère que `rom:` et `bm:`, puis cherche dans `config.web` → « Ce site n'existe plus
  dans la configuration ». `viewWeb` (`renderer/app.js:1929-1938`) ne sait pas non plus reconstituer l'entrée.
- **À faire**
  1. Identifiant `tv:<id du service>` (et non `tv:web`) : `webOpen` reconstruit l'entrée depuis
     `config.tv.services` (nom, URL, couleur `#E23B3B`, `mode: 'integrated'`, pas de recherche) ; refuser un
     service de type `playlist`.
  2. Extraire la résolution « identifiant → entrée de vue web » (`rom:`, `bm:`, `tv:`, site) dans une fonction
     pure `lib/web-entry.js` testée.
  3. Renderer : `openTvWeb` utilise `tv:<id>` ; `viewWeb` reconstitue l'entrée `tv:` ; dans le menu, l'entrée
     « Télévision » est marquée active quand un portail TV est affiché ; « Retour » et la fermeture du site
     ramènent à la page Télévision (et non à Streaming).
- **Hors périmètre** : refonte de la vue web (P1-11).
- **Critères d'acceptation**
  - [ ] Tests de `lib/web-entry.js` (les quatre cas + identifiant inconnu).
  - [ ] Choisir « SFR TV » dans le rouage de la page Télévision puis « Ouvrir SFR TV » affiche le portail.
  - [ ] Échap, ou la fermeture du site, ramène à la page Télévision.
- **Vérification** : `npm test` ; 🧑 manuelle : SFR TV, B.tv, Molotov (la page s'affiche ; la lecture dépend
  des droits du fournisseur).

---

## P0-06 — Correctif : contrôle du chemin avant suppression d'un jeu

- **Dépend de** : P0-03 · **Taille** : S
- **Objectif** : `games:delete` ne peut supprimer qu'un fichier de jeu situé dans les dossiers locaux de sa console.
- **Constat** : `main.js:1920-1940` supprime `ref.path`, récursivement si c'est un dossier, sans contrôle.
- **À faire**
  1. Fonction pure `isInside(path, roots)` dans `lib/` (normalisation, insensibilité à la casse sous Windows,
     refus de la racine elle-même et des remontées `..`), testée.
  2. `games:delete` pour une ROM : exiger `ref.emuIndex` valide ; racines = `romsDir` et sources locales
     (non web) de cette console, résolues par `resolveLocation` ; refuser si le chemin n'y est pas, ou si ce
     n'est pas un fichier. Les fichiers compagnons d'un index de disque restent supprimés (ils sont déjà limités
     par `safeRel`).
  3. Message d'erreur clair en cas de refus.
- **Critères d'acceptation**
  - [ ] Tests de `isInside` (Windows et POSIX).
  - [ ] Supprimer un jeu local depuis son panneau fonctionne toujours (fichier simple et jeu `.cue` + `.bin`).
  - [ ] Un appel IPC forgé avec un chemin hors des dossiers de la console est refusé (test ou démonstration
        dans la PR, par exemple depuis les outils de développement).
- **Vérification** : `npm test`, essai manuel.

---

## P0-07 — Nettoyage du code mort et petites incohérences

- **Dépend de** : P0-01, P0-03 · **Taille** : S
- **Objectif** : retirer ce qui ne sert pas, pour alléger la phase 1.
- **À faire**
  1. Retirer : `genreBar`, `gameGenrePool`, le second `case 'games-cleanup'`, `case 'scrape-fix'`, l'étiquette
     `case 'pc-sites'`, `foldersChanged`, `void online`, l'alias `gameEntries` (remplacer par `pcGameEntries`),
     les phases jamais émises de `onRomDownload` (ne garder que `done`) dans `renderer/app.js` ; `KNOWN_WEB`,
     le bloc vide de `migrateConfig` (`raw.ui.home.services`) ; `void cosmetic` et la variable associée dans
     `adblock.js` ; `activeCount` dans `downloads.js`.
  2. Nettoyage des jeux (`games:cleanup`) : supprimer la boucle `listRoms` dont le résultat n'est pas utilisé.
  3. Marque-page de jeu (`gameBookmarks:add`, `main.js:2113-2124`) : la recherche de fiches ne sert à rien
     (résultat ignoré) mais l'interface annonce « infos récupérées ». Retirer l'appel et le message trompeur ;
     corriger la phrase correspondante du README (section « Ajouter des jeux à une console »). La vraie reprise
     des infos sera faite en P1-14.
  4. Retirer de `eslint-suppressions.json` les entrées devenues inutiles.
- **Critères d'acceptation**
  - [ ] Aucune fonctionnalité visible ne change (hormis le message du marque-page de jeu).
  - [ ] `npm run lint` : moins de suppressions qu'avant ; `npm test` passe.
- **Vérification** : `npm run lint`, `npm test`, parcours rapide des sections.

---

## P0-08 — Mise à jour de sécurité d'Electron castLabs

- **Dépend de** : — · **Taille** : S · 🧑 · **Pas avant le 5 novembre 2026** (prudence indiquée dans le README)
- **Objectif** : passer de `v44.5.1+wvcus` à `v44.9.3+wvcus` (faille GHSA-jr5w-w6x2-84p9).
- **À faire** : modifier la ligne `electron` de `package.json`, régénérer `package-lock.json`, retirer du README
  le paragraphe « à partir du 5 novembre 2026 » et mettre à jour la version citée.
- **Critères d'acceptation**
  - [ ] `npm ci && npm start` fonctionne ; `npm audit` ne signale plus la faille d'Electron.
  - [ ] 🧑 Sous Windows ou macOS : `npm run drm:signer`, puis lecture d'une vidéo Netflix ou Prime Video.
  - [ ] 🧑 `npm run dist` produit un installateur signé VMP (message de `scripts/drm.js` sans avertissement).
- **Vérification** : manuelle, sur une vraie machine.

---

## P0-09 — Test de fumée Electron et captures de référence

- **Dépend de** : P0-03, P0-04 · **Taille** : M
- **Objectif** : vérifier automatiquement que l'application démarre et que chaque section s'affiche, et produire
  des captures de référence qui serviront de base de comparaison pendant les phases 1 et 2.
- **À faire**
  1. Permettre un dossier de données isolé : si la variable d'environnement `MIRE_USER_DATA` est définie,
     `app.setPath('userData', …)` avant toute lecture (tout en haut de `main.js`). Documenter dans le README
     (section développeurs).
  2. Fixtures `test/e2e/fixtures/` : `config.json` de démonstration (thème par défaut, `tv.detected: true`,
     bloqueur désactivé et récupération automatique désactivée pour éviter le réseau, deux sources locales,
     une console factice dont l'émulateur est un script inoffensif, deux jeux PC factices, deux sites web),
     et une petite bibliothèque factice (quelques fichiers vides `.mkv`, `.mp3`, une image PNG de 1 px, un
     dossier `Série/Saison 1/S01E01.mkv`). Les chemins de la config sont réécrits au lancement du test vers le
     dossier temporaire.
  3. `test/e2e/smoke.test.js` avec `playwright-core` (`_electron.launch`), exécuté par `node:test` : une seule
     dépendance ajoutée (ni `@playwright/test`, ni navigateurs à télécharger), conformément à D-03. Le scénario : l'accueil s'affiche ; navigation clavier
     vers chaque section (Rechercher, Vidéos, Musique, Images, Streaming, Télévision, Jeux, Téléchargements,
     Réglages) ; ouverture du rouage d'une page ; capture d'écran de chaque section, plus l'accueil dans les
     cinq thèmes. Captures enregistrées dans `test/e2e/__screenshots__/` (versionnées).
  4. Script `test:e2e` ; job CI séparé (`xvfb-run`, téléchargement du moteur Electron autorisé pour ce job) ;
     les captures du job sont publiées en artefact.
- **Hors périmètre** : comparaison automatique pixel à pixel (on compare visuellement à chaque PR des
  phases 1 et 2 ; une comparaison automatique pourra venir en P2-21).
- **Critères d'acceptation**
  - [ ] `npm run test:e2e` passe en local (Linux) et dans la CI.
  - [ ] Aucune requête réseau sortante pendant le test, hors téléchargement de Widevine (à vérifier et noter).
  - [ ] Les captures montrent des sections remplies (pas seulement des états vides).
- **Vérification** : `npm run test:e2e`, artefacts de la CI.

---

## P0-10 — Correctif : titre de film qui commence par une année

- **Dépend de** : P0-02 · **Taille** : S
- **Objectif** : un film dont le nom commence par une année garde son vrai titre.
- **Constat** (révélé par P0-02) : dans `parseVideo` (`scraper.js`), `name.slice(0, last.index + 1)` suppose
  un séparateur devant l'année. Quand l'année est en tête du nom, le premier chiffre est pris pour le titre :
  `1917` → titre « 1 », année 1917 ; `2001 L'Odyssée de l'espace` → titre « 2 », année 2001. Le titre sert à
  la recherche des fiches et au regroupement : ces films ne sont pas reconnus.
- **À faire**
  1. Ne retenir une année que si elle est précédée d'un titre (un séparateur ne compte pas) ; sinon le nom
     entier est le titre et l'année reste vide.
  2. Retirer la marque `todo` du test correspondant dans `test/scraper.test.js` et ajouter les cas
     `2001 L'Odyssée de l'espace` (titre complet, sans année) et `2001 L'Odyssée de l'espace (1968)`
     (titre complet, année 1968).
- **Hors périmètre** : les autres heuristiques de `parseVideo` (par exemple `Blade Runner 2049` sans autre
  année, compris comme « Blade Runner » de 2049 : voir les pistes du BACKLOG).
- **Critères d'acceptation**
  - [ ] Plus aucun test `todo` dans `test/scraper.test.js` ; les autres cas de `parseVideo` sont inchangés.
- **Vérification** : `npm test`.

---

## P0-11 — Correctif : adresses complètes dans un `.m3u` distant

- **Dépend de** : P0-02 · **Taille** : S
- **Objectif** : une liste `.m3u` qui cite ses disques par leur adresse complète est comprise correctement.
- **Constat** (révélé par P0-02) : `parseRefs` traite chaque ligne comme un chemin relatif.
  `https://autre.org/x/Disc 1.cue` devient le chemin `https:/autre.org/x/Disc 1.cue`, que `resolveRemote`
  demande sur le site de l'index (échec assuré) et qui créerait un dossier `https:` dans le dossier du jeu. Le
  contrôle d'origine de `resolveRemote` ne se déclenche jamais, puisqu'aucune adresse complète ne lui parvient.
- **À faire**
  1. `parseRefs` ignore les lignes qui sont des adresses complètes (`schéma:`), pour tous les index.
  2. `resolveRemote` : pour un `.m3u`, une adresse complète du même site et sous le dossier de l'index est suivie
     comme une référence relative ; une adresse vers un autre site ou hors de ce dossier est ignorée (le
     contrôle d'origine existant sert enfin).
  3. `missingLocal` : une adresse complète dans un `.m3u` local n'est pas signalée comme fichier manquant.
  4. Mettre à jour le test `resolveRemote : ne quitte jamais le site ni le dossier de l'index` de
     `test/discfiles.test.js` (il fige aujourd'hui le chemin `https:/…`) et ajouter les cas ci-dessus.
- **Critères d'acceptation**
  - [ ] Aucun fichier rendu par `resolveRemote` n'a de `rel` commençant par un schéma.
  - [ ] Une adresse complète du même dossier est suivie ; une autre origine est ignorée, sans requête.
- **Vérification** : `npm test`.
