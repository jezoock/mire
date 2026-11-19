# Architecture de Mire

Ce document décrit Mire à la fin de la phase 1 de la refonte (point d'étape G2). Il est tenu à jour à chaque
changement d'architecture. L'architecture visée (plugins, éléments et tags, pages, explorateur, thèmes) est décrite
dans `docs/architecture-cible.md`. Pour installer et lancer le projet, voir la section « Développer Mire » du README.

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
| `library/` | Bibliothèque : emplacements (dossier, partage, adresse), fournisseurs de sources (`local`, `http-index`, `m3u`), analyse, sous-titres, élément d'un fichier ouvert ; sources d'éléments qui alimentent le catalogue (`element-sources.ts`). |
| `catalog/` | Catalogue d'éléments (P2-01, P2-02, P2-04) : interface `ElementSource` (`types.ts`), clés stables (`keys.ts`), stockage en mémoire et événements (`index.ts`), un fichier par emplacement de source (`persistence.ts`) ; moteur de tags et d'infos (`tags/`), modifications faites à la main (`overrides.ts`, `legacy-meta.ts`) ; pages et regroupements (`pages/`, P2-07) ; listes (`lists/`, P2-08). Voir « Catalogue d'éléments ». |
| `meta/` | Façade de l'interface historique sur les infos modifiées à la main (rangées dans `catalog/overrides.json` depuis P2-04) ; images choisies (`meta/img/`). |
| `scrape/` | Récupération d'infos et d'images : moteur (`engine.ts`) et fournisseurs (TMDB, MusicBrainz, libretro, Steam). |
| `search/` | Recherche « où regarder » (`streaming.ts`) : titres TMDB et services qui les proposent. |
| `net/` | Client HTTP unique (`http.ts` : délais, identité, erreurs) et client TMDB (`tmdb.ts`). |
| `web/` | Vues web intégrées : gestionnaire des vues, entrées (`netflix`, `rom:`, `bm:`, `tv:`), session `persist:web`, extensions (bloqueur, connexion Google), identité, raccourcis, Widevine. |
| `downloads/` | Téléchargements : gestionnaire (`manager.ts`), moteurs HTTP et torrent, fin d'un téléchargement (`finish.ts` : décompression, programme d'installation, fichiers d'un jeu sur disque). |
| `games/` | Jeux : jeux PC (dossiers, ajout manuel, lancement), jeux de console (liste, lancement, copie locale), jeux sur disque, marque-pages de jeux, nettoyage, suppression, sites « Ajouter des jeux », fin d'un téléchargement vue des jeux. |
| `store/` | Boutique : catalogue (données seules, `catalog/`), installateurs (GitHub, page de téléchargement, RetroArch), consoles créées, BIOS. |
| `tv/` | Télévision : service actif, détection de la box au premier lancement, chaînes (listes M3U), fournisseurs `playlist` et `web` ; variante d'une chaîne (qualité préférée, `pickVariant`) et `tvWatch(clé)` : l'interface ne donne que la clé de la chaîne, l'adresse vient de la liste lue par le service (P4-16). |
| `platform/` | Ce qui dépend du système : lancement de programmes (`launcher.ts`), lecteurs externes et navigateur (`players.ts`), détection (`detect.ts`). |
| `archive/` | Décompression `.zip` et `.7z` avec le 7za de `7zip-bin` (boutique, téléchargements). |
| `i18n/` | Langue de l'interface (`index.ts`), traduction des textes du processus principal (`current.ts`, fonction `t`), langue des fiches (`metadata.ts`). |
| `fs/` | Parcours générique d'une arborescence de dossiers (`walk.ts`). |
| `files/` | Gestion des fichiers (P2-10) : renommer, déplacer, mettre à la corbeille sous les dossiers locaux de la configuration (`service.ts`, `guard.ts`, `roots.ts`) ; le catalogue suit (`follow.ts`). |
| `plugins/` | Hôte de plugins (P3-03) : découverte et vérification, état, journal par plugin, registre des contributions, tags automatiques des plugins, canal et runtime d'un plugin, hôte isolé (page et Worker dans `host/`, construits à part dans `dist/plugin-host/`), plugins sensibles dans ce processus, protocole `mire-plugin://`. Voir « Hôte de plugins ». |
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
2. Services de configuration et d'usage, catalogue d'éléments et modifications faites à la main (créés, pas encore
   lus).
3. Politique d'accès. Un abonné à `config.onChange` la remet à zéro et met à jour les sites ouverts.
4. Fenêtre principale (créée, pas encore ouverte) ; elle fournit `toUi`, qui envoie un événement à l'interface.
5. Bibliothèque, boîtes de dialogue, infos modifiées à la main, télévision.
6. Lanceur de programmes et lecteurs externes.
7. Service de langue, branché sur `toUi('i18n:changed')` et sur la fonction `t` du processus principal
   (`useLanguage`).
8. Couche web (`createWebLayer`) : Widevine et gestionnaire des vues.
9. Recherche « où regarder », service des jeux.
10. Lecture des données : `config.load()`, `usage.load()`, `catalog.load()`, puis `overrides.load()` (après le
    catalogue : reprise de `meta/meta.json` au premier démarrage), et création du moteur de tags (calcul de tous les
    éléments, abonné aux changements du catalogue et de `catalog.fileTags`).
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
les écritures différées de `catalog/metadata.json`, `telechargements.json`, `usage.json`, du catalogue et de
`catalog/overrides.json` sont attendues
deux secondes au plus.

## Interface (renderer)

`src/renderer/index.html` charge le script de l'interface, `dist/renderer/main.js`, construit par esbuild à partir
de `main.js` (format IIFE, sans script en ligne ni `eval`, à cause de la CSP). La page ne contient que `<mire-app>`, la
coquille (P4-07) : `main.js` définit les composants `mire-*` de `@mire/ui`, attend le rendu de la coquille (menu,
en-tête, hôtes des vues historiques), puis importe `app.js`, qui importe les modules. La page charge aussi, en module, le chargeur des
composants `ds-*` de dot-stash (`vendor/dot-stash/`), et la feuille de `@mire/ui` (`ui/mire-ui.css`) : voir
`docs/adr/0001-dot-stash.md`.

| Dossier ou fichier | Rôle |
| --- | --- |
| `app.js` | Interface historique, en JavaScript : affichage des sections en chaînes HTML, boîtes de dialogue, réception des événements du processus principal. Ses `data-action` appellent les contrôleurs par le pont. Elle sera remplacée vue par vue pendant la phase 4. |
| `shell/` | Coquille (P4-07), côté page : montage de `<mire-app>` et des vues historiques (`mire-legacy-view`), entrées du menu (écrans du cœur et pages épinglées, `menu.ts`), en-tête, aide de la manette, et routeur par état (cible de `@mire/shared` et chemin dans les regroupements, `router.ts`) ; une page s'affiche dans la vue de page (section `page`, P4-11), un écran du cœur sans vue à lui dans la vue historique qui en tient lieu. |
| `pages/` | Vue de page (P4-11) : l'hôte `<mire-page>` et sa `mire-page-view`, remplis d'après la route (page et chemin) ; niveaux chargés par tranches (`catalog.page`), regroupements (« Autres », « Saison 1 »), chemin parcouru, rangées (`model.ts`, sans DOM). |
| `explorer/` | Explorateur (P4-08) : l'hôte `<mire-explorer>` et sa `mire-explorer-view` ; colonnes Pages, Listes et Tags, puis les niveaux de `catalog.page` (page, `list:<id>`, `tag:<id>`) par tranches, et l'aperçu d'un élément (`model.ts`, sans DOM). Une ligne qui reçoit le focus montre ce qu'elle ouvre ; B revient à la colonne précédente. Affichage fixe : habillage du cœur, jamais le thème. |
| `home/` | Accueil (P4-12) : l'hôte `<mire-home>` et sa `mire-home-view`, remplis d'après `ui.home` (rangées : barres de la mire vers des cibles, sites épinglés, « Reprendre », pages et listes ; `model.ts`, sans DOM) ; réglages de l'accueil (rangées, barres, sites, ordre ; `settings.ts`, sans DOM). |
| `centre/` | Centre (P4-18) : l'hôte `<mire-centre>` et sa `mire-centre-view` (onglets Téléchargements et Apps) ; lignes des téléchargements, mises à jour fines (`mire-download-row` : une ligne qui avance ne redessine qu'elle), cartes des émulateurs, consoles de RetroArch, rappels de BIOS, jeux libres, avancement des installations et annonces (« jeu ajouté »), rédigés par les catalogues (`centre.*`) à partir des données du processus principal (`model.ts`, sans DOM). |
| `themes/` | Moteur de thèmes (P4-11) et thèmes intégrés (`<id>/theme.json` et leurs fichiers) : palette, polices et fond posés sur `<mire-page>` et `<mire-home>` (portée commune, P4-12), mise en page transmise à la vue de page et à l'accueil. Voir `docs/themes.md`. |
| `controllers/` | Contrôleurs (P4-04) : un par écran (`mire-app`, `mire-page`…), dont les méthodes publiques sont les actions de Mire, appelées par `ds-trigger`, par la navigation et les lecteurs ; registre et pont des `data-action` historiques (`bridge.ts`). Voir `docs/adr/0001-dot-stash.md` § 8. |
| `i18n/` | Traduction de l'interface : catalogues reçus du processus principal, `t()`, langue courante, `lang` du document. |
| `core/` | Outils sans état : accès au DOM et échappement (`dom.ts`), mise en forme (`format.ts`), icônes (`icons.ts`), couleurs (`colors.ts`), adresse de lecture d'un média (`media.ts`). |
| `state/` | État partagé par toutes les vues : `S` (section, données reçues, caches, choix en cours), `Q` (file de musique), `V` (lecteur vidéo), `I` (visionneuse d'images), et `PAGE` (nombre d'éléments affichés d'abord, puis à chaque « Afficher plus »). |
| `api/` | Seul accès à `window.api` (`api`), typé par le contrat IPC. |
| `domain/` | Logique sans DOM ni état : éléments, vidéos et séries, jeux, recherche, sites, états des téléchargements. Les fonctions reçoivent leurs données en paramètre ; elles sont testées sous Node. |
| `nav/` | Navigation : choix du voisin à l'écran (`spatial.ts`, `pickNeighbor`), service de focus sur les vues historiques et les composants `ds-*` / `mire-*` (`focus.ts`, règles sans DOM dans `targets.ts`, P4-03 ; voir l'ADR 0001, § 10), clavier et télécommande (`keyboard.ts`), manette (`gamepad.ts` et ses données `gamepad-data.ts`). |
| `players/` | Lecteurs intégrés : vidéo (`video.ts`), musique (`audio.ts`), visionneuse d'images (`images.ts`), volume commun (`volume.ts`). |
| `ui/` | `toast.ts` : message bref en bas de l'écran. |
| `demo/` | Page de démonstration interne des composants, cachée (adresse `#demo`). |
| `styles.css`, `fonts/` | Styles de l'interface historique et police Archivo. |
| `palettes/` | Palettes du cœur : jetons de couleurs (`<id>/<id>.css`) et métadonnées (`palette.json`), choisies par `data-palette` sur `<html>` (voir `docs/themes.md`). |

Les modules `nav/` et `players/` ne connaissent pas l'interface : ils reçoivent les contrôleurs à leur
initialisation (`initKeyboard`, `initVideo`…) et appellent leurs méthodes (retour, modifier, ouvrir le lecteur
externe…) ; `app.js` ne leur fournit plus que ce qu'ils doivent savoir de l'affichage (boîte de dialogue ouverte,
lecteur ouvert).

Le service de traduction (`i18n/`) reçoit les catalogues au démarrage et suit les changements de langue ; la langue
de l'interface est sur `<html lang>`. Les vues historiques restent en français, écrites en dur et marquées
`lang="fr"`, jusqu'à leur remplacement.

## `@mire/shared`

`packages/shared/` est un espace de travail npm. Il ne dépend ni de Node ni du DOM : il sert au processus
principal, aux preloads, à l'interface et aux scripts. esbuild l'intègre aux bundles.

| Point d'entrée | Contenu |
| --- | --- |
| `@mire/shared` | Fonctions pures et référentiels : texte (`fold`, noms de fichiers, épisodes), adresses (`hostOf`, `isHttpUrl`), identifiants (`newId`), formats de fichiers (`KIND`, `NATIVE`, `MIME`, `EXT`), systèmes de jeu (`guessSystem`, alias, noms) ; types de la configuration (`Config`, `WebSite`, `TvService`, `Emulator`…). |
| `@mire/shared` (`element.ts`) | Types du catalogue d'éléments, réexportés de `@mire/plugin-sdk` (P3-01) : `Element`, `ElementKey`, `ElementSourceRef`, `OpenSpec` (fichier, site, jeu, programme, flux), `InfoValue`, `ValueOrigin` (origine d'un tag ou d'une info : `file`, `source`, `tagger`, `metadata`, `user`). |
| `@mire/shared` (`targets.ts`) | Cibles (P2-12), réexportées de `@mire/plugin-sdk` (P3-01) : ce qu'une rangée de l'accueil, puis un plugin ou un thème, peut ouvrir, écrit en un texte : une page par son identifiant (`movies` ; un identifiant de page n'a jamais de `:`, `PAGE_ID_RE`), une liste par `list:<id>` (`LIST_PAGE_PREFIX`, comme `catalogPage`), un écran du cœur par `screen:<nom>` (`CORE_SCREENS`, liste fermée : `home`, `search`, `center`, `settings`, `explorer` ; ni la coquille ni les lecteurs). `parseTarget` lit (`null` si invalide), `isTarget` reconnaît, `formatTarget` écrit (lève `RangeError` pour une cible invalide). La normalisation de la configuration retire des rangées de l'accueil une cible invalide. |
| `@mire/shared/ipc` | Contrat IPC : tables des méthodes et des événements, leurs types, `createApi`. |
| `@mire/shared/settings/schema` | Schéma des réglages (voir `docs/settings-schema.md`). |
| `@mire/shared/i18n` | Moteur de traduction, formats, choix de la langue, catalogues intégrés `fr` et `en`, vérification des catalogues (voir `docs/i18n.md`). |

## `@mire/ui`

`packages/ui/` : les composants `mire-*` (Stencil, light DOM), construits dans `packages/ui/dist/components/` puis
intégrés au script de l'interface, et la feuille de style compilée avec le moteur SCSS de dot-stash
(`src/styles/index.scss`). Ses fonctions sans DOM (`@mire/ui/utils`) sont testées sous Node. Décisions et
conventions : `docs/adr/0001-dot-stash.md`.

## `@mire/plugin-sdk`

`packages/plugin-sdk/` (P3-01) : le contrat public des plugins, sans aucune dépendance. Mode d'emploi pour les auteurs
de plugins : `packages/plugin-sdk/README.md`.

- **Types** (`src/`) : éléments (`element.ts`) et cibles (`targets.ts`), que `@mire/shared` réexporte sans les
  recopier (un test le garde, `test/plugin-sdk/shared.test.ts`) ; interfaces des contributions de code
  (`contributions.ts` : `ElementSource`, `Tagger`, `InfoDeclaration`, `MetadataProvider`, `SearchProvider`,
  `WebExtension`, `Downloader`), que les interfaces internes de `src/main/` reprennent, génériques quand le cœur
  leur prête un contexte plus riche ; contexte d'un plugin de code (`context.ts` : `http`, `files`, `storage`,
  `settings`, `log`, `events`, types seulement) ; manifeste (`manifest.ts` : champs, niveaux, contributions et
  permissions, listes fermées).
- **Manifeste** : `schema/mire-plugin.schema.json` (schéma JSON) et `validate.ts` (validateur écrit à la main,
  `validateManifest`), gardés d'accord par `test/plugin-sdk/schema.test.ts`. `validate-dir.ts` vérifie un dossier
  (fichiers déclarés, textes anglais, et français avec `official`).
- **Valider un plugin** : `node packages/plugin-sdk/src/cli.ts validate <dossier> [--official]` dans Mire,
  `npx mire-plugin validate <dossier>` une fois l'archive installée. `--official` : validation pour le dépôt
  officiel (préfixe `mire.` permis, textes français obligatoires).
- **Sources et archive** : dans Mire, `@mire/plugin-sdk` désigne ses sources par la condition d'export `mire-source`
  (`customConditions` de `tsconfig.base.json`, `conditions` d'esbuild) ; `@mire/shared` l'importe par chemin relatif
  (aucune condition à prévoir pour Stencil). `npm pack -w @mire/plugin-sdk` construit `dist/` (`tsconfig.build.json` :
  JavaScript et déclarations) et produit l'archive ; `test/plugin-sdk/pack.test.ts` l'installe dans un dossier vide,
  en compile les types et lance l'outil.

## Hôte de plugins

`src/main/plugins/` (P3-03, ADR `docs/adr/0002-hote-isole.md`). Le service (`service.ts`) est créé par la racine de
composition après la recherche ; `start()` est lancé après l'ouverture de la fenêtre. Sans plugin, rien n'est créé :
ni dossier, ni fichier, ni hôte.

- **Plugins inclus** (P3-05) : leurs sources sont dans `plugins/<id>/` à la racine du dépôt ; `npm run build` les copie
  dans `resources/plugins/` (non versionné), que l'hôte lit en développement et qu'electron-builder emporte dans
  l'installateur (`extraResources` de `package.json`, lu une fois installé dans `process.resourcesPath/plugins`).
  `test/plugins/bundled-sources.test.ts` les valide (plugin officiel, compatible, textes en français et en anglais).
  Un plugin inclus est **installé au premier lancement** (et à chaque nouvelle version livrée avec Mire) : sa version
  est notée dans l'état (`bundled`), son journal le dit ; il est actif, sauf si l'utilisateur l'avait désactivé. Il
  se désactive comme les autres mais ne se désinstalle pas ; une version plus haute installée dans
  `userData/plugins/` (mise à jour par le dépôt, P3-07) passe devant, et sa désinstallation lui rend la place.
  Aujourd'hui, un seul : `mire.exemple.inclus`, un plugin de données neutre (un pack vide : ni chaîne, ni site, ni
  jeu), qui ne change rien de visible ; la phase 5 le remplacera par les vrais plugins inclus.
- **Dépendances** (D-19, `dependencies.ts`, plages de `semver.ts`) : au démarrage, un plugin dont une dépendance
  manque, n'est pas dans une version qui convient, est refusée ou forme un cycle est refusé
  (`plugins.refused.dependency`, `dependency-refused`, `cycle`), de proche en proche ; les autres sont activés dans
  l'ordre (dépendances d'abord). Un plugin dont une dépendance est désactivée (ou en panne) s'arrête avec elle, reste
  voulu actif et revient avec elle (`plugins.waiting`). `resolveInstall` choisit les versions à installer avec un
  plugin (la version installée si elle convient, sinon la plus haute qui convient à toutes les demandes ; conflit,
  dépendance introuvable, cycle) dans l'ordre d'installation : le client des dépôts (P3-07) s'en servira.
- **Désinstallation** (`service.uninstall(id, { keepData })`, sans écran ni IPC : le Centre viendra avec P4-18) :
  refusée si un plugin présent en a besoin (`plugins.uninstall.needed`, en le nommant) ou si le plugin est livré avec
  Mire (`plugins.uninstall.bundled`). Sinon : arrêt, `userData/plugins/<id>/` effacé, `userData/plugin-data/<id>/`
  gardé ou effacé (stockage écrit puis fermé d'abord), état oublié (sauf si la version incluse reprend la place).

- **Découverte** (`discovery.ts`) : plugins inclus `resources/plugins/<id>/` (`process.resourcesPath` une fois
  empaqueté ; le dossier est construit par P3-05) et installés `userData/plugins/<id>/<version>/` (la version la plus
  haute ; à version égale, l'inclus). Le dossier d'un plugin et chaque fichier qu'il contient doivent rester sous leur
  racine une fois les liens symboliques résolus ; au plus 5 000 fichiers sur 16 niveaux.
- **Vérification** : `validatePluginDir` du SDK (`official` pour un plugin inclus), identifiant et version d'accord
  avec le dossier, `engines.mire` (`satisfies` de `semver.ts`, écrit à la main : `^`, `~`, comparateurs, `1.x`, `*`,
  `||`, pré-publications à la manière de npm) contre `app.getVersion()`. Le niveau est vérifié d'après le contenu :
  un plugin `data` ne contient aucun fichier de code (`.js`, `.mjs`, `.cjs`, `.wasm`, `.node`) ; un plugin `code` ou
  `privileged` a au moins une contribution de code. Un plugin `privileged` installé est refusé : seuls les plugins
  inclus tournent dans le processus principal tant que la signature et la confiance des dépôts n'existent pas
  (P3-07, P3-08). Textes (`i18n`, langues de Mire) et fichiers JSON des contributions de données (2 Mo au plus)
  sont lus par le cœur. Un plugin refusé reste dans la liste, avec la raison (`plugins.refused.<code>`).
- **Exécution** : `data`, rien ne s'exécute ; `code`, un Worker par plugin dans l'hôte isolé (`host.ts`), démarré à la
  première demande et arrêté quand il n'a plus de plugin ; `privileged`, le runtime dans le processus principal
  (`in-process.ts`), relié au cœur par une paire de ports : même canal, même API. Le runtime (`runtime.ts`) charge
  l'export par défaut de chaque `main` (une `ContributionFactory`), vérifie l'identifiant de la contribution rendue,
  répond à `runtime.ping`, `runtime.load`, `runtime.computeBatch` et aux méthodes des contributions
  (`<nature>/<id>`), et passe son propre contexte aux méthodes du SDK qui en reçoivent un.
- **Canal** (`channel.ts`) : requête, réponse, événement, annulation ; délai par requête (5 s) ; `host-gone` pour
  toutes les requêtes en attente quand l'autre côté disparaît ; méthodes refusées (`_…`, `constructor`, noms
  d'`Object.prototype`, propriétés qui ne sont pas des fonctions). Codes stables : `timeout`, `cancelled`,
  `not-found`, `plugin-error`, `host-gone`, `not-available`.
- **Contexte** (P3-04) : `log` (journal du plugin) et `events.on` (événements de Mire : `language`) restent dans le
  runtime ; `settings.get` lit les réglages reçus au chargement, tenus à jour par l'événement `settings`
  (`onChange`) ; `http`, `files` et `storage` sont relayés au processus principal (cible `ctx`, méthode
  `http.request`, `files.walk`…), par **le port du plugin** : `context.ts` y applique les permissions du plugin
  auquel ce port est attribué, jamais d'après un champ du message. Voir « Contexte et permissions des plugins ».
- **Pannes** : une exception (requête, lot, ou erreur non rattrapée du Worker), une requête sans réponse dans son
  délai, un chien de garde sans réponse (ping toutes les 250 ms, délai 1 s) ou un hôte planté (le plugin qui avait une
  requête en cours ; les autres plugins de l'hôte redémarrent) : le plugin est désactivé, son Worker arrêté, l'erreur
  gardée dans son état avec un message des catalogues (`plugins.faults.<code>`), et écrite dans son journal.
- **Activation** (`setEnabled`, IPC `pluginsSetEnabled`) : à chaud pour toutes les natures, sauf `webExtensions` et
  `downloaders` (branchées au démarrage : `restartRequired`). L'état est mémorisé dans `userData/plugins/state.json`
  (un plugin absent de l'état est actif). Désactiver un plugin `privileged` coupe ses ports, son code reste chargé
  jusqu'au redémarrage.
- **Branchements** (`registry.ts`) : tags et infos déclarés (`tags`, `infos` des contributions) au registre du
  catalogue (`declarePlugin`, `removePlugin`), qui prévient la recherche (elle oublie ce qu'elle savait des infos) ;
  textes au moteur de traduction sous `pluginTexts.<id, points remplacés par _>` (`setPluginTexts`, l'interface reçoit
  les catalogues à jour) ; tags automatiques (`taggers.ts`) au moteur de tags : le moteur appelle ses contributions de
  façon synchrone, le pont rend le dernier résultat connu de chaque élément et calcule les éléments nouveaux ou changés
  par lots de 500 dans l'hôte, puis fait recalculer ces éléments ; seuls les tags et infos déclarés par la
  contribution sont gardés, au type déclaré. `sources`, `metadata` et `search` sont branchées par `bridges.ts`
  (P3-04) : chaque source active est analysée à son activation (emplacement `null` en attendant les réglages de
  P4-20) et ses éléments vont au catalogue sous `{ plugin: <id>, instance: <contribution> }`, puis le quittent à sa
  désactivation ; les fournisseurs d'infos en ligne s'ajoutent après les quatre du cœur (`extraProviders` du moteur) ;
  `pluginBridges.search(query)` interroge les fournisseurs de recherche (l'écran Recherche, P4-12, les affichera).
  Ce qu'un plugin rend y est vérifié d'après son niveau : un plugin de code limité ne fournit ni programme ni jeu à
  lancer, ni fichier local hors de ses dossiers accordés, et ses clés sont préfixées par `plugin:<id>|` ; une fiche
  porte la source du plugin, une image seulement en `http(s)`. `webExtensions` et `downloaders` (P3-05) : code sensible,
  seulement d'un plugin `privileged` inclus, qui tourne dans le processus principal. Leur interface reçoit la session
  des vues web et est appelée de façon synchrone à chaque requête : le runtime en processus principal les rend au cœur
  par référence (`local`, `service.local(kind)`), au lieu de messages. Elles sont branchées une fois, après
  `plugins.start()` : extensions ajoutées après le bloqueur et la connexion Google (`webLayer.addExtensions`,
  `createWebExtensions().add`, écouteurs `webRequest` recomposés), moteurs ajoutés au gestionnaire de téléchargements
  (`downloads.addEngines` : chacun reçoit le gestionnaire par `attach(host)` du SDK, ses fiches portent la nature
  `plugin:<plugin>/<moteur>` ; il prend les marque-pages et `downloads.add` des liens qu'il sait prendre, avant HTTP ;
  une fiche dont le moteur n'est plus là ne fait rien, `plugins.engineMissing`). Les changer demande de redémarrer
  Mire (`restartRequired`). Les contributions de données (pages, thèmes, palettes, langues, manettes, apps, consoles,
  packs, sites) sont exposées au registre par nature avec le contenu de leur fichier JSON : leur lecteur viendra avec
  leur tâche.
- **IPC** : `pluginsList()` (canal `plugins:list`) et `pluginsSetEnabled(id, enabled)` (`plugins:setEnabled`)
  rendent des `PluginSummary` (identifiant, version, origine, niveau, nom, état, message, contributions).

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
4. enregistre chaque fiche sous la clé du fournisseur (`v:<chemin>`, `a:<dossier>`…) dans la base des infos en ligne
   du catalogue (`catalog/metadata.json`, voir « Tags et infos » ; `ScrapeStore`) ; les images sont copiées dans
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
   ses vidéos. L'état de la vue part à l'interface (événement `web-state`) : titre, navigation, bloqueur, et le genre
   (`kind` : `site`, `rom`, `bookmark`, `tv`), le nom et la couleur de la vue, tirés de l'entrée résolue (couleur
   contrôlée : `#rrggbb` ou la couleur neutre). Une adresse donnée par l'interface (`webOpen`) n'est chargée que si
   c'est une adresse http(s) ; le rectangle est arrondi et jamais négatif (`roundRect`).
4. Côté interface (P4-16), `src/renderer/web/` place l'hôte `<mire-web>` (contrôleur `mire-web`), la barre du site
   (`mire-webbar`, rédigée d'après `web-state` sans relire la configuration) et la place de la vue native
   (`mire-web-slot`) : son `ResizeObserver` donne la zone réservée, moins le menu automatique déplié par-dessus
   (`slotBounds`), transmise par `webShow` et `webBounds`.
5. Les fenêtres surgissantes sont refusées : le lien est téléchargé (fichier de jeu), chargé dans la vue (même site)
   ou ignoré (`windowOpenAction`). Les liens magnet vont aux téléchargements.
6. Les extensions (`web/extensions.ts`) agissent sur toutes les vues, dans l'ordre : le bloqueur de publicités
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

Ces interfaces existent déjà dans le code. Depuis P3-01, leurs types publics sont dans `@mire/plugin-sdk` (contributions
des plugins) et les fichiers ci-dessous les reprennent ; aujourd'hui seuls les fournisseurs intégrés à Mire les
implémentent.

| Interface | Fichier | Ce qu'elle décrit | Implémentations |
| --- | --- | --- | --- |
| `MetadataProvider` | `src/main/scrape/types.ts` | Une source d'infos : natures décrites (`kinds`), famille (`group`), concurrence, `requires`, `key`, `collect`, `scrape`, `candidates`, `byId`. | `tmdbProvider`, `musicBrainzProvider`, `libretroProvider`, `steamProvider` (`defaultProviders`) |
| `SearchProvider` | `src/main/search/streaming.ts` | Un catalogue interrogé par la recherche : `id`, `search(query, ctx)`. | `streamingSearchProvider` (TMDB, « où regarder ») |
| `WebExtension` | `src/main/web/extensions.ts` | Ce qui s'ajoute aux vues web : `attach`/`detach`, filtres réseau (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`), `beforePageScript`, `guardNavigation`, compteurs du bouclier. | Bloqueur de publicités, connexion Google |
| `ElementSource` | `src/main/catalog/types.ts` | Une source d'éléments du catalogue : `id` (celui du plugin prévu), `tags` de source, `handles(emplacement)`, `instance(emplacement)`, `scan(emplacement)` → éléments. | `src-local`, `src-smb`, `src-http`, `src-m3u` (`src/main/library/element-sources.ts`) ; `jeux-roms`, `jeux-pc`, `jeux-pc-manuel`, `jeux-marque` (`src/main/games/element-sources.ts`) ; `tv-m3u`, `tv-web` (`src/main/tv/element-sources.ts`) ; `svc-<id>`, `web-perso`, `web-bm` (`src/main/web/element-sources.ts`) |
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
  l'interface est un seul script construit par esbuild, plus le chargeur de dot-stash, chargé comme module depuis les
  fichiers de la page.
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

### Hôte de plugins (`mire-plugin://`)

Changement de sécurité de P3-03 (ADR 0002). **Ajout au démarrage** : `mire-plugin` est enregistré comme schéma
privilégié avant `ready` (`standard`, `secure`, `supportFetchAPI`, `corsEnabled` ; ni `bypassCSP`, ni `stream`, ni
service workers), dans le même appel que `media` (Electron n'en accepte qu'un ; `media://` ne change pas). Le
gestionnaire n'est installé **que sur la session de l'hôte isolé**, jamais sur celle de la fenêtre principale ni sur
`persist:web` : ailleurs, une adresse `mire-plugin://` ne mène à rien.

- **Session** : `mire-plugins-<groupe>`, en mémoire (sans `persist:`). `webRequest` annule toute requête qui n'est pas
  `mire-plugin:` ; permissions, appareils et téléchargements refusés.
- **Page** : `BrowserWindow` cachée, `sandbox`, `contextIsolation`, sans Node (ni dans les Workers ni dans les
  cadres), sans `<webview>` ; fenêtres refusées, navigation et redirections annulées, WebRTC sans UDP
  (`disable_non_proxied_udp`). CSP de la page et des Workers : `default-src 'none'; script-src mire-plugin:;
  worker-src mire-plugin:; connect-src mire-plugin:; base-uri 'none'; form-action 'none'`. Son preload n'expose rien
  et ne reçoit qu'un message IPC, une fois : le port de contrôle.
- **Protocole** (`protocol.ts`) : `GET` seulement ; `mire-plugin://host/` ne sert que `index.html`, `page.js` et
  `worker.js` de `dist/plugin-host/` ; `mire-plugin://<id>/` ne sert que les plugins de cet hôte, chemin décodé refusé
  s'il contient `..`, `\` ou un octet nul, chemin réel (liens résolus) refusé hors du dossier du plugin.
- **Workers** : un par plugin, avec un port à lui ; le processus principal reconnaît le plugin par ce port, jamais
  par un champ du message. Liste de retrait avant tout code de plugin (`host/worker.ts`) : `WebTransport`, `Worker`,
  `SharedWorker`, et ce que les Workers d'un même hôte partagent par leur origine commune (`BroadcastChannel`,
  `indexedDB`, `caches`, `navigator.locks`, `navigator.storage`). À revérifier à chaque montée d'Electron avec
  `spikes/hote-isole/main.mjs`.
- **Limites** : un plugin peut lire les fichiers d'un autre plugin du même hôte (`fetch` de `mire-plugin://<autre>/`) :
  du code public, sans secret ; la sandbox du système n'est éprouvée que sur une vraie machine (ADR 0002). Un plugin
  `privileged` (inclus seulement) tourne avec Node dans le processus principal : ce n'est pas un isolement.

### Contexte et permissions des plugins

P3-04, ADR 0002 (« Pour P3-04 »). Le plugin ne fait rien lui-même : tout passe par `ctx`, relayé par son port, et
s'applique dans le processus principal (`src/main/plugins/context.ts`, `permissions.ts`) d'après le plugin auquel le
port est attribué. Aucune vérification n'est laissée à l'hôte.

- **Niveau** : `grantedPermissions` ne donne une permission sensible (`localNetwork`, `launch`, `webViews`,
  `deleteFiles`) qu'au niveau `privileged`, même à un manifeste qui aurait échappé à la vérification (qui la refuse
  déjà) ; un plugin `data` n'a rien.
- **`http`** : client du cœur (`net/http.ts`, identité de Mire, ni cookie ni hôte forcé). Seuls `http:` et `https:`,
  sans nom d'utilisateur ; hôte exact ou sous-domaine d'une entrée `*.domaine` (pas le domaine lui-même) ; adresses
  IP, noms et adresses du réseau local refusés sans `localNetwork`. Les redirections sont suivies à la main (5 au
  plus), chacune vérifiée de même. `set-cookie` n'est pas rendu.
- **`files`** : demande `folders`. `requestFolder` ouvre la boîte du système, titrée du nom du plugin ; le dossier
  choisi est mémorisé pour ce plugin dans `plugins/state.json`. Chaque chemin est vérifié par une politique d'accès
  propre au plugin (`createAccessPolicy` sur ses seuls dossiers : celle de l'interface n'est jamais élargie), puis une
  seconde fois une fois les liens résolus. `walk` parcourt dans le processus principal sans suivre les liens.
- **`storage`** : `userData/plugin-data/<id>/storage.json`, écriture atomique et différée (`json-store.ts`), écrite à
  la fermeture ; 1 000 clés, 8 Mio en tout.
- **`settings`** : `plugins.<id>` de la configuration, d'après le `settings` du manifeste (`settings.ts`). Un réglage
  `secret` est rangé `{ "$secret", "encrypted" }`, chiffré par `safeStorage` quand le système le permet ; il n'est
  jamais rendu à l'interface (`getConfig`, `saveConfig`), ni exporté, ni effacé par un import, ni écrit dans un
  journal ou un message d'erreur. L'interface ne peut pas écrire `plugins` (ce qu'elle renvoie est ignoré).
  `service.setSetting` change un réglage (pour P4-20).
- **Bornes** (`LIMITS`) : requête du plugin 1 Mio (en JSON) ; corps HTTP ou fichier relayé 8 Mio ; 8 requêtes du
  contexte en cours par plugin, 64 en attente, au-delà `busy` ; délai HTTP 15 s (60 s au plus) ; `walk` 10 000
  fichiers (50 000 au plus). Côté ponts (`BRIDGE_LIMITS`) : 50 000 éléments par analyse, résultat de recherche 1 Mio.
- **Codes d'erreur** rendus au plugin : `refused`, `too-large`, `busy`, `http-error`, `io-error` (en plus de ceux du
  canal).
- **Résolution** : avant chaque requête et chaque redirection, le nom est résolu (`dns.lookup`, toutes les adresses) ;
  sans `localNetwork`, la requête est refusée si l'une d'elles est locale (IPv4, IPv6 ou IPv4 dans IPv6), pour qu'un
  hôte déclaré ne puisse pas pointer vers le routeur ou un service de la machine. **Risque qui reste** : un changement
  d'adresse entre cette résolution et la connexion (nom à TTL nul) ; le fermer demanderait de fixer l'adresse résolue
  pour la connexion, piste pour P3-08.

### Ce qu'il ne faut jamais affaiblir

- `contextIsolation`, `sandbox` et `nodeIntegration: false`, pour la fenêtre comme pour les vues web ;
- la CSP `script-src 'self'` ;
- un preload qui n'expose que le contrat ;
- `media://` toujours derrière la politique d'accès, limitée aux dossiers autorisés ;
- la séparation des sessions : les sites ne partagent ni la session ni le preload de l'interface ;
- l'hôte des plugins : `mire-plugin://` seulement sur ses sessions, réseau refusé, un Worker et un port par plugin,
  liste de retrait, plugins `privileged` réservés aux plugins inclus ; `webExtensions` et `downloaders` rendus par
  référence seulement pour un plugin `privileged` inclus (`service.local`).

### Gestion des fichiers

Le service `files/` (P2-10, IPC `filesRename(path, name)`, `filesMove(path, folder)`, `filesRemove(path)`) ne croit
jamais l'interface sur parole. Il n'agit que sous les dossiers **locaux** de la configuration (`managedRoots` :
bibliothèque, dossiers de jeux, dossiers des consoles), jamais sur un fichier autorisé un par un ou ouvert à part,
ni dans les dossiers de données de Mire, ni sur un partage réseau ou un serveur web. Sont refusés : un chemin
relatif, avec `..` ou hors de ces dossiers ; un lien symbolique (le fichier ou un dossier parent) dont le chemin réel
(`realpath`, comparé aux chemins réels des dossiers) en sort ; un dossier configuré lui-même et la racine d'un disque
(une racine de disque configurée est ignorée) ; une destination hors des dossiers, absente ou qui n'est pas un
dossier ; un nom déjà pris (rien n'est écrasé) ; un nouveau nom vide, `.`, `..` ou avec un séparateur. La
suppression passe par la corbeille du système (`shell.trashItem`). La confirmation est demandée par l'interface
(P4-09). Le catalogue suit (`files/follow.ts`, `catalogFollow`, clés recalculées par `movedKey`) :

| Après… | Suit le nouveau chemin | Ne bouge pas |
| --- | --- | --- |
| un renommage ou un déplacement (fichier, ou tout ce que contient un dossier) | modifications faites à la main (`overrides.json`), infos en ligne (`metadata.json`), listes (`lists.json`), positions de reprise et entrées de « Reprendre » (`usage.json` : chemin et clé ; nom et images gardés) ; l'élément revient sous sa nouvelle clé à l'analyse suivante | recherches récentes (des textes), adresses web et entrées M3U |
| une mise à la corbeille | l'élément quitte le catalogue | tout le reste : modifications, infos en ligne, positions de reprise et « Reprendre » sont gardés (un fichier remis de la corbeille retrouve tout) ; une liste garde l'élément, indisponible |

Détail : voir « Listes » et « Tags et infos » (`movePath`).

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
| `catalog/overrides.json.illisible-<date>`, de même `metadata.json`, `pages.json`, `lists.json` | Fichier du catalogue illisible mis de côté à la lecture, signalé dans le journal (P2-12) : il n'est jamais écrasé ; un `overrides.json` ou `metadata.json` vide le remplace aussitôt, pour que l'ancien `meta.json` ou `db.json` ne soit pas repris | stockage JSON (`setAside`) |
| `usage.json` | « Reprendre », positions de reprise des vidéos (par clé d'élément depuis P2-11), volume, recherches récentes | service des données d'usage, stockage JSON |
| `catalog/sources/<plugin>--<emplacement>-<empreinte>.json` | Catalogue d'éléments : résultat de la dernière analyse de chaque emplacement de source (`{ version, source, scanned, elements }`) | catalogue (`src/main/catalog/`), stockage JSON (écriture différée) |
| `catalog/overrides.json` | Modifications faites à la main : tags ajoutés ou retirés, infos et images, par clé d'élément ; tags créés par l'utilisateur ; fiches de l'ancien `meta.json` sans élément (`{ version, tags, elements, unmatched }`) | `src/main/catalog/overrides.ts`, stockage JSON |
| `meta/meta.json` | Ancien fichier des infos modifiées à la main : repris dans `catalog/overrides.json` au premier démarrage, puis laissé en place sans être écrit | `src/main/meta/user-meta.ts` jusqu'à P2-04 |
| `meta/img/` | Images choisies à la main | `src/main/meta/user-meta.ts` |
| `catalog/metadata.json` | Infos récupérées en ligne (films, séries, albums, jeux), par clé d'élément puis clé du fournisseur ; fiches sans élément ; titres introuvables (`{ version, elements, unmatched, misses }`) | `src/main/catalog/metadata.ts`, stockage JSON |
| `catalog/pages.json` | Pages créées ou modifiées par l'utilisateur, par identifiant, et pages prêtes à l'emploi supprimées (`{ version, pages, removed }`) ; absent tant que rien n'a changé | `src/main/catalog/pages/`, stockage JSON (écriture immédiate) |
| `catalog/lists.json` | Listes faites à la main, dans l'ordre de création ; pour chaque élément, sa clé et de quoi l'afficher s'il disparaît (`{ version, lists: [{ id, name, items: [{ key, name, source, open, added, poster? }] }] }`) ; absent tant qu'aucune liste n'a été créée | `src/main/catalog/lists/`, stockage JSON (écriture immédiate) |
| `scrape/db.json` | Ancien fichier des infos récupérées en ligne : repris dans `catalog/metadata.json` au premier démarrage, puis laissé en place sans être écrit | moteur de récupération (`scrape/`) jusqu'à P2-06 |
| `scrape/img/` | Affiches et images de fond téléchargées | moteur de récupération (`scrape/`) |
| `scrape/cache/` | Index des jaquettes et listes de jeux par console, gardés quelques jours (cache) | moteur de récupération (`scrape/`) |
| `telechargements.json` | Liste des téléchargements (en cours, terminés, en attente) | téléchargements (`src/main/downloads/`), stockage JSON |
| `torrents/` | Fichiers `.torrent` gardés pour reprendre un torrent | moteur torrent (`src/main/downloads/torrent.ts`) |
| `emulators/` | Émulateurs installés par la boutique, un dossier chacun | boutique (`src/main/store/`) |
| `emulators/installed.json` | Version et programme de chaque émulateur installé | boutique (`src/main/store/`), stockage JSON |
| `adblock/moteur.bin` | Moteur compilé du bloqueur de publicités | `src/main/web/adblock.ts` |
| `adblock/listes.json` | Date de mise à jour et état des listes de filtres | `src/main/web/adblock.ts`, stockage JSON |
| `cache/roms/` | Jeux en ligne téléchargés pour être lancés | jeux (`src/main/games/`) |
| `plugins/<id>/<version>/` | Plugins installés (posés à la main pour l'instant ; installation par le Centre : P3-07) | — |
| `plugins/state.json` | État des plugins : activé ou non, erreur qui a fait désactiver, dossiers accordés, version d'un plugin inclus installée (`{ version, plugins: { <id>: { enabled, fault?, folders?, bundled? } } }`) ; absent tant que rien n'a changé et qu'aucun plugin n'est inclus | hôte de plugins (`src/main/plugins/state.ts`), stockage JSON |
| `plugin-data/<id>/storage.json` | Stockage d'un plugin (`ctx.storage`) : `{ version, values }` | `src/main/plugins/plugin-storage.ts`, stockage JSON (écriture différée) |
| `plugins/logs/<id>.log` | Journal de chaque plugin (son `ctx.log`, refus, pannes), 256 Ko au plus puis `<id>.log.1` | `src/main/plugins/journal.ts` |
| `bin/7za` | Copie exécutable de 7-Zip, quand l'original ne peut pas l'être (application empaquetée) | service d'archives (`src/main/archive/`) |

Le dossier `userData` contient aussi les dossiers propres à Chromium (cache, cookies, `Local Storage`…), gérés
par Electron.

## Catalogue d'éléments

`src/main/catalog/` pose le modèle de l'architecture cible (« Éléments, tags et infos ») : tout ce que Mire peut ouvrir
deviendra un élément (`Element`, types dans `@mire/shared`). Depuis P2-02, chaque analyse de la bibliothèque
l'alimente (voir « Sources de la bibliothèque » plus bas), et depuis P2-03 les jeux, la télévision et les sites aussi
(« Jeux, télévision et sites »). L'interface historique ne s'en sert pas.

- **Clés stables** (`keys.ts`) : `<genre>:<partie>[|<partie>…]`, jamais d'après le rang ni le nom affiché. Une règle
  par genre d'élément :

  | Genre | Clé | Exemple |
  | --- | --- | --- |
  | Fichier local ou partage réseau | `local:<chemin>` | `local:/films/Intouchables.mkv`, `local:c:/films/intouchables.mkv` |
  | Fichier d'un serveur web | `remote:<adresse>` | `remote:https://nas.local/films/a.mkv` |
  | Entrée d'une liste M3U | `m3u:<liste>\|<adresse du flux>` | `m3u:https://box/liste.m3u\|http://box/stream?id=1` |
  | Jeu de console | `rom:<console>\|<fichier ou adresse>` | `rom:retroarch:snes\|d:/roms/snes/zelda.sfc` |
  | Jeu PC (dossier ou ajouté à la main) | `pc:<programme>` | `pc:c:/games/celeste/celeste.exe` |
  | Chaîne de télévision | `tv:<service>\|<numéro>` (sans numéro : la plus petite adresse de ses flux) | `tv:freebox\|2` |
  | Site | `web:<identifiant du site>` | `web:netflix` |
  | Marque-page d'une page / d'un jeu | `bm:<id>` / `gamebm:<id>` | `bm:a1b2c3` |

  Chemins : normalisés (`.`, `..`, séparateurs doublés et final retirés) ; sous Windows, sans casse et avec des `/`
  (la plateforme est un paramètre, ce qui permet de tester les deux règles partout). Adresses : forme canonique de
  `URL`, sans fragment. `%` et `|` sont échappés dans toutes les parties sauf la dernière.
- **Stockage** (`index.ts`, `createCatalog({ dir })`) : en mémoire, par emplacement de source
  (`{ plugin, instance }`). `setSource(source, éléments)` reçoit la liste complète d'une analyse et en déduit les
  ajouts, changements et retraits ; un élément déjà connu garde sa date d'ajout (`added`). Une clé fournie par deux
  emplacements reste tant que l'un d'eux la fournit ; l'élément est celui du premier. `removeSource(source)` retire
  un emplacement et son fichier. `element(clé)` rend une copie, ou `null`.
- **Événements** : `onChange(({ added, changed, removed }) => …)`, des listes de clés, une fois par analyse qui change
  quelque chose.
- **Persistance** (`persistence.ts`) : un fichier par emplacement dans `userData/catalog/sources/`, écrit par le
  stockage JSON (atomique, différé d'une seconde). Au démarrage, `load()` relit tous les fichiers ; un fichier
  illisible ou d'une autre version est écarté (journal), un élément mal formé aussi.
- **IPC** : `catalogElement(clé)` (canal `catalog:element`, le `catalog.element(key)` de l'architecture cible) rend
  l'élément avec ses tags, infos et images effectifs ; `catalogSetTags`, `catalogSetInfos`, `tagsList` : voir « Tags
  et infos ».
- `get(clé)` rend l'élément sans copie (lecture seule, pour le moteur de tags).
- **Écritures** : une analyse qui ne change rien à un emplacement ne copie rien, n'annonce rien et ne réécrit pas son
  fichier (`scanned` y est donc la date de la dernière analyse qui l'a changé). Les éléments se comparent par leur
  empreinte (leur JSON), calculée à la première comparaison et gardée ; un élément inchangé garde son objet, seuls
  ceux qui changent sont copiés (P2-04).

### Sources de la bibliothèque

Une source d'éléments (`ElementSource`, `catalog/types.ts`) trouve des éléments dans les emplacements qu'elle gère et
les donne au catalogue ; c'est la contribution `sources` des futurs plugins. La bibliothèque en a quatre
(`library/element-sources.ts`), une par plugin prévu à l'inventaire :

| Source | Emplacements | Tags de source | Élément |
| --- | --- | --- | --- |
| `src-local` | dossier de cet ordinateur | `local` | `local:<chemin>`, ouvert comme un fichier |
| `src-smb` | partage réseau (`\\NAS\…`, `smb://…`) | `network` | `local:<chemin>`, ouvert comme un fichier |
| `src-http` | page d'index d'un serveur web | `remote` | `remote:<adresse>`, ouvert comme un fichier |
| `src-m3u` | liste M3U en ligne | `remote` | `m3u:<liste>\|<flux>`, ouvert comme un flux |

- **Instance** : l'emplacement normalisé (chemin selon les règles des clés, ou adresse canonique). Un même emplacement
  déclaré pour plusieurs types de fichiers est une seule instance.
- **Infos et images posées par la source** : `folder` (dossier), `server` (serveur web), `playlist` (liste M3U),
  `subtitles` (sous-titres `.srt`/`.vtt` trouvés à côté d'une vidéo, chemins ou adresses) ; affiche et fanart
  trouvés à côté du fichier (`poster`, `background`), logo d'une entrée M3U (`logo`) ; `mediaType` (`video`, `audio`,
  `image`) pour une entrée M3U sans extension reconnue, qui tient son type de celui de la source configurée. Le type de
  fichier vient du moteur de tags (« Tags et infos ») ; les séries, films, albums et systèmes viennent des tags automatiques (« Tags et infos »).
- **Une seule analyse** : `scanLibrary` parcourt chaque emplacement une fois, rend ses `LibraryItem` à l'interface
  historique (inchangés) et appelle `onScanned` ; le service de la bibliothèque y passe les éléments au catalogue
  (`elementsOf`). `scan(emplacement)` analyse un emplacement seul, comme le fera l'hôte des plugins.
- **Rien n'est retiré à tort** : un emplacement inaccessible, ou coupé par le nombre maximal d'éléments, garde les
  éléments de l'analyse précédente. Un emplacement qui n'est plus dans la configuration quitte le catalogue à
  l'analyse suivante. Deux emplacements qui se recouvrent (dossier inclus dans un autre) donnent un seul élément
  par fichier, qui reste tant que l'un des deux le fournit.
- Une erreur du catalogue est passée au journal ; elle n'empêche jamais `library.scan` de répondre.

### Jeux, télévision et sites

Les autres sources (P2-03) suivent le même modèle : une par plugin prévu à l'inventaire, identifiants repris de
l'inventaire. Leurs éléments entrent dans le catalogue quand l'interface historique demande ses listes, ou se
déduisent de la configuration :

| Source | Emplacement (`instance`) | Tags | Élément | Quand |
| --- | --- | --- | --- | --- |
| `jeux-roms` | console et l'un de ses dossiers ou sources en ligne (`<console>\|<emplacement>`) | `game` | `rom:<console>\|<fichier>`, `open.kind` `game`, info `system`, jaquette (`poster`) | chaque `listRoms` (jeux sur disque : la liste `.m3u`, pas ses disques) |
| `jeux-pc` | dossier de jeux | `game` | `pc:<programme>`, `program`, `system` = `pc` | chaque `scanGameSources` |
| `jeux-pc-manuel` | `config` | `game` | `pc:<programme ou adresse>`, `program` (arguments), `system` = `pc`, image | configuration (`games`) |
| `jeux-marque` | `config` | `game` | `gamebm:<id>`, ouvert comme son lien (`site`), `system` du marque-page ou de sa console | configuration (`gameBookmarks` en attente) |
| `tv-m3u` | service | `tv` | `tv:<service>\|<numéro>`, `stream` (variante de la qualité préférée, `pickVariant` ; variantes), info `channel` (numéro, P2-07), logo | chaque `tvChannels` du service choisi |
| `tv-web` | service | `tv` | portail du service, `site` (`site` : `tv:<service>`, sa vue web) | configuration (service choisi, s'il est web) |
| `svc-<id>` / `web-perso` | `config` | `stream` | `web:<id>`, `site`, info `category` (`video`, `music`…) | configuration (`web`) : site du catalogue intégré / ajouté |
| `web-bm` | `config` | `stream` | `bm:<id>`, `site` (site au même domaine), `category`, `season`, `episode` | configuration (`bookmarks`) |

- **Configuration** (`catalog/sync.ts`, `syncFeeds`) : au démarrage et à chaque changement de la configuration, les
  sources qui s'en déduisent reçoivent leurs éléments ; un emplacement qui n'y est plus (console, dossier de jeux,
  site, service qui n'est plus choisi) quitte le catalogue. `setSource` n'écrit rien quand rien ne change.
- **Rien n'est retiré à tort** : comme pour la bibliothèque, un emplacement inaccessible (ou une liste coupée par le
  nombre maximal de jeux) garde ses éléments. Une erreur du catalogue passe au journal ; elle n'empêche jamais une
  liste de répondre.
- **`system`** : posé par la source et par le tag automatique « Consoles » (jeux de console) ; le tag automatique
  l'emporte (priorité des origines), une seule valeur par élément.
- **Fiches gardées sous une ancienne clé** : `r:<fichier>` rejoint le jeu ouvert par ce fichier, `g:<nom simplifié>`
  le jeu PC du même nom simplifié (cible `pcNameTarget`), `v:<adresse>` aussi un marque-page de page (l'interface
  historique le présente comme une vidéo à cette adresse). Le rattachement se fait à l'arrivée de l'élément
  (`adopt`), dans `overrides.json` comme dans `metadata.json`.
- Coût mesuré (750 jeux de console, 100 jeux PC, 300 chaînes, ~70 sites et marque-pages, à côté de 20 000 fichiers) :
  quelques millisecondes par liste, ~3 ms par changement de la configuration, rien de mesurable au chargement.

### Tags et infos

Le moteur (`catalog/tags/engine.ts`, `createTagEngine`) calcule les tags, infos et images effectifs de chaque élément
et les garde dans un index en mémoire. Il suit les événements du catalogue, les modifications faites à la main et
les règles par extension de la configuration.

- **Origines** (`tags/merge.ts`) :

  | Origine | Tags | Infos et images |
  | --- | --- | --- |
  | Type de fichier (`tags/file-rules.ts`) | `video`, `audio`, `image` d'après l'extension du fichier ou de l'adresse (formats de `EXT`) ; sans extension reconnue, l'info `mediaType` posée par la source (entrée M3U) | `extension` (`mkv`) |
  | Source | tags de la source (`local`, `network`, `remote`, `game`, `tv`, `stream`) | `folder`, `server`, `playlist`, `subtitles`, `mediaType`, `system`, `category`, `season`, `episode`, images trouvées à côté, jaquette, logo |
  | Tags automatiques (`tags/taggers.ts`) | `series`, `movie` | `series`, `season`, `episode`, `title`, `year`, `artist`, `album`, `track`, `system`, `folder` (détail ci-dessous) |
  | Infos en ligne (`catalog/metadata.ts`) | | `title`, `year`, `genres`, `overview`, `artist` ; images `poster`, `background` (un `Contributor` d'origine `metadata` par fournisseur) |
  | À la main (`overrides.json`) | ajout (`true`) ou **retrait** (`false`) | toute info, images |

  Tags : réunion des origines automatiques, puis les ajouts et les retraits faits à la main, qui l'emportent même
  après une nouvelle analyse. Infos et images : à la main, puis infos en ligne (le premier fournisseur l'emporte),
  puis tags automatiques, puis source, puis type de fichier.
- **Tags automatiques** (`tags/taggers.ts`) : interface `Tagger` (reçoit l'élément avec les tags du type de fichier et
  de la source, rend des tags et des infos ; rapide, sans réseau), branchée sur le moteur par `taggerContributor`. Les
  cinq tags internes (plugins inclus en phase 5) ne regardent que les fichiers :

  | Tag automatique | Éléments | Pose |
  | --- | --- | --- |
  | Séries | `video` | tag `series`, infos `series`, `season`, `episode` (`parseVideo`, « Friends S01E03 ») |
  | Films | `video` qui n'est pas un épisode | tag `movie`, infos `title`, `year` (`parseVideo`) |
  | Musique | `audio` | `artist` et `album` (dossier « Artiste - Album », sinon `album` : le dossier, ou son parent pour un « CD 2 »), `track` (numéro en tête du nom), `title` (nom sans ce numéro) |
  | Consoles | jeux (`open.kind` `game`) | `system` (`guessSystem` sur la console de la configuration, sinon l'extension du jeu) ; recalculé quand les consoles changent |
  | Photos | `image` | `folder` : groupe de dossier de l'interface (« Mariage, Partie 2 » pour un dossier générique) |

  Coût sur 20 000 éléments factices : ~5 µs par élément (+100 à 150 ms par analyse complète).
- **Règles par extension** : celles des formats reconnus ; seules les extensions changées sont gardées dans la
  configuration (`catalog.fileTags` : `{ ".ts": ["audio"], ".mkv": [] }`). La section est absente tant que rien n'y a
  été changé : la version de la configuration ne change pas.
- **Registre** (`tags/registry.ts`) : tags du cœur (`video`, `audio`, `image`, `local`, `network`, `remote`, `series`,
  `movie` des tags automatiques, `game`, `tv`, `stream` des sources de P2-03) et infos
  du cœur (`InfoDeclaration` : leur type `text`, `number`, `boolean`, `list`, et `searchable`, vrai par défaut pour
  un texte ou une liste ; faux pour `extension`, `mediaType`, `server` et `subtitles`, qui n'ont pas de sens dans une
  recherche ; un plugin le déclarera pour ses infos, P3-01) ; noms affichés dans les catalogues de textes
  (`catalog.tags.<id>`, `catalog.infos.<id>`). Un tag inconnu ajouté à la main devient un tag de l'utilisateur, dont
  l'identifiant est le nom simplifié (« Vus en 2024 » → `vus-en-2024`).
- **Index** (`tags/tag-index.ts`) : tag → clés, info → valeur → clés (un élément de liste est indexé seul).
  `query(require, exclude)` intersecte les ensembles en partant du plus petit : « `video` et `series` » sur 20 000
  éléments factices répond en ~2 ms (`test/catalog/tags-bench.test.ts`, générateur `test/catalog/fake-catalog.ts`).
- **IPC** : `catalogSetTags(clé, { tag: true | false | null })`, `catalogSetInfos(clé, { info: valeur | null })`
  (`null` : retour à l'automatique ; une valeur est ramenée au type de l'info, une valeur invalide ignorée) rendent
  l'élément, ou `null` s'il n'est pas dans le catalogue (la modification est gardée). `tagsList()` : tags du cœur, de
  l'utilisateur, puis ceux posés sans être déclarés, avec le nombre d'éléments.
- **Éditeurs** (P4-22) : `catalogPickImage(clé, 'poster' | 'background')` (image choisie sur le disque, copiée dans
  les données de Mire ; l'interface ne donne jamais de chemin), `catalogClearImages(clé, [images])` (retour à
  l'automatique) et `catalogReset(clé)` (tags, infos et images reviennent à l'automatique). Un titre saisi à la main
  (info `title` d'origine `user`) devient le nom affiché de l'élément (`nameOf`), et sert au tri par nom des pages.
- **Éditeurs des regroupements** (P4-22, `catalog/groups.ts`) : un regroupement est désigné par sa page et son chemin
  (`catalogGroup(page, chemin)` rend l'info qui le forme, sa valeur et tous ses éléments, quel que soit le nombre de
  niveaux en dessous). `catalogEditGroup(page, chemin, { rename, infos, tags, clearImages, reset })` pose chaque
  modification sur chaque élément en une seule écriture (`overrides.batch` : un seul changement annoncé) ; `rename`
  change l'info qui sert à regrouper (une valeur d'une liste, comme un genre, est remplacée seule) et le regroupement
  est rendu à son nouveau chemin. `catalogGroupPickImage` (image choisie sur le disque) et `catalogGroupFetch` (fiche
  choisie en ligne, lue sans être enregistrée par le moteur de récupération, `lookup` ; ses images sont posées sur les
  éléments, ses infos rendues pour être proposées dans le formulaire) : l'interface ne donne jamais de chemin d'image.
- **Modifications à la main** (`overrides.ts`) : `userData/catalog/overrides.json`, écrit aussitôt. Il reprend
  l'ancien `meta/meta.json` au premier démarrage (`legacy-meta.ts`) :

  | Ancienne clé | Élément |
  | --- | --- |
  | `v:`, `t:`, `i:` + chemin local | `local:<chemin>` (clé déduite) |
  | `v:`, `t:`, `i:` + adresse | l'élément ouvert par cette adresse (`remote:` ou `m3u:`), cherché dans le catalogue |
  | `r:` + fichier | le jeu ouvert par ce fichier, cherché dans le catalogue |
  | `b:<id>` | `gamebm:<id>` |
  | `g:` + nom simplifié | le jeu PC du même nom (P2-03), cherché dans le catalogue |
  | `a:` (dossier d'album), `c:` (console) | aucun : gardée sous l'ancienne clé (`unmatched`) |

  Une fiche gardée sous une adresse rejoint son élément quand une analyse l'apporte. Champs : `title`, `overview`,
  `artist` → infos du même nom ; `year` → `year` (nombre) ; `genre` → `genres` (liste) ; `image`, `backdrop` →
  images `poster`, `background`. `meta.json` est laissé en place et n'est plus écrit.
- **Infos en ligne** (`metadata.ts`) : `userData/catalog/metadata.json` range les fiches des fournisseurs
  (`src/main/scrape/`) par clé d'élément, puis par clé du fournisseur (un élément peut en avoir plusieurs). Il reprend
  `scrape/db.json` au premier démarrage, avec la même correspondance des clés que `meta.json` (`r:`, `b:`, `v:` ; `a:`
  et `g:` gardées dans `unmatched`), et les échecs (`misses`, sous les clés des fournisseurs). Une fiche gardée sous
  une adresse rejoint son élément quand une analyse l'apporte, une fiche `g:` le jeu PC du même nom (P2-03) ; `db.json` est laissé en place et n'est plus écrit.
  - Le moteur de récupération lit et écrit toujours sous les clés des fournisseurs (`scrapeStore`) : recherches,
    annulation, « Tout effacer » et l'interface historique (`scrapeData`) ne changent pas. Chaque fiche enregistrée
    ou oubliée recalcule son élément (`engine.refresh`).
  - Une fiche devient des infos et des images avec les mêmes conversions que les infos modifiées à la main
    (`genre` → `genres`, `year` → nombre, `image` → `poster`, `backdrop` → `background`).
  - **Ordre des fournisseurs** : une contribution par fournisseur, dans l'ordre de `catalog.metadataProviders`
    (`["steam", "tmdb"]`), puis les autres dans l'ordre par défaut (`tmdb`, `musicbrainz`, `libretro`, `steam`). La
    section est facultative : la version de la configuration ne change pas. Un changement recalcule tout.
- **Façade** : `src/main/meta/user-meta.ts` garde l'API de l'interface historique (`metaAll`, `metaSet`,
  `metaPickImage`, `metaReset`), sous les anciennes clés et avec les anciens champs. « Réinitialiser » efface les
  infos et images de la fiche, pas les tags modifiés à la main.

### Pages et regroupements

Une page (`PageDefinition`, `@mire/shared` : type, schéma JSON `PAGE_DEFINITION_SCHEMA` et `validatePage`) garde les
éléments qui portent tous les tags de `require` et aucun de `exclude`, sous les conditions de `where`, puis les range
sur plusieurs niveaux (`groupBy`, une info par niveau). Le service (`catalog/pages/`, `createPages`) calcule un niveau
à la fois.

- **Conditions** (`where`) : `{ info, equals }` (valeur égale ; texte sans tenir compte de la casse ni des accents),
  `{ info, contains }` (contient un texte, sans tenir compte de la casse), `{ info, between: [min, max] }` (bornes
  comprises, deux nombres ou deux textes). Pour une info de liste (`genres`), l'un de ses éléments suffit.
- **Regroupements** : un niveau rend les valeurs de son info, avec le nombre d'éléments et l'affiche du premier qui en
  a une. Les nombres sont rangés entre eux, les textes dans l'ordre alphabétique (« 2 » avant « 10 »). Un élément
  sans l'info va dans « Autres » (`value: null`, nom tiré des catalogues `pages.others`), toujours en dernier. Un
  élément dont l'info est une liste est rangé dans chacun de ses groupes.
- **Tri** (`sort`) : une info, ou `name` et `added`, croissant ou décroissant ; un élément sans la valeur va après
  les autres ; on finit toujours par le nom.
- **Tranches** : 100 regroupements ou éléments par réponse ; `next` est le curseur de la suivante (`null` à la fin).
- **Pages prêtes à l'emploi** (`pages/builtin.ts`, plugin inclus en P5-03) :

  | Page | `require` | `groupBy` | `sort` |
  | --- | --- | --- | --- |
  | `movies` (Films) | `video`, `movie` | `genres` | `title`, `year` |
  | `series` (Séries) | `video`, `series` | `series`, `season` | `episode` |
  | `music` (Musique) | `audio` | `artist`, `album` | `track` |
  | `images` (Images) | `image` | `folder` | nom |
  | `streaming` (Streaming) | `stream` | `category` | nom |
  | `tv` (Télévision) | `tv` | — | `channel` (numéro de la chaîne, posé par `tv-m3u`) |
  | `games` (Jeux) | `game` | `system` | nom |

- **`pages.json`** : une page enregistrée remplace la page prête à l'emploi du même identifiant (et la rétablit si
  elle avait été supprimée) ; une page prête à l'emploi supprimée est notée dans `removed`. Une page mal formée est
  écartée à la lecture (journal).
- **Calcul à la demande** : rien n'est calculé au démarrage. À la première demande, les éléments de la page viennent
  de l'index du moteur de tags (`query(require, exclude)`), puis des conditions ; ils restent en cache avec les
  niveaux déjà demandés. À chaque changement du moteur (`engine.onChange`), les éléments changés sont réévalués pour
  chaque page : une page touchée met ses éléments à jour, oublie ses niveaux et est annoncée. Au-delà de 500 éléments
  changés d'un coup, toutes les pages sont oubliées et annoncées.
- **IPC** : `pagesList()`, `pagesGet(id)`, `pagesSave(page)` (rend `{ ok: true, page }` ou `{ ok: false, errors }`,
  les champs qui ne conviennent pas), `pagesRemove(id)`, `catalogPage(pageId, path, cursor)` (`path` : la valeur
  choisie à chaque niveau, `null` pour « Autres » ; rend `{ kind: 'groups', info, groups }` ou
  `{ kind: 'elements', elements }`, avec `total` et `next`, ou `null`). Événement `onPagesChange` (`pages:changed`,
  `{ pages: [...] }`) : le contenu de ces pages est à redemander.
- **Tag vu comme une page** (explorateur, P4-08) : `catalogPage('tag:<id>', [], cursor)` rend les éléments qui portent
  ce tag, triés par nom, sans regroupement (`TAG_PAGE_PREFIX`, `tagPageId`). Calculé et gardé en cache comme une page,
  il n'est ni listé ni annoncé : un changement du moteur l'efface, l'explorateur relit ses colonnes à chaque
  `pages:changed`.
- Coût sur 20 000 éléments factices (`test/catalog/pages-bench.test.ts`) : 2 à 4 ms pour un niveau jamais calculé
  (première page des Séries, épisodes d'une saison, 4 000 films triés), moins de 0,5 ms en cache ; ~1 ms pour un
  élément changé avec les sept pages en cache.

### Listes

Une liste (`ListDefinition`, `@mire/shared` : types, `validateList`) est un regroupement fait à la main : des clés
d'éléments dans l'ordre choisi, sans doublon. Le service (`catalog/lists/`, `createLists`) lit `lists.json` au
démarrage et ne calcule rien d'autre.

- **Élément disparu** : pour chaque élément, la liste garde ce qu'il faut pour l'afficher (nom, source, ouverture,
  date d'ajout, affiche), mis à jour à chaque changement du moteur de tags. Un élément qui quitte le catalogue reste à
  sa place, indisponible (`available: false`), jusqu'à ce qu'il revienne ou qu'on le retire. Le moteur suit les
  événements du catalogue : un élément disparu ou revenu (ou changé) fait annoncer les listes qui le contiennent
  (index clé → listes, construit à la lecture du fichier).
- **Liste vue comme une page** : `catalogPage('list:<id>', [], cursor)` rend `{ kind: 'elements', elements }` dans
  l'ordre de la liste, sans regroupement ni tri, par tranches de 100. Le préfixe `list:` ne peut pas désigner une page
  (un identifiant de page n'a pas de `:`). Un élément indisponible y est reconstitué d'après ce que la liste garde,
  sans tags ni infos, avec `unavailable: true` (`PageElement`) : il ne s'ouvre pas.
- **Ajout** : seuls les éléments présents dans le catalogue s'ajoutent (à une position, à la fin par défaut) ; un
  élément déjà dans la liste n'y est pas mis deux fois. Une position trop grande met l'élément à la fin.
- **`lists.json`** : une liste mal formée (identifiant, nom, doublon d'identifiant) est écartée à la lecture, un
  élément mal formé ou en double aussi, sans perdre le reste (journal).
- **Fichier renommé ou déplacé par Mire** (P2-10, `movePath`) : ses éléments (et ceux de tout ce que contient un
  dossier) gardent leur place sous leur nouvelle clé, comme les modifications faites à la main et les infos en ligne
  (`overrides.movePath`, `metadata.movePath`). Les anciens éléments quittent le catalogue (`catalog.forget`) et une
  analyse de la bibliothèque est relancée peu après. Un fichier mis à la corbeille quitte le catalogue ; les listes
  le gardent, indisponible.
- **IPC** : `listsList()` (`{ id, name, count }`), `listsGet(id)` (éléments avec `available`), `listsCreate(name)`,
  `listsRename(id, name)`, `listsRemove(id)`, `listsAdd(id, keys, at?)`, `listsRemoveItems(id, keys)`,
  `listsMove(id, key, to)` ; `name` : un texte ou une clé des catalogues (`{ key }`). Événement `onListsChange`
  (`lists:changed`, `{ lists: [...] }`) : ces listes, et leur page `list:<id>`, sont à redemander.

### Recherche

Le service (`catalog/search/`, `createSearch`, `catalog.search(query, options)` de l'architecture cible) cherche dans
les éléments effectifs du moteur de tags. Les fournisseurs « Où regarder » (`SearchProvider`) restent interrogés à
part, comme avant ; l'interface historique garde sa propre recherche (`src/renderer/domain/search.ts`).

- **Comparaison** : celle de l'interface historique (`matcher`) : un élément est trouvé s'il contient tous les mots de
  la recherche, dans n'importe quel ordre, sans tenir compte des accents ni de la casse (`fold`). Une recherche vide
  ou faite d'espaces ne trouve rien.
- **Ce qui est cherché** : le nom de l'élément, ses infos texte cherchables (type `text` du registre, éléments texte
  des infos de liste comme `genres`, et une info non déclarée si sa valeur est un texte ; pas les nombres, ni une info
  déclarée `searchable: false` comme l'extension ou les sous-titres, `searchedAs`) et le nom affiché de
  ses tags, dans la langue de l'interface (« films » trouve les films en français, « movies » en anglais).
- **Calcul à la demande** : rien n'est calculé au démarrage. À la première recherche, le nom et les infos texte de
  chaque élément sont simplifiés et gardés (une valeur qui se répète, comme un dossier, n'est simplifiée qu'une
  fois) ; ensuite, `engine.onChange` les tient à jour. Au-delà de 500 éléments changés d'un coup, ils sont oubliés et
  préparés de nouveau à la recherche suivante. Les noms des tags sont comparés à chaque recherche (il y en a peu).
- **Résultats groupés par page** : pour chaque page (`pages.list()`, dans l'ordre du menu), les éléments trouvés qui y
  entrent (même règle que la page : `require`, `exclude`, `where`) ; un élément peut être dans plusieurs groupes. Les
  éléments qui n'entrent dans aucune page forment un dernier groupe (`page: null`, « Autres éléments », catalogues
  `pages.outside`). Les listes ne sont pas des groupes. Un groupe rend ses `limit` premiers éléments (24 par défaut,
  100 au plus) et son `total` : ceux dont le nom contient tous les mots d'abord, puis par nom.
- **IPC** : `catalogSearch(query, options?)` (canal `catalog:search`) rend `{ query, total, groups }`
  (`SearchResult`, `@mire/shared`) ; `total` compte chaque élément trouvé une fois.
- Coût sur 20 000 éléments factices (`test/catalog/search-bench.test.ts`) : 30 à 40 ms pour la première recherche,
  qui prépare les textes (davantage quand le ramasse-miettes passe) ; 3 à 7 ms pour les suivantes, ~15 ms pour une
  recherche qui trouve presque tout (« e ») ; ~1 ms pour un élément changé, textes préparés.

## Configuration

`src/main/config/` détient la configuration (`config.json`) ; ses types (`Config`, `WebSite`, `TvService`,
`Emulator`…) sont dans `@mire/shared`.

- `defaults.ts` (`DEFAULT_CONFIG`, valeurs admises) et `catalogs/` (`DEFAULT_TV`, `DEFAULT_WEB` : données, futur
  contenu d'addons) ;
- `migrations/` : une étape par version (`v2.ts` … `v9.ts`) et leur registre ; `migrate(brut)` rend
  `{ config, from, changed }`. Nouvelle version : ajouter `vN.ts`, l'inscrire dans `MIGRATIONS`, monter
  `CONFIG_VERSION` ;
- v9 (P2-11, sections → pages) : les pages prêtes à l'emploi reprennent les sections de la v8 telles quelles (toutes
  épinglées, dans l'ordre du menu de la v8, qui n'était ni modifiable ni masquable) : rien n'est écrit dans
  `catalog/pages.json` ni dans `catalog/lists.json` (la v8 n'a pas de favoris). La position et le repli du menu
  (`ui.menu`) ne bougent pas. Les barres de la mire, « Vos services » et « Reprendre » deviennent les rangées de
  l'accueil (`ui.home.rows`, `HomeRow` : `bars` vers des cibles, voir `targets.ts` dans « `@mire/shared` » ; `sites` par clé
  `web:<id>` ; `recent` ; `page` ; `list`). `ui.home.clock`, `recent`, `bars`, `services` et `ui.start` restent en
  place pour l'interface historique ; une configuration sans rangées (installation neuve) reçoit celles qu'on tire de
  ces réglages. Les réglages qui iront aux plugins ne bougent pas (P5-01) ;
- `normalize/` : une fonction par section ; `normalizeConfig(valeur)` rend toujours une configuration complète. La
  section `catalog` (règles par extension du moteur de tags, P2-04) est facultative : absente, elle n'est pas ajoutée ;
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

- **Clés d'éléments** (P2-11) : chaque entrée de « Reprendre » porte la clé de son élément (`key`, `null` pour un
  lien magnet ou un chemin relatif) et les positions de reprise sont rangées par clé (`local:` pour un chemin absolu
  ou un partage, `remote:` pour une adresse web ; par chemin pour le reste). Le contrat IPC reste par chemin : le
  service en tire la clé. Un `usage.json` d'avant (positions par chemin) est rattaché au chargement et réécrit une
  fois ; un import ou le `localStorage` d'une version précédente aussi. Les recherches récentes sont des textes : elles
  ne désignent aucun élément et restent telles quelles.
- **Fichier renommé ou déplacé par Mire** (P2-12, `rules.movePath`, appelé par `catalogFollow`) : les positions de
  reprise et les entrées de « Reprendre » passent sous le nouveau chemin et la nouvelle clé ; la position du fichier
  déplacé remplace une ancienne restée sous le nouveau chemin. Après une mise à la corbeille, rien ne change.
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
  contenu qui n'est pas un objet) → `onCorrupt(erreur, fichier, misDeCôté)` puis valeurs par défaut. Avec `setAside`
  (fichiers du catalogue), le fichier illisible est d'abord renommé en `<fichier>.illisible-<date>` (`setAsideFile`),
  comme `config.json`, pour qu'une écriture ne l'écrase pas en silence. Les clés lues complètent les valeurs par
  défaut ;
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
  (`before-quit`), `src/main/app/lifecycle.ts` suspend la sortie, attend `flush()` de `scrape/db.json`,
  `telechargements.json`, `usage.json` et du catalogue deux secondes au plus (`flushWithin`), puis quitte ;
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
