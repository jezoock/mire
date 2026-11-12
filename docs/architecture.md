# Architecture de Mire

Ce document décrit Mire à la fin de la phase 1 de la refonte (point d'étape G2). Il est tenu à jour à chaque
changement d'architecture. Pour installer et lancer le projet, voir la section « Développer Mire » du README.

## Vue d'ensemble

Mire est une application Electron (castLabs Electron for Content Security, qui embarque Widevine). Trois sortes
de code tournent dans trois endroits séparés :

- le **processus principal** (`src/main/`, Node) : fichiers, réseau, configuration, programmes externes, vues web ;
- l'**interface** (`src/renderer/`, une page web dans la fenêtre principale) : affichage, clavier, manette,
  lecteurs intégrés. Elle n'a pas accès à Node ;
- les **vues web** : les sites ouverts dans Mire (Netflix, sites de jeux, portails TV…). Chaque site tourne dans sa
  propre vue, posée par-dessus la fenêtre, dans une session séparée.

Le code partagé (types, fonctions pures, contrat IPC, textes) est dans le paquet `@mire/shared`
(`packages/shared/`). `npm run build` assemble le tout dans `dist/` avec esbuild (`scripts/build.mjs`).

```text
┌──────────────────────── Fenêtre principale ────────────────────────┐
│  Interface (src/renderer/)            Vue web (un site)            │
│  app.js + core/ state/ api/           WebContentsView              │
│  domain/ nav/ players/                session persist:web          │
│        │ window.api                   preload : web-preload.js     │
│  preload.js (contextBridge)                  │                     │
└────────┼─────────────────────────────────────┼─────────────────────┘
         │ IPC (contrat @mire/shared/ipc)      │ mire:before-page,
         │ media://local/?p=…                  │ requêtes réseau
┌────────┴─────────────────────────────────────┴─────────────────────┐
│ Processus principal (src/main/)                                    │
│  index.ts : racine de composition                                  │
│  ipc/handlers/ ──► services : config, usage, library, games,       │
│                    scrape, downloads, store, tv, web, i18n…        │
│  media-protocol/ ──► security/ (politique d'accès)                 │
│  storage/ ──► dossier de données (userData)                        │
└────────────────────────────────────────────────────────────────────┘
```

## Processus principal : les modules

Chaque dossier de `src/main/` est un domaine. Un service reçoit ses dépendances en paramètre (configuration,
client HTTP, fonction `toUi`…) : il ne lit ni variable globale ni `userData`, et la plupart ne connaissent pas
Electron. Les tests passent donc de fausses dépendances. Tout le processus principal est en TypeScript.

| Dossier | Rôle |
| --- | --- |
| `index.ts` | Racine de composition : crée les services, les relie, enregistre l'IPC, ouvre la fenêtre. Aucune logique. |
| `app/` | Cycle de vie (`lifecycle.ts`) : instance unique, fichiers passés en argument, menu de macOS, écritures attendues avant de quitter. |
| `window/` | Fenêtre principale (`main-window.ts` : réglages de sécurité, F11, F12, liens externes, `toUi`, réduction pendant un jeu) et boîtes de dialogue système (`dialogs.ts`). |
| `ipc/` | Contexte des handlers (`context.ts`, `main-context.ts`), enregistrement générique (`register.ts`), un fichier de handlers par domaine (`handlers/`). |
| `config/` | Configuration (`config.json`) : défauts, catalogues, migrations, normalisation, fusion, service. Voir « Configuration ». |
| `usage/` | Données d'usage (`usage.json`) : « Reprendre », positions de reprise, volume, recherches récentes. Voir « Données d'usage ». |
| `storage/` | Arborescence du dossier de données (`paths.ts`) et stockage JSON atomique (`json-store.ts`). Voir « Stockage JSON ». |
| `security/` | Politique d'accès aux fichiers locaux (`access-policy.ts`) et ce que la configuration autorise (`allowed.ts`). |
| `media-protocol/` | Protocole `media://` : sert les fichiers locaux à l'interface, avec les plages d'octets. |
| `library/` | Bibliothèque : emplacements (dossier, partage, adresse), fournisseurs de sources (`local`, `http-index`, `m3u`), analyse, sous-titres, élément d'un fichier ouvert. |
| `meta/` | Infos modifiées à la main (`meta/meta.json`) et images choisies (`meta/img/`). |
| `scrape/` | Récupération d'infos et d'images : moteur (`engine.ts`) et fournisseurs (TMDB, MusicBrainz, libretro, Steam). |
| `search/` | Recherche « où regarder » (`streaming.ts`) : titres TMDB et services qui les proposent. |
| `net/` | Client HTTP unique (`http.ts` : délais, identité, erreurs) et client TMDB (`tmdb.ts`). |
| `web/` | Vues web intégrées : gestionnaire des vues, entrées (`netflix`, `rom:`, `bm:`, `tv:`), session `persist:web`, extensions (bloqueur, connexion Google), identité, raccourcis, Widevine. |
| `downloads/` | Téléchargements : gestionnaire (`manager.ts`), moteurs HTTP et torrent, fin d'un téléchargement (`finish.ts` : décompression, programme d'installation, fichiers d'un jeu sur disque). |
| `games/` | Jeux : jeux PC (dossiers, ajout manuel, lancement), jeux de console (liste, lancement, copie locale), jeux sur disque, marque-pages de jeux, nettoyage, suppression, sites « Ajouter des jeux », fin d'un téléchargement vue des jeux. |
| `store/` | Boutique : catalogue (données seules, `catalog/`), installateurs (GitHub, page de téléchargement, RetroArch), consoles créées, BIOS. |
| `tv/` | Télévision : service actif, détection de la box au premier lancement, chaînes (listes M3U), fournisseurs `playlist` et `web`. |
| `platform/` | Ce qui dépend du système : lancement de programmes (`launcher.ts`), lecteurs externes et navigateur (`players.ts`), détection (`detect.ts`). |
| `archive/` | Décompression `.zip` et `.7z` avec le 7za de `7zip-bin` (boutique, téléchargements). |
| `i18n/` | Langue de l'interface (`index.ts`), traduction des textes du processus principal (`current.ts`, fonction `t`), langue des fiches (`metadata.ts`). |
| `fs/` | Parcours générique d'une arborescence de dossiers (`walk.ts`). |
| `lib/` | Petites fonctions pures : chemin sous un dossier autorisé (`paths.ts`), arguments d'une ligne de commande (`args.ts`), texte (`text.ts`), entrées des vues web (`web-entry.ts`). |

Les preloads sont dans `src/preload/` (JavaScript, CommonJS) :

- `preload.js` : celui de la fenêtre principale. Il expose `window.api` (contrat IPC) et `pathForFile` (chemin d'un
  fichier glissé-déposé), et rien d'autre ;
- `web-preload.js` : celui des vues web. Il demande au processus principal le script à exécuter avant le code de la
  page (canal synchrone `mire:before-page`) et l'exécute. Il n'expose rien aux pages.

## Racine de composition

`src/main/index.ts` est le seul endroit où les services sont créés et reliés. L'ordre compte.

**Avant qu'Electron soit prêt** (au chargement du module) :

1. `MIRE_USER_DATA`, si elle est définie, remplace le dossier `userData`. Aucun module ne lit `userData` avant.
2. L'identité « Chrome » est fixée pour toute l'application (`app.userAgentFallback`, `web/user-agent.ts`).
3. Le schéma `media://` est déclaré (`registerMediaScheme`) : cela doit se faire avant `app.whenReady()`.
4. `runApp` (`app/lifecycle.ts`) prend le verrou d'instance unique (sinon, Mire quitte et l'instance déjà ouverte
   reçoit les fichiers), relève les fichiers passés en argument, puis appelle `start` une fois Electron prêt.

**Dans `start`** :

1. Chemins du dossier de données (`dataPaths`).
2. Services de configuration et d'usage (créés, pas encore lus).
3. Politique d'accès. Un abonné à `config.onChange` la remet à zéro et met à jour les sites ouverts.
4. Fenêtre principale (créée, pas encore ouverte) ; elle fournit `toUi`, qui envoie un événement à l'interface.
5. Bibliothèque, boîtes de dialogue, infos modifiées à la main, télévision.
6. Lanceur de programmes et lecteurs externes.
7. Service de langue, branché sur `toUi('i18n:changed')` et sur la fonction `t` du processus principal
   (`useLanguage`).
8. Couche web (`createWebLayer`) : Widevine et gestionnaire des vues.
9. Recherche « où regarder », service des jeux.
10. Lecture des données : `config.load()`, `usage.load()`, `meta.load()`.
11. Archives, moteur de récupération d'infos, puis `access.invalidate()` : les racines autorisées se calculeront à
    la première question.
12. Boutique, puis téléchargements. Les téléchargements reprennent (`downloads.start()`), la box de télévision est
    cherchée une fois (`tv.detectOnce()`).
13. Menu de l'application, gestionnaire du protocole `media://` (branché sur la politique d'accès).
14. Démarrage de la couche web (`webLayer.start()`) : bloqueur et connexion Google branchés sur la session
    `persist:web`, Widevine lancé.
15. Handlers IPC (`registerIpc`, avec le contexte assemblé par `mainContext`), puis ouverture de la fenêtre.

Quelques services sont créés après ceux qui les utilisent (téléchargements, moteur de récupération, vues web). Ils
sont alors passés par un accesseur (`downloads: () => downloads`), lu au moment de l'appel.

`start` rend trois points d'entrée au cycle de vie : deuxième lancement (les fichiers sont ouverts dans la fenêtre
existante), clic sur l'icône du Dock (macOS), et `beforeQuit`. Avant de quitter, les téléchargements s'arrêtent et
les écritures différées de `scrape/db.json`, `telechargements.json` et `usage.json` sont attendues deux secondes au
plus.

## Interface (renderer)

`src/renderer/index.html` charge un seul script, `dist/renderer/main.js`, construit par esbuild à partir de
`main.js` (format IIFE, sans script en ligne ni `eval`, à cause de la CSP). `main.js` importe `app.js`, qui importe
les modules.

| Dossier ou fichier | Rôle |
| --- | --- |
| `app.js` | Interface historique, en JavaScript : affichage des sections en chaînes HTML, `switch` des actions (`data-action`), boîtes de dialogue, réception des événements du processus principal. Elle sera remplacée vue par vue pendant la phase 2. |
| `core/` | Outils sans état : accès au DOM et échappement (`dom.ts`), mise en forme (`format.ts`), icônes (`icons.ts`), couleurs (`colors.ts`), adresse de lecture d'un média (`media.ts`). |
| `state/` | État partagé par toutes les vues : `S` (section, données reçues, caches, choix en cours), `Q` (file de musique), `V` (lecteur vidéo), `I` (visionneuse d'images), et `PAGE` (nombre d'éléments affichés d'abord, puis à chaque « Afficher plus »). |
| `api/` | Seul accès à `window.api` (`api`), typé par le contrat IPC. |
| `domain/` | Logique sans DOM ni état : éléments, vidéos et séries, jeux, recherche, sites, téléchargements. Les fonctions reçoivent leurs données en paramètre ; elles sont testées sous Node. |
| `nav/` | Navigation : choix du voisin à l'écran (`spatial.ts`, `pickNeighbor`), clavier et télécommande (`keyboard.ts`), manette (`gamepad.ts` et ses données `gamepad-data.ts`). |
| `players/` | Lecteurs intégrés : vidéo (`video.ts`), musique (`audio.ts`), visionneuse d'images (`images.ts`), volume commun (`volume.ts`). |
| `ui/` | `toast.ts` : message bref en bas de l'écran. |
| `styles.css`, `fonts/` | Styles (cinq thèmes, par `data-theme`) et police Archivo. |

Les modules `nav/` et `players/` ne connaissent pas l'interface : `app.js` leur passe ce qu'ils doivent faire
(retour, modifier, ouvrir le lecteur externe…) par des objets de rappels, lors de leur initialisation (`initKeyboard`,
`initVideo`…).

L'interface ne passe pas encore par les catalogues de textes : ses textes sont en français, écrits en dur. Elle ne
s'abonne pas encore au changement de langue. Les deux viendront avec la phase 2.

## `@mire/shared`

`packages/shared/` est un espace de travail npm. Il ne dépend ni de Node ni du DOM : il sert au processus
principal, aux preloads, à l'interface et aux scripts. esbuild l'intègre aux bundles.

| Point d'entrée | Contenu |
| --- | --- |
| `@mire/shared` | Fonctions pures et référentiels : texte (`fold`, noms de fichiers, épisodes), adresses (`hostOf`, `isHttpUrl`), identifiants (`newId`), formats de fichiers (`KIND`, `NATIVE`, `MIME`, `EXT`), systèmes de jeu (`guessSystem`, alias, noms) ; types de la configuration (`Config`, `WebSite`, `TvService`, `Emulator`…). |
| `@mire/shared/ipc` | Contrat IPC : tables des méthodes et des événements, leurs types, `createApi`. |
| `@mire/shared/settings/schema` | Schéma des réglages (voir `docs/settings-schema.md`). |
| `@mire/shared/i18n` | Moteur de traduction, formats, choix de la langue, catalogues intégrés `fr` et `en`, vérification des catalogues (voir `docs/i18n.md`). |

## Contrat IPC

L'interface et le processus principal ne se parlent que par le contrat décrit dans
`packages/shared/src/ipc.ts`, une seule fois pour les deux côtés :

- `IpcMethods` : signature de chaque méthode de `window.api` ; `IPC_METHODS` : méthode → canal
  (`getConfig` → `config:get`). Le renderer appelle par `ipcRenderer.invoke`, le processus principal répond par
  `ipcMain.handle` ;
- `IpcEvents` : contenu de chaque événement ; `IPC_EVENTS` : abonnement → canal (`onDownload` → `download`). Le
  processus principal envoie par `toUi(canal, contenu)` ;
- `createApi(ipcRenderer)` construit `window.api` à partir des deux tables, et seulement d'elles : la page ne peut
  appeler aucun canal de son choix. Chaque `onX(rappel)` rend une fonction de désabonnement.

Côté processus principal, `registerHandlers` vérifie au démarrage que chaque méthode a une implémentation et une
seule, puis enregistre un handler par canal. Une erreur levée dans un handler est journalisée et arrive à
l'interface sous la forme `{ ok: false, error }`. Les handlers sont rangés par domaine dans `src/main/ipc/handlers/`
et reçoivent les services par le contexte (`MainContext`).

Les vues web ont un seul canal, synchrone et hors contrat : `mire:before-page` (`web/session.ts`). Il ne répond
qu'aux pages de la session `persist:web`.

### Ajouter une méthode

1. Dans `packages/shared/src/ipc.ts` : la signature dans `IpcMethods`, puis le canal dans `IPC_METHODS`
   (`domaine:action`).
2. L'implémentation dans le fichier du domaine, `src/main/ipc/handlers/<domaine>.ts`. Si elle a besoin d'un service
   que le contexte n'a pas encore, l'ajouter à `MainContext` (`context.ts`) et à `mainContext` (`main-context.ts`),
   puis le passer depuis `src/main/index.ts`.
3. Dans `test/ipc/contract.test.ts` : la méthode et son canal dans `ADDED_METHODS`. Le test vérifie que les canaux
   d'origine n'ont pas changé.
4. Côté interface : `api.maMethode(...)`. Le type vient du contrat.

Pour un événement : `IpcEvents` et `IPC_EVENTS`, l'envoi par `toUi('canal', contenu)`, et `ADDED_EVENTS` dans le
même test. Le test vérifie aussi que chaque `toUi('…')` de `src/main/` correspond à un événement de la table.

Les noms des méthodes et des canaux d'origine sont ceux de l'ancienne interface : ne pas les renommer sans migrer
le renderer.

## Flux principaux

### Ouvrir un fichier

Un fichier arrive de quatre façons : la boîte de dialogue « Ouvrir un fichier » (`openMediaDialog`), un
glisser-déposer (le preload donne son chemin par `pathForFile`, puis `fromPaths`), la ligne de commande au
démarrage (`takePendingFiles`) ou un deuxième lancement de Mire (événement `open-files`).

Dans tous les cas, `library/item-from-path.ts` (`itemFromPath`) vérifie que c'est un fichier d'un format connu,
cherche sa pochette, et **autorise le fichier et sa pochette** dans la politique d'accès (`allowFile`). L'interface
reçoit un élément de bibliothèque et l'ouvre dans le bon lecteur.

### Lire un fichier : `media://` et la politique d'accès

L'interface lit un fichier local par l'adresse `media://local/?p=<chemin>` (`core/media.ts`) ; une adresse web est
lue directement. Le gestionnaire de `media://` (`media-protocol/index.ts`) :

1. demande à la politique d'accès si le chemin est autorisé (sinon : 403) ;
2. vérifie que c'est un fichier (sinon : 404) ;
3. sert le fichier entier, ou la plage d'octets demandée (206) pour l'avance rapide.

La politique d'accès (`security/access-policy.ts`) est la seule réponse à « l'interface peut-elle lire ou lancer ce
fichier ? ». Est autorisé :

- un fichier strictement sous une racine autorisée : dossiers de la bibliothèque, sources de jeux, dossiers des
  consoles (jeux, images, sources), et les dossiers d'images de Mire (`scrape/img`, `meta/img`, `cache/roms`) ;
- un fichier désigné par la configuration : image d'un jeu PC, bannière d'une console ;
- un fichier ouvert explicitement par l'utilisateur (voir plus haut).

Un chemin relatif, ou qui contient `..`, est refusé (`lib/paths.ts`). Sous Windows, la comparaison ignore la casse.
Racines et fichiers sont calculés une fois, puis à nouveau après chaque changement de configuration. La même
politique sert aux sous-titres, au lecteur externe et au lancement des jeux.

### Récupérer les infos : le moteur et ses fournisseurs

L'interface demande une récupération groupée (`scrapeRun`), une fiche (`scrapeOne`) ou une liste de fiches à choisir
(`scrapeCandidates`). Le moteur (`scrape/engine.ts`) :

1. choisit le fournisseur selon la nature de l'élément (`video`, `album`, `rom`, `pc`) ;
2. vérifie ce qui manque (`requires` : par exemple la clé TMDB) ;
3. pour `run`, rassemble les éléments de chaque fournisseur (`collect`), saute ceux qui sont déjà décrits ou en échec
   depuis moins de 14 jours, et lance les récupérations avec la concurrence du fournisseur ;
4. enregistre chaque fiche dans `scrape/db.json` sous la clé de l'élément ; les images sont copiées dans
   `scrape/img/`. L'interface les affiche par `media://` ;
5. annonce la progression (événement `scrape-progress`) ; « Arrêter » appelle `scrapeCancel`.

Les fournisseurs, dans l'ordre : TMDB (films et séries, clé à saisir), MusicBrainz et Cover Art Archive (albums),
libretro-thumbnails (jeux de console), Steam (jeux PC). Ils passent par `ctx.io` (client HTTP avec les délais et
messages habituels, copie d'images). La langue des fiches suit celle de l'interface, sauf si `search.language` est
fixé (`i18n/metadata.ts`).

### Télécharger un jeu, puis l'annoncer

1. Un téléchargement part d'une vue web (session `persist:web`, événement `will-download`), d'un lien magnet, de la
   page Téléchargements, de la boutique ou d'un marque-page de jeu. Le contexte du téléchargement dit la console de
   destination (`downloadContextOf` pour une vue « Ajouter des jeux »).
2. Le gestionnaire (`downloads/manager.ts`) crée une fiche, choisit le moteur (HTTP par Chromium, ou torrent), range
   le fichier dans le dossier principal de la console, et enregistre la liste dans `telechargements.json`. Chaque
   changement part à l'interface (événement `download`).
3. À la fin, `downloads/finish.ts` décompresse une archive que l'émulateur ne sait pas lire, signale un programme
   d'installation, ou fait venir les fichiers cités par l'index d'un jeu sur disque.
4. Puis `games/download-finished.ts` (`onDownloadFinished`) : un marque-page de jeu téléchargé est terminé et sa
   fiche reportée sur le jeu ; l'interface reçoit `download-finished` ; et, pour un jeu de console, l'annonce
   « jeu ajouté » (`rom-download`), une seule fois pour un jeu en plusieurs fichiers.
5. L'interface oublie la liste de jeux de la console en cache et affiche le message.

### Vues web et extensions

1. L'interface appelle `webOpen(id)`. Le registre d'entrées (`web/entries.ts`) traduit l'identifiant : un site
   enregistré (`netflix`), les sites de jeux d'une console (`rom:<console>`), un marque-page (`bm:<id>`), un portail
   TV (`tv:<id>`).
2. Une entrée en mode `browser` s'ouvre dans le navigateur du système. Sinon, le premier site attend Widevine et le
   bloqueur (dix secondes au plus pour le bloqueur), puis une `WebContentsView` est créée avec `WEB_PREFERENCES`.
   Une vue par site : on revient sur un site sans le recharger.
3. `webShow(id, rectangle)` pose la vue sur la zone que l'interface lui réserve ; `webHide` la masque et met en pause
   ses vidéos. L'état de la vue part à l'interface (événement `web-state`).
4. Les fenêtres surgissantes sont refusées : le lien est téléchargé (fichier de jeu), chargé dans la vue (même site)
   ou ignoré (`windowOpenAction`). Les liens magnet vont aux téléchargements.
5. Les extensions (`web/extensions.ts`) agissent sur toutes les vues, dans l'ordre : le bloqueur de publicités
   (`adblock.ts`), puis la connexion Google (`google-signin.ts`). L'hôte installe un seul écouteur par événement
   réseau et y appelle les extensions une à une. Il fournit aussi le script d'avant-page (par `web-preload.js`) et
   annule les navigations vers une régie publicitaire (`guardNavigation`).

### Langue

1. Le réglage est `ui.language` : `auto` (langue du système) ou un code de langue.
2. Le service de langue (`src/main/i18n/index.ts`) choisit une langue disponible (`resolveLanguage` : code exact,
   puis même langue sans région ; sinon l'anglais). Il construit le moteur avec la chaîne de repli : langue choisie,
   puis anglais, puis français.
3. Les textes du processus principal (erreurs, boîtes de dialogue, boutique) passent par `t()` de
   `src/main/i18n/current.ts`, branché sur ce service par la racine de composition. Sans service (tests), les
   textes sont en français.
4. Quand la configuration change de langue, le service prévient ses abonnés ; la racine de composition envoie
   alors `i18n:changed` (`onLanguageChange`) à l'interface, avec les catalogues à consulter. L'interface peut aussi
   les demander par `i18nGet`. Elle n'utilise encore ni l'un ni l'autre (phase 2).
5. Les fiches TMDB et Steam sont demandées dans la langue de l'interface, sauf si `search.language` est fixé.

## Interfaces d'extension

Ces interfaces existent déjà dans le code. Elles préparent les addons de la phase 3, mais aujourd'hui seuls les
fournisseurs intégrés à Mire les implémentent.

| Interface | Fichier | Ce qu'elle décrit | Implémentations |
| --- | --- | --- | --- |
| `MetadataProvider` | `src/main/scrape/types.ts` | Une source d'infos : natures décrites (`kinds`), famille (`group`), concurrence, `requires`, `key`, `collect`, `scrape`, `candidates`, `byId`. | `tmdbProvider`, `musicBrainzProvider`, `libretroProvider`, `steamProvider` (`defaultProviders`) |
| `SearchProvider` | `src/main/search/streaming.ts` | Un catalogue interrogé par la recherche : `id`, `search(query, ctx)`. | `streamingSearchProvider` (TMDB, « où regarder ») |
| `WebExtension` | `src/main/web/extensions.ts` | Ce qui s'ajoute aux vues web : `attach`/`detach`, filtres réseau (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`), `beforePageScript`, `guardNavigation`, compteurs du bouclier. | Bloqueur de publicités, connexion Google |
| `TvProvider` | `src/main/tv/types.ts` | Une façon de regarder un service de télévision, choisie par son `kind` : `channels(service, ctx)`. | `playlistProvider` (liste M3U), `webProvider` (portail dans une vue web) |
| Catalogue de langue (`Catalog`) | `packages/shared/src/i18n/types.ts` | Un fichier JSON par langue : `meta` (`code`, `name`, `app`) et `messages`. Contrat détaillé dans `docs/i18n.md`. | `locales/fr.json`, `locales/en.json` |

Autres points d'extension du même genre, plus internes :

- `EntryResolver` (`src/main/web/types.ts`) : traduit un préfixe d'identifiant de vue web (`rom:`, `bm:`, `tv:`) en
  entrée à afficher ; le registre refuse un préfixe déjà pris ;
- `SourceProvider` (`src/main/library/types.ts`) : un genre d'emplacement de la bibliothèque (`local`,
  `http-index`, `m3u`) ;
- `GameSourceProvider` (`src/main/games/types.ts`) : un genre d'emplacement de jeux PC ;
- `Downloader` (`src/main/downloads/types.ts`) : un moteur de téléchargement (HTTP, torrent) ;
- les catalogues de `src/main/config/catalogs/` (sites, services TV) et de `src/main/store/catalog/` (émulateurs,
  consoles, jeux libres) : des données seules, futur contenu d'addons.

## Sécurité

### Fenêtre principale

- `webPreferences` : `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
  (`window/main-window.ts`). L'interface n'a pas accès à Node.
- CSP de `index.html` : `script-src 'self'` (aucun script en ligne, aucun `eval`), `default-src 'self'`. Les images
  et médias peuvent venir de `media:` et du web ; `connect-src` se limite à `'self'` et `media:`. C'est pourquoi
  l'interface est un seul script construit par esbuild.
- Le preload n'expose que les méthodes et abonnements du contrat, et `pathForFile`. Aucun appel générique sur un
  canal choisi par la page (vérifié par `test/ipc/contract.test.ts`).
- La fenêtre ne navigue jamais (`will-navigate` annulé). Une nouvelle fenêtre est refusée ; une adresse web s'ouvre
  dans le navigateur du système.
- `media://` ne sert que ce qu'autorise la politique d'accès. Les commandes qui lancent un programme ou suppriment un
  jeu vérifient aussi le chemin (`isAllowed`, ou `isInside` sur les dossiers de la console).

### Vues web

- `WEB_PREFERENCES` (`web/manager.ts`) : partition `persist:web`, `contextIsolation`, `sandbox`, pas de Node. Les
  sites n'ont pas `window.api` : seul `web-preload.js` est chargé, et il n'expose rien.
- Session séparée de celle de l'interface. Permissions accordées : plein écran, écriture dans le presse-papiers,
  Widevine (`mediaKeySystem`, `protected-media-identifier`), accès au stockage. Tout le reste est refusé
  (`WEB_PERMISSIONS`, `web/session.ts`).
- Le canal `mire:before-page` ne répond qu'aux pages de la session `persist:web` ; la fenêtre principale reçoit une
  chaîne vide.
- Fenêtres surgissantes refusées (voir `windowOpenAction`).

### Ce qu'il ne faut jamais affaiblir

- `contextIsolation`, `sandbox` et `nodeIntegration: false`, pour la fenêtre comme pour les vues web ;
- la CSP `script-src 'self'` ;
- un preload qui n'expose que le contrat ;
- `media://` toujours derrière la politique d'accès, limitée aux dossiers autorisés ;
- la séparation des sessions : les sites ne partagent ni la session ni le preload de l'interface.

Piste connue : un lien symbolique placé dans un dossier autorisé est servi par `media://` (voir les pistes de
`docs/plan/BACKLOG.md`).

## Dossier de données

Mire range ses données dans le dossier `userData` d'Electron (sous Windows `%APPDATA%\Mire`, sous macOS
`~/Library/Application Support/Mire`, sous Linux `~/.config/Mire`). La variable d'environnement `MIRE_USER_DATA`
le remplace (tests de bout en bout, essais).

L'arborescence est décrite en un seul endroit : `dataPaths(dossier)` dans `src/main/storage/paths.ts`. Les modules
reçoivent le dossier de données (`dataDir`) et en tirent leurs chemins par cette fonction.

| Chemin | Contenu | Écrit par |
| --- | --- | --- |
| `config.json` | Configuration (bibliothèque, consoles, sites, TV, interface…) | service de configuration, stockage JSON |
| `config.json.illisible-<date>` | Configuration illisible mise de côté au démarrage | service de configuration |
| `usage.json` | « Reprendre », positions de reprise des vidéos, volume, recherches récentes | service des données d'usage, stockage JSON |
| `meta/meta.json` | Infos modifiées à la main (titre, année, genre, résumé, images) | `src/main/meta/user-meta.ts`, stockage JSON |
| `meta/img/` | Images choisies à la main | `src/main/meta/user-meta.ts` |
| `scrape/db.json` | Infos récupérées en ligne (films, séries, jeux) et titres introuvables | moteur de récupération (`scrape/`), stockage JSON |
| `scrape/img/` | Affiches et images de fond téléchargées | moteur de récupération (`scrape/`) |
| `scrape/cache/` | Index des jaquettes et listes de jeux par console, gardés quelques jours (cache) | moteur de récupération (`scrape/`) |
| `telechargements.json` | Liste des téléchargements (en cours, terminés, en attente) | téléchargements (`src/main/downloads/`), stockage JSON |
| `torrents/` | Fichiers `.torrent` gardés pour reprendre un torrent | moteur torrent (`src/main/downloads/torrent.ts`) |
| `emulators/` | Émulateurs installés par la boutique, un dossier chacun | boutique (`src/main/store/`) |
| `emulators/installed.json` | Version et programme de chaque émulateur installé | boutique (`src/main/store/`), stockage JSON |
| `adblock/moteur.bin` | Moteur compilé du bloqueur de publicités | `src/main/web/adblock.ts` |
| `adblock/listes.json` | Date de mise à jour et état des listes de filtres | `src/main/web/adblock.ts`, stockage JSON |
| `cache/roms/` | Jeux en ligne téléchargés pour être lancés | jeux (`src/main/games/`) |
| `bin/7za` | Copie exécutable de 7-Zip, quand l'original ne peut pas l'être (application empaquetée) | service d'archives (`src/main/archive/`) |

Le dossier `userData` contient aussi les dossiers propres à Chromium (cache, cookies, `Local Storage`…), gérés
par Electron.

## Configuration

`src/main/config/` détient la configuration (`config.json`) ; ses types (`Config`, `WebSite`, `TvService`,
`Emulator`…) sont dans `@mire/shared`.

- `defaults.ts` (`DEFAULT_CONFIG`, valeurs admises) et `catalogs/` (`DEFAULT_TV`, `DEFAULT_WEB` : données, futur
  contenu d'addons) ;
- `migrations/` : une étape par version (`v2.ts` … `v8.ts`) et leur registre ; `migrate(brut)` rend
  `{ config, from, changed }`. Nouvelle version : ajouter `vN.ts`, l'inscrire dans `MIGRATIONS`, monter
  `CONFIG_VERSION` ;
- `normalize/` : une fonction par section ; `normalizeConfig(valeur)` rend toujours une configuration complète ;
- `merge.ts` : import « compléter » ;
- `service.ts` : `createConfigService({ file })`, seul point d'accès dans le processus principal. `load()` au
  démarrage (fichier absent → valeurs par défaut écrites ; illisible → mis de côté en `config.json.illisible-<date>`) ;
  `get()` ; `update(mutateur)` et `replace(config)` normalisent, écrivent (stockage JSON, écriture immédiate) puis
  appellent chaque abonné de `onChange((suivante, précédente) => …)` une fois. Les modules reçoivent `get` (et
  `replace` pour ceux qui enregistrent) ; les handlers IPC passent par `ctx.config`.

## Données d'usage

`src/main/usage/` détient « Reprendre » (18 au plus), les positions de reprise des vidéos (gardées entre 30 s et la
fin moins 90 s, pour les vidéos de 5 min et plus), le volume (0,9 par défaut) et les recherches récentes (10 au
plus), dans `usage.json` (décision D-06). Les règles sont des fonctions pures (`rules.ts`) ; le service
(`createUsageService({ file })`) est passé aux handlers IPC par `ctx.usage` (canaux `usage:*`).

- L'interface lit `usageGet()` au démarrage et garde une copie de « Reprendre », du volume et des recherches pour
  l'affichage ; chaque modification part au processus principal. La position de reprise se demande vidéo par vidéo.
- Au premier lancement après la mise à jour, l'interface envoie ce que gardait son `localStorage` (`recent`,
  `resume:<chemin>`, `volume`, `queries`) à `usageMigrate`, puis retire ces clés.
- L'export de configuration ajoute la clé `usage` ; l'import la retire avant la migration de la configuration.
  « Remplacer » remplace les données d'usage, « compléter » les fusionne sans doublon (« Reprendre » par chemin,
  recherches par texte, position de reprise existante gardée, volume inchangé). Un fichier sans `usage` n'y touche pas.

## Stockage JSON

`createJsonStore(fichier, { defaults, debounceMs, onCorrupt, onError, space })` dans
`src/main/storage/json-store.ts` est la seule façon de lire et d'écrire un fichier de données JSON :

- **lecture tolérante** (`load()`) : fichier absent → valeurs par défaut ; fichier illisible (JSON invalide, ou
  contenu qui n'est pas un objet) → `onCorrupt(erreur, fichier)` puis valeurs par défaut. Les clés lues complètent
  les valeurs par défaut ;
- **écriture atomique** : le JSON est écrit dans `<fichier>.<pid>.tmp`, mis sur le disque (`fsync`), puis renommé
  par-dessus l'ancien. Une coupure pendant l'écriture laisse l'ancien fichier intact. Sous Windows, un renommage
  refusé un instant (antivirus, indexation) est réessayé ;
- **écriture immédiate** (sans `debounceMs`) : synchrone, une erreur remonte à l'appelant. Réservée aux petits
  fichiers dont l'appelant attend l'enregistrement ;
- **écriture différée** (`debounceMs`) : asynchrone, pour ne pas bloquer le processus principal (et donc les
  réponses à l'interface) sur un gros fichier ou un disque lent. Les modifications rapprochées donnent une seule
  écriture ; une seule écriture est en cours à la fois par fichier, et si la valeur a été modifiée pendant ce temps,
  elle est réécrite ensuite. Un échec est signalé à `onError` (journal par défaut) et n'empêche pas les suivantes ;
- **`flush()`** écrit tout de suite ce qui attend et se résout quand tout est sur le disque. À la fermeture
  (`before-quit`), `src/main/app/lifecycle.ts` suspend la sortie, attend `flush()` de `scrape/db.json`, `telechargements.json` et `usage.json`
  deux secondes au plus (`flushWithin`), puis quitte ;
- le format est celui d'avant : `JSON.stringify(valeur, null, space)`, en UTF-8, sans saut de ligne final.

| Fichier | Indentation | Écriture |
| --- | --- | --- |
| `scrape/db.json` | aucune | différée (400 ms) |
| `telechargements.json` | 1 | différée (300 ms) ; la liste est relevée au moment de l'écriture |
| `usage.json` | 1 | différée (1 s) : position de reprise toutes les 5 s, volume à chaque cran |
| `emulators/installed.json` | 2 | immédiate |
| `meta/meta.json` | 2 | immédiate |
| `adblock/listes.json` | aucune | immédiate |

Ordre de grandeur (mesuré sous Linux, SSD) : un `scrape/db.json` de 5 000 fiches pèse 3,6 Mo ; `JSON.stringify`
prend environ 13 ms (toujours sur le processus principal), l'écriture sur le disque environ 11 ms (hors du
processus principal grâce à l'écriture différée asynchrone).
