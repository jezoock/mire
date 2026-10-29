# Phase 1 — Refacto modulaire

But : un code rangé par domaine, où les données (catalogues) sont séparées de la logique, où chaque module a
une responsabilité claire et des dépendances explicites, et où les futurs points d'extension des addons
existent déjà sous forme d'interfaces internes. **Le comportement de l'application ne change pas** (sauf
mention contraire dans une fiche) : les tests de la phase 0 et les captures de référence (P0-09) servent de preuve.

Prérequis : point d'étape **G1** validé, décisions **D-01** (TypeScript), **D-02** (organisation) et **D-03**
(tests) prises. Les fiches ci-dessous supposent les recommandations retenues ; à ajuster sinon.

Organisation cible (le paquet racine reste l'application : `electron-builder`, `overrides` et `vendor/` ne bougent pas) :

```
src/main/       processus principal, un dossier par domaine
src/preload/    pont IPC et script d'avant-page des sites
src/renderer/   interface (encore « legacy » pendant cette phase)
packages/shared/   fonctions pures, types du domaine, contrat IPC (@mire/shared)
```

Les interfaces des futurs points d'extension (`SourceProvider`, `MetadataProvider`…) sont définies dans
`src/main/<domaine>/types.ts` ; elles seront promues dans le SDK des addons en P3-02.

Parallélisme : après P1-01, les tâches du processus principal (P1-02 à P1-20) et celles du renderer (P1-22 à
P1-25) touchent des fichiers différents et peuvent avancer en parallèle. Entre tâches d'un même côté, respecter
les dépendances et fusionner une à une.

---

## P1-01 — Squelette : arborescence, TypeScript, build

- **Dépend de** : G1, D-01, D-02 · **Taille** : L
- **Objectif** : installer l'arborescence cible et la chaîne de build, en déplaçant les fichiers sans les modifier.
- **À faire**
  1. `git mv` : `main.js` → `src/main/index.js` ; `scraper.js`, `store.js`, `downloads.js`, `adblock.js`,
     `discfiles.js`, `romsites.js`, `lib/` → `src/main/` ; `preload.js`, `web-preload.js` → `src/preload/` ;
     `renderer/` → `src/renderer/`. Les fichiers restent en JavaScript : chaque tâche suivante convertit en
     TypeScript les modules qu'elle touche.
  2. Espaces de travail npm : `"workspaces": ["packages/*"]` ; créer `packages/shared` (`@mire/shared`,
     `package.json`, `tsconfig.json`, `src/index.ts` vide).
  3. TypeScript : `tsconfig.base.json` (`strict`, `allowJs`, `checkJs: false`, `noEmit`), script `typecheck`.
  4. Build esbuild (`scripts/build.mjs`) : main, preload et web-preload en bundles CommonJS dans `dist/`
     (le preload sandboxé ne charge pas d'ESM) ; externes = `electron` + dépendances de `package.json` ; les
     paquets de l'espace de travail sont intégrés au bundle ; renderer copié dans `dist/renderer/`. Mode `--watch`.
  5. Corriger les chemins calculés depuis `__dirname` (preload, web-preload, `index.html`).
  6. `package.json` : `main: "dist/main/index.js"`, `build.files` = `dist/**/*` (+ ce qui reste nécessaire),
     scripts `build`, `start` (build puis Electron), `dev` (watch + Electron), `typecheck` ajouté à la CI.
  7. Tests : les tests existants suivent les fichiers déplacés ; permettre les tests en TypeScript (suppression
     de types native de Node 22, sinon `tsx` — à valider et documenter).
- **Hors périmètre** : toute modification de logique.
- **Critères d'acceptation**
  - [ ] `npm start`, `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint` passent.
  - [ ] Captures P0-09 identiques.
  - [ ] `npm run dist` (Linux) : l'AppImage démarre, la boutique trouve 7-Zip (`asarUnpack`), les torrents se
        chargent (import dynamique de `webtorrent`).
- **Vérification** : commandes ci-dessus ; 🧑 `npm run dist` sous Windows si possible.

---

## P1-02 — `@mire/shared` : texte, URL, identifiants

- **Dépend de** : P1-01 · **Taille** : M
- **Objectif** : une seule implémentation de chaque utilitaire, testée.
- **À faire** : dans `packages/shared/src/` (TypeScript) :
  - `text.ts` : `fold` (remplace `fold`/`foldText` de `main.js`, `scraper.js`), `slug`, `safeFileName`
    (remplace `safeName` de `downloads.js` et les deux `replace(/[<>:"/\\|?*]/g, '_')` de `main.js`),
    `cleanTitle`, `titleKey`, `bigramDice`, `rankByTitle`, `stripTags` (« (Europe) [!] », 5 copies),
    `cleanRomName`, `parseEpisode` (`S01E03`, `1x03` : remplace `episodeNumbers` et les expressions de
    `scraper.js`), `GENERIC_DIR`, `similarity` ;
  - `url.ts` : `hostOf`, `siteOf` (`main.js`, `adblock.js`), `safeDecode`, `isHttpUrl`, `isUrlTarget` ;
  - `id.ts` : `newId` (`main.js`, `downloads.js`).
  Remplacer toutes les copies **côté processus principal**. Les copies du renderer seront remplacées en P1-23
  (le renderer n'est pas encore « bundlé »).
- **Critères d'acceptation**
  - [ ] Plus aucune copie dans `src/main` (vérifier par recherche) ; tests unitaires de chaque fonction
        (reprendre les cas de P0-02/P0-03).
  - [ ] Captures P0-09 identiques ; `npm test` passe.

---

## P1-03 — `@mire/shared` : formats et référentiel des systèmes

- **Dépend de** : P1-02 · **Taille** : M
- **Objectif** : un référentiel unique des formats de fichiers et des systèmes de jeu.
- **Constat** : systèmes décrits dans `scraper.js` (`SYSTEM_GUESS`, `NAME_GUESS`), `store.js`
  (`RETROARCH_SYSTEMS`), `romsites.js` (clés des tables), `app.js` (`LIBRETRO_SYSTEMS`).
- **À faire**
  1. `media-formats.ts` : `EXT`, `KIND`, `NATIVE`, `MIME`, `COVER_RE`, `ART_RE`, `FANART_RE`, `GAME_FILE_RE`,
     extensions des index de disques.
  2. `systems.ts` : tableau de systèmes `{ id (nom libretro), name, extensions, aliases (expressions de
     détection par nom d'émulateur) }` et `guessSystem(console)` (même ordre de priorité qu'aujourd'hui :
     `system` explicite, puis nom/programme, puis extensions).
  3. Les correspondances propres à un usage restent chez leur propriétaire mais sont indexées par `id` de
     système : cœurs RetroArch (boutique), sites de ROMs (`romsites`).
  4. `scraper`, `store`, `romsites` utilisent le référentiel ; le renderer reçoit la liste des systèmes par la
     config ou un canal IPC (remplacera `LIBRETRO_SYSTEMS` en P1-23).
- **Critères d'acceptation**
  - [ ] Tests de `guessSystem` repris de P0-02 et verts sans modification des attendus.
  - [ ] Plus aucune liste de systèmes en double dans `src/main`.

---

## P1-04 — Client HTTP unique

- **Dépend de** : P1-01 · **Taille** : M
- **Objectif** : un seul module pour toutes les requêtes sortantes du processus principal.
- **Constat** : `get`/`fetchText`/`download` (`store.js`), `getJson`/`getText`/`saveImage` (`scraper.js`),
  `fetchText` (`adblock.js`), `fetch` directs dans `main.js` (index HTTP, M3U, sous-titres, détection TV,
  vérification d'une adresse, nettoyage des jeux).
- **À faire** : `src/main/net/http.ts` :
  - `request(url, { timeout, headers, signal, method })` avec l'identité `Mire/1.0 (lecteur multimédia personnel)`
    par défaut et des erreurs en français (« Impossible de joindre … », « … met trop de temps à répondre »,
    « … a répondu avec le code … ») ;
  - `getJson` (option « 404 → null »), `getText`, `head` ;
  - `downloadToFile(url, dest, { onProgress, signal })` : écriture dans `dest.part` puis renommage, nettoyage en
    cas d'échec ;
  - `rateLimited(key, intervalMs)` (MusicBrainz : 1 requête par seconde) ;
  - remplacer les usages listés. `downloads.fetchText` (qui passe par la session des sites, avec ses cookies)
    garde ce comportement mais via la même signature.
- **Critères d'acceptation**
  - [ ] Tests avec un serveur `node:http` local : délai dépassé, code d'erreur, 404 → null, progression,
        fichier `.part` supprimé après une erreur, limiteur de débit.
  - [ ] Messages d'erreur visibles identiques à ceux d'aujourd'hui (comparer les chaînes).

---

## P1-05 — Stockage JSON atomique

- **Dépend de** : P1-01 · **Taille** : M
- **Objectif** : une seule façon de lire et d'écrire les fichiers de données, sans risque de fichier tronqué (A5).
- **À faire** : `src/main/storage/` :
  - `createJsonStore(file, { defaults, debounceMs, onCorrupt })` : lecture tolérante, écriture atomique
    (fichier temporaire puis renommage), écriture différée optionnelle, `flush()` à la fermeture de l'app ;
  - `paths.ts` : arborescence des données (`config.json`, `meta/`, `scrape/`, `telechargements.json`,
    `torrents/`, `emulators/`, `adblock/`, `cache/roms/`, `bin/`) en un seul endroit ;
  - adopter le module dans `scraper` (`db.json`), `downloads` (`telechargements.json`), `store`
    (`installed.json`), métadonnées manuelles (`meta.json`), `adblock` (`listes.json`). `config.json` est
    traité par P1-06.
  - Documenter l'arborescence dans `docs/architecture.md` (créé ici, complété en P1-27).
- **Critères d'acceptation**
  - [ ] Tests : écriture interrompue simulée (le fichier précédent reste lisible), fichier corrompu → callback
        `onCorrupt` et valeurs par défaut, regroupement des écritures différées, `flush`.
  - [ ] Les fichiers produits sont identiques (même JSON) à ceux d'avant.

---

## P1-06 — Service de configuration

- **Dépend de** : P1-02, P1-05 · **Taille** : L
- **Objectif** : remplacer la variable globale `config` (réassignée une vingtaine de fois) par un service
  observable, et ranger défauts, migrations et normalisation.
- **À faire** : `src/main/config/` (TypeScript) :
  - `defaults.ts` (`DEFAULT_CONFIG`) et `catalogs/` (`DEFAULT_TV`, `DEFAULT_WEB` : données, futures données d'addons) ;
  - `migrations/` : un fichier par version (`v2.ts` … `v5.ts`) + registre ; `migrate(raw)` → `{ config, from, changed }` ;
  - `normalize/` : une fonction par section (bibliothèque, jeux, consoles, sites, TV, interface, marque-pages…) ;
  - `merge.ts` (import « compléter ») ;
  - `service.ts` : `get()`, `update(mutateur)`, `replace(config)`, `onChange((suivante, précédente) => …)`,
    sauvegarde par le stockage atomique, mise de côté d'un fichier illisible (`config.json.illisible-<date>`) ;
  - types de la configuration dans `@mire/shared` (`Config`, `Emulator`, `WebSite`, `TvService`…) ;
  - remplacer tous les `config = saveConfig(...)` et les lectures de `config.` par le service ; les modules
    `scraper`, `store`, `downloads`, `adblock` reçoivent `config.get` au lieu de `() => config`.
- **Critères d'acceptation**
  - [ ] Tests de P0-03 (normalisation, migrations, fusion) repris et verts sans changement des attendus.
  - [ ] Plus de variable globale `config` ; un abonné à `onChange` est appelé une fois par modification.
  - [ ] Captures P0-09 identiques ; import et export de configuration fonctionnent (essai manuel).

---

## P1-07 — Identifiants stables des consoles (migration v6)

- **Dépend de** : P1-06, P1-08 · **Taille** : L
- **Objectif** : référencer une console par un identifiant, et non par sa position dans la liste (A3).
- **À faire**
  1. Migration v6 : chaque `emulators[]` reçoit un `id` (conserver `store` comme identifiant pour les consoles
     de la boutique, `slug(nom)` + suffixe sinon) ; `gameBookmarks[].console` et les fiches de
     `telechargements.json` (`console`) passent de l'index à l'identifiant ; « pc » reste « pc ».
  2. Processus principal : `rom:<id>` pour les vues web, `consoleSites(id)`, `listRoms(id)`, `launchRom(id, …)`,
     destination des téléchargements, boutique (`registerConsoles`), nettoyage, suppression.
  3. Contrat IPC (P1-08) : arguments `emuIndex` → `consoleId`.
  4. Renderer : `S.romsOf`, `S.localRoms`, `S.romsCache`, `S.romSites`, `emuIndex`, `systemKey: emu:<id>`,
     sélecteur de destination des téléchargements, panneaux et éditeurs.
- **Critères d'acceptation**
  - [ ] Test de migration v5 → v6 (y compris marque-pages et téléchargements en attente).
  - [ ] Scénario : trois consoles, un marque-page de jeu et un téléchargement en attente sur la troisième ;
        supprimer la première ; le marque-page et le téléchargement visent toujours la bonne console.
  - [ ] Plus aucun accès `emulators[i]` par index venant de l'interface (recherche dans le code).

---

## P1-08 — Contrat IPC typé

- **Dépend de** : P1-01 · **Taille** : M
- **Objectif** : décrire une seule fois les 85 canaux et les 17 événements, et en dériver le preload.
- **À faire**
  1. `@mire/shared/ipc` : table des méthodes (`nom de la méthode window.api` → `canal`, types des arguments et
     du résultat), table des événements (`onDownload` → `download`…). Garder **exactement** les noms actuels de
     `window.api` pour ne pas toucher au renderer.
  2. Processus principal : enregistrement générique (`registerHandlers(table, implémentations)`, avec le même
     traitement d'erreur qu'aujourd'hui) ; implémentations rangées par domaine dans `src/main/ipc/handlers/` ;
     la logique métier écrite directement dans les handlers (suppression et nettoyage des jeux, marque-pages,
     import/export de config, téléchargement d'un jeu sur disque) est déplacée dans des fonctions nommées.
  3. Preload : construit `window.api` à partir de la table (plus de liste manuelle) ; les `onX(callback)`
     renvoient désormais une fonction de désabonnement (compatible avec l'existant).
- **Critères d'acceptation**
  - [ ] Test : chaque méthode de la table a un handler et un seul, chaque handler est dans la table, les noms
        de `window.api` sont ceux d'avant (comparer avec la liste du `preload.js` d'origine).
  - [ ] Captures et test de fumée identiques.

---

## P1-09 — Données d'usage côté processus principal

- **Dépend de** : P1-05, P1-08, D-06 · **Taille** : S
- **Objectif** : « Reprendre », positions de reprise des vidéos, volume et recherches récentes ne dépendent plus
  du `localStorage` du renderer et sont inclus dans l'export de configuration.
- **Constat** : `getRecent`/`setRecent`, `resume:<chemin>`, `volume`, `queries` dans `renderer/app.js`.
- **À faire** : `src/main/usage/` (fichier `usage.json` par le stockage atomique), canaux IPC dédiés, export et
  import de configuration incluant ces données (option « compléter » : fusion sans doublon) ; reprise des
  données existantes du `localStorage` au premier lancement (migration côté renderer, une seule fois).
- **Critères d'acceptation**
  - [ ] Après mise à jour, « Reprendre » et les positions de reprise d'une installation existante sont conservés.
  - [ ] Export puis import sur une installation vierge : « Reprendre » est restauré.

---

## P1-10 — Sécurité des chemins et protocole `media://`

- **Dépend de** : P1-06 · **Taille** : M
- **Objectif** : une politique d'accès aux fichiers unique, rapide et testée.
- **Constat** : `allowedRoots()` recalculé à chaque requête `media://` (A6) ; contrôles répartis
  (`isAllowed` dans plusieurs handlers, `openedFiles`).
- **À faire**
  - `src/main/security/access-policy.ts` : racines autorisées mises en cache et recalculées sur changement de
    config (abonnement au service), fichiers ouverts explicitement, `isAllowed`, `isInside` (P0-06) ;
  - `src/main/media-protocol/` : enregistrement de `media://` ; analyse des plages en fonction pure
    `parseRange(entête, taille)` testée (plage simple, suffixe `bytes=-500`, invalide, 416) ;
  - utiliser la politique partout : sous-titres, lecteur externe, lancement d'un jeu PC ou d'une ROM, suppression.
- **Critères d'acceptation**
  - [ ] Tests de `parseRange` et de la politique (racines, fichiers ouverts, Windows insensible à la casse).
  - [ ] Test : 1 000 requêtes `media://` → les racines ne sont calculées qu'une fois.
  - [ ] Lecture vidéo avec avance rapide toujours fonctionnelle (essai manuel).

---

## P1-11 — Plateforme : lancement de programmes, lecteurs et navigateurs

- **Dépend de** : P1-01 · **Taille** : S
- **Objectif** : isoler ce qui dépend du système d'exploitation.
- **À faire** : `src/main/platform/` :
  - `launcher.ts` : `launchProcess` (cas `.app` macOS, `detached`), `openTarget` (`.lnk`, `.url`, `.bat`, adresses
    `steam://`), « réduire pendant le jeu » par des rappels injectés au lieu d'accéder à `mainWindow` ;
  - `detect.ts` : `detectPlayer`, `detectBrowser` avec `fs` et variables d'environnement injectables ;
  - `players.ts` : préréglages d'arguments mpv et VLC sous forme de données (futur addon « lecteur externe »),
    `resolvePlayer`, `playExternal`, `openInBrowser` ;
  - interface `ExternalPlayer { id, detect(), args(variables) }` dans `types.ts`.
- **Critères d'acceptation**
  - [ ] Tests de détection pour Windows, macOS et Linux (système de fichiers simulé) et des arguments mpv/VLC.
  - [ ] 🧑 Une vidéo AVI s'ouvre dans VLC ou mpv à la bonne position.

---

## P1-12 — Vues web intégrées

- **Dépend de** : P1-02, P1-08 · **Taille** : L
- **Objectif** : sortir de `main.js` la gestion des `WebContentsView` (≈ 420 lignes) en modules testables.
- **À faire** : `src/main/web/` :
  - `manager.ts` : création, affichage, position, mode immersif, plein écran HTML, fermeture, focus, touches
    manette, pause des vidéos, état publié vers l'interface (l'état `web` devient interne au gestionnaire) ;
  - `entries.ts` : registre des « résolveurs d'entrées » par préfixe (`rom:`, `bm:`, `tv:` de P0-05, site par
    défaut) — un addon pourra en ajouter ;
  - `session.ts` : permissions, téléchargements et liens magnet, script d'avant-page ;
  - `user-agent.ts` : identité « Chrome » et exception de la connexion Google (fonctions pures testées) ;
  - `shortcuts.ts` : correspondance touche → action (F11, F9, F5, Ctrl+W, Alt+flèches), fonction pure testée ;
  - `learn-search.ts` : calcul du modèle de recherche à partir de l'adresse (« mire » → `{q}`), testé ;
  - `drm.ts` : démarrage et état de Widevine.
- **Critères d'acceptation**
  - [ ] Tests des fonctions pures (identité, raccourcis, modèle de recherche, résolution des entrées).
  - [ ] 🧑 Parcours : ouvrir deux services, passer de l'un à l'autre, plein écran F11, F9, fermer avec Ctrl+W,
        mémoriser une recherche, ouvrir « Ajouter des jeux » d'une console et changer de site.

---

## P1-13 — Bloqueur de publicités en « extension de vue web »

- **Dépend de** : P1-12 · **Taille** : M
- **Objectif** : définir l'interface `WebExtension` et y faire entrer le bloqueur et l'exception Google, pour
  qu'ils puissent devenir des addons (P3-24, P3-25).
- **Points d'attention** : Electron n'accepte qu'**un** écouteur par événement `webRequest` et par session ; le
  gestionnaire doit composer les extensions (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`).
- **À faire**
  - `src/main/web/extensions.ts` : `WebExtension { id, attach(session), detach(), webRequest?, beforePageScript?(url),
    guardNavigation?(url, depuis), status?() }` et compositeur ;
  - `adblock` devient une extension (compteurs, liste d'exceptions, scriptlets) ; l'identité Google aussi ;
  - `web-preload.js` demande au processus principal **le** script d'avant-page agrégé (un seul canal synchrone
    au lieu de `mire:scriptlets` et `mire:signin-ua`).
- **Critères d'acceptation**
  - [ ] Tests du compositeur (deux extensions sur le même événement, ordre, annulation).
  - [ ] 🧑 YouTube sans publicité avec vidéo lisible ; compteur du bouclier ; désactivation par site ;
        connexion Google acceptée.

---

## P1-14 — Bibliothèque : sources, parcours, sous-titres

- **Dépend de** : P1-03, P1-04, P1-10 · **Taille** : M
- **Objectif** : un module bibliothèque avec des fournisseurs de sources interchangeables.
- **À faire** : `src/main/library/` :
  - `location.ts` (`resolveLocation`, erreurs d'emplacement) ;
  - interface `SourceProvider { id, canHandle(emplacement), scan(emplacement, types, contexte) }` et trois
    fournisseurs : `local` (dossiers et partages, ex-`walkLibrary`), `http-index` (pages d'index), `m3u` ;
  - `scan.ts` : regroupement des sources communes à plusieurs types, état par source, marque-pages de streaming ;
  - `subtitles.ts` : sous-titres locaux et distants (la table `urlSubs` devient une donnée du résultat d'analyse) ;
  - `item-from-path.ts` ; un parcours de dossiers générique `src/main/fs/walk.ts`, réutilisé ensuite par les jeux,
    la boutique et les téléchargements.
- **Critères d'acceptation**
  - [ ] Tests sur dossier temporaire (affiches, fanart, épisodes, images d'illustration ignorées, profondeur,
        dossiers cachés) et sur serveur HTTP local (index de style Apache et nginx, sous-titres, M3U).
  - [ ] Même nombre d'éléments trouvés qu'avant sur la bibliothèque factice de P0-09.

---

## P1-15 — Télévision

- **Dépend de** : P1-04, P1-12, P1-14 · **Taille** : S
- **À faire** : `src/main/tv/` : `channels.ts` (M3U partagé avec la bibliothèque, qualité, regroupement),
  `detect.ts` (détection de la box), `service.ts` (service actif, chaînes) ; interface
  `TvProvider { kind: 'playlist' | 'web', … }`.
- **Critères d'acceptation**
  - [ ] Tests (playlist Freebox d'exemple, détection avec serveur local qui répond ou non).
  - [ ] 🧑 Sur le réseau d'une Freebox : chaînes listées et lancées dans le lecteur externe.

---

## P1-16 — Moteur de métadonnées et fournisseurs

- **Dépend de** : P1-03, P1-04, P1-05 · **Taille** : L
- **Objectif** : séparer l'orchestration de la récupération d'infos de ses quatre sources, et n'avoir qu'un
  client TMDB.
- **À faire**
  - `src/main/scrape/engine.ts` : base (`db.json`), `record`/`miss`/`wanted` (révision, nouvel essai après 14
    jours), file de tâches avec concurrence par fournisseur, progression, annulation ; `run`, `one`, `candidates` ;
  - interface `MetadataProvider { id, kinds, requires?, key(élément), scrape(élément, choix, contexte),
    candidates(requête, contexte), byId(choix, contexte) }` ;
  - `providers/tmdb.ts`, `providers/musicbrainz.ts` (débit limité), `providers/libretro.ts`,
    `providers/steam.ts` ;
  - `src/main/net/tmdb.ts` : client TMDB unique (jeton long ou clé courte), aussi utilisé par P1-17.
- **Critères d'acceptation**
  - [ ] Tests de chaque fournisseur avec réponses HTTP enregistrées (fixtures JSON), sans réseau.
  - [ ] Tests du moteur (concurrence, annulation, nouvel essai après échec).
  - [ ] 🧑 Récupération réelle sur la bibliothèque factice avec une clé TMDB : mêmes fiches qu'avant.

---

## P1-17 — Recherche « où regarder »

- **Dépend de** : P1-16 · **Taille** : S
- **À faire** : `src/main/search/streaming.ts` (TMDB multi + fournisseurs de diffusion, correspondance avec les
  sites configurés) ; interface `SearchProvider { id, search(requête, contexte) }`.
- **Critères d'acceptation** : tests avec client TMDB simulé (correspondance `=max`, tri des sites configurés en tête).

---

## P1-18 — Archives et boutique

- **Dépend de** : P1-03, P1-04, P1-07 · **Taille** : M
- **Objectif** : séparer le catalogue (données) des installateurs (code).
- **À faire**
  - `src/main/archive/` : 7-Zip (copie exécutable si besoin), `extract` — utilisé par la boutique et les téléchargements ;
  - `src/main/store/catalog/` : émulateurs, cœurs RetroArch par système, jeux libres, indications de BIOS —
    **uniquement des données** ;
  - `store/installers/` : `github-release`, `download-page` (Dolphin), `retroarch` (buildbot + cœurs) ;
  - `store/bios.ts` : dossiers de BIOS décrits par des données (marqueur de mode portable, chemins Windows et
    Linux par émulateur) au lieu du `switch` actuel ;
  - `store/consoles.ts` : création et mise à jour des consoles (identifiants de P1-07).
- **Critères d'acceptation**
  - [ ] Test de caractérisation : pour chaque émulateur et chaque plateforme, le dossier de BIOS calculé est le
        même qu'avec l'ancien `switch`.
  - [ ] Tests de l'analyse des pages de versions GitHub (HTML enregistré).
  - [ ] 🧑 Installation réelle de DuckStation et de RetroArch (deux consoles) sous Windows ou Linux.

---

## P1-19 — Téléchargements

- **Dépend de** : P1-05, P1-07, P1-18 · **Taille** : L
- **Objectif** : un gestionnaire de téléchargements dont les moteurs (HTTP, torrent) sont interchangeables.
- **À faire** : `src/main/downloads/` :
  - `manager.ts` : fiches (persistance atomique), commandes, liste, réglages, événements ;
  - interface `Downloader { id, canHandle(source), add(source, contexte, fiche), pause, resume, cancel, stop }` ;
  - `http.ts` (session Chromium), `torrent.ts` (WebTorrent chargé à la demande, client du système) ;
  - `finish.ts` : décompression par le service d'archives, programmes d'installation, fichiers compagnons
    d'un index de disque ;
  - nouvelle commande « télécharger dans le cache puis prévenir » pour le lancement d'un jeu en ligne (utilisée par P1-20).
- **Critères d'acceptation**
  - [ ] Tests des transitions d'état (redémarrage : HTTP actif → interrompu, torrent en extraction → terminé),
        du post-traitement (fichiers temporaires) et des fichiers compagnons.
  - [ ] 🧑 Un fichier HTTP, un lien magnet (client intégré, puis logiciel du système), un jeu `.cue` + `.bin`
        téléchargé pour une console.

---

## P1-20 — Jeux

- **Dépend de** : P1-07, P1-10, P1-11, P1-14, P1-19 · **Taille** : L
- **À faire** : `src/main/games/` :
  - `pc/scanner.ts` (raccourcis, choix de l'exécutable, liste des utilitaires ignorés) — interface
    `GameSourceProvider` ; `pc/launch.ts` ;
  - `roms/list.ts` (sources locales et web, `.m3u` multi-disques, jaquettes locales), `roms/launch.ts` : un jeu
    en ligne passe désormais par le gestionnaire de téléchargements (A8 : suivi et annulation dans
    Téléchargements) ;
  - `disc/` (ex-`discfiles.js`), `cleanup.ts`, `delete.ts` (P0-06), `bookmarks.ts` ;
  - marque-page de jeu (A4, suite de P0-07) : enregistrer la première fiche trouvée sous la clé du marque-page
    et l'afficher sur sa carte ; après téléchargement, la reporter sur le jeu si le fichier est identifiable.
- **Critères d'acceptation**
  - [ ] Tests sur dossiers temporaires (jeux PC, ROMs, multi-disques masqués, nettoyage).
  - [ ] 🧑 Lancer un jeu PC, une ROM locale, une ROM en ligne (visible et annulable dans Téléchargements).

---

## P1-21 — Racine de composition

- **Dépend de** : P1-06 à P1-20 · **Taille** : M
- **Objectif** : `src/main/index.ts` ne fait plus que créer les services et les relier.
- **À faire** : `window/main-window.ts`, `app/lifecycle.ts` (instance unique, fichiers passés en argument,
  menu macOS), ordre de création des services, câblage des événements (changement de config → politique d'accès
  et vues web ; fin de téléchargement → marque-pages de jeux et annonce « jeu ajouté »), enregistrement de l'IPC.
- **Critères d'acceptation**
  - [ ] `index.ts` de moins de 200 lignes, sans variable globale mutable hors des services.
  - [ ] Tout le processus principal est en TypeScript ; `npm run typecheck` passe en mode strict.
  - [ ] Test de fumée et captures identiques.

---

## P1-22 — Renderer : modules, outils, état, client API

- **Dépend de** : P1-01, P1-08 · **Taille** : M
- **Objectif** : découper `app.js` sans changer l'affichage, en commençant par les fondations.
- **À faire**
  - renderer construit par esbuild (un bundle chargé par `index.html`, CSP inchangée) à partir de
    `src/renderer/main.js` ;
  - `core/` : `dom` (`$`, `$$`, `esc`), `format` (`fmtTime`, `fmtBytes`, `fmtEta`, `fmtSize`, `plural`, `clamp`),
    `icons`, `colors` (`barFor`, `onColor`, `safeColor`, `monogram`) ; `ui/toast` ;
  - `state/` : `S` avec **tous** ses champs déclarés (`focusRef`, `romsWarnings`, `scrapeQuiet`… inclus), `Q`, `V`, `I` ;
  - `api/` : point d'accès unique à `window.api`.
- **Critères d'acceptation** : captures identiques ; plus aucune référence directe à `window.api` hors de `api/`.

---

## P1-23 — Renderer : logique de domaine testée

- **Dépend de** : P1-22, P1-03 · **Taille** : M
- **Objectif** : extraire la logique pure de l'interface (réutilisée telle quelle par la future interface de la phase 2).
- **À faire** : `src/renderer/domain/` — fonctions qui reçoivent leurs données en paramètre au lieu de lire `S` :
  - `items` : `labelOf`, `scrapeKey`, `metaKey`, `withScrape` (**mémoïsé** : recalculé seulement quand les infos
    changent), `genresOf`, `folderLabel`, `cleanTrack` ;
  - `videos` : séries → saisons → épisodes, sources, tris ; `games` : `pcGameEntries`, `allLocalGames`,
    `gameSystems` ; `search` : `filterQ`, `localResults` ; `downloads` : `dlMeta` ; `sites` : `parseSites`,
    `sitesToText`, `searchUrlFor`, `parseArgs`, `joinArgs` ;
  - utiliser `@mire/shared` (pliage, dossiers génériques, épisodes, référentiel des systèmes à la place de
    `LIBRETRO_SYSTEMS`).
- **Critères d'acceptation** : tests unitaires de chaque fonction ; captures identiques.

---

## P1-24 — Renderer : navigation, clavier, manette, lecteurs

- **Dépend de** : P1-22 · **Taille** : M
- **À faire**
  - `nav/spatial` (le calcul du voisin devient une fonction pure `pickNeighbor(rect, candidats, direction)`
    testée), `nav/keyboard`, `nav/gamepad` (familles et glyphes en données, barre de rappel) ;
  - `players/audio`, `players/video`, `players/images`, `players/volume`.
- **Critères d'acceptation**
  - [ ] Tests de `pickNeighbor` (grille, rangées décalées, éléments masqués).
  - [ ] 🧑 Parcours complet à la manette (listes, lecteur vidéo, visionneuse, boîte de modification, site web).

---

## P1-25 — Renderer : vues et actions par domaine

> **⏸ En attente de la décision D-05.** Selon le toolkit et le set de composants retenus pour la phase 2, découper
> les vues historiques peut être inutile (elles seront remplacées). À rediscuter avant de lancer cette tâche.

- **Dépend de** : P1-23, P1-24, D-05 · **Taille** : L (découpage possible : vues, puis actions et boîtes de dialogue)
- **À faire**
  - `views/` : un fichier par section (accueil, recherche, vidéos, séries, musique, images, streaming, web, TV,
    jeux, ROMs, téléchargements, réglages) et `views/bricks` (art, tuiles, grilles, « Afficher plus », états vides) ;
  - `actions/` : le `switch` de 120 cas devient un registre `{ 'play-video': fonction, … }` réparti par domaine ;
  - `ui/dialogs` (`openForm`, `confirmDialog`, `pickCandidate`, pile des fenêtres), `ui/panel`, `ui/editors`,
    `ui/backdrop`, `ui/rail`, `ui/header`.
- **Critères d'acceptation**
  - [ ] Test : chaque `data-action` présent dans les gabarits a une action enregistrée, et inversement.
  - [ ] Captures identiques ; `app.js` n'existe plus.

---

## P1-26 — Réglages déclaratifs

> **⏸ En attente de la décision D-05.** Le schéma des réglages reste utile dans tous les cas (réglages fournis par
> les addons) ; son rendu dépend de l'approche retenue pour la phase 2. À rediscuter avant de lancer cette tâche.

- **Dépend de** : P1-25, P1-06, D-05 · **Taille** : M
- **Objectif** : décrire chaque réglage une seule fois et l'afficher dans la page Réglages comme dans les
  panneaux de page (base des réglages fournis par les addons, P3-04).
- **Constat** : clé TMDB, pays, bloqueur (×2), accueil (×2), lecteur externe (×3) écrits plusieurs fois ;
  certains champs s'enregistrent dès qu'ils changent, d'autres au clic sur « Enregistrer ».
- **À faire** : `settings/schema` (blocs, champs typés : texte, secret, liste de choix, case, chemin, liste,
  bloc personnalisé), rendu commun ; les blocs riches (thèmes, listes ordonnables, sources, boutique, consoles)
  restent des rendus personnalisés référencés par identifiant.
- **Changement visible à valider en revue** : tous les champs s'enregistrent dès qu'ils changent ; seul l'éditeur
  JSON « Sites, jeux et consoles » garde son bouton « Enregistrer ».
- **Critères d'acceptation** : plus aucun réglage décrit deux fois ; test : chaque chemin de config du schéma
  existe dans `DEFAULT_CONFIG`.

---

## P1-27 — Documentation d'architecture

- **Dépend de** : P1-21 (et P1-26 si elle est lancée, voir D-05) · **Taille** : S
- **À faire** : compléter `docs/architecture.md` (modules, responsabilités, flux principaux, contrat IPC,
  stockage, interfaces d'extension) ; section « Développer Mire » dans le README (arborescence, scripts,
  `MIRE_USER_DATA`, tests) ; mettre à jour les commandes de `CLAUDE.md`.
- **Critères d'acceptation** : relu au point d'étape G2.
