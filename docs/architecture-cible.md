# Architecture cible : plugins, éléments, pages, explorateur et thèmes

Statut : proposée au point d'étape **G2c** (16/11/2026), après le tri de tous les éléments de Mire
(`docs/plan/inventaire-plugins.md`). Ce document remplace l'ADR des addons prévue en P3-01 et les principes du § 9
de `docs/analyse/ANALYSE.md`. Décisions correspondantes : D-14 à D-23 (`ANALYSE.md` § 10).

`docs/architecture.md` continue de décrire Mire tel qu'il est aujourd'hui ; il rejoindra ce document au fil des
tâches.

## En bref

- **Un cœur, des plugins.** Le cœur garde la sécurité, les données, les écrans système, les lecteurs, la vue web et
  la mécanique des plugins. Tout le reste devient un plugin, inclus ou à installer depuis un dépôt : sources, infos
  en ligne, services, émulateurs, packs, pages prêtes à l'emploi, thèmes, et les langues sauf l'anglais.
- **Plus de sections.** Chaque élément porte des **tags** (`video`, `series`, `favori`…) et des **infos** (série,
  saison, artiste, console, année…).
  - Une **page** affiche les éléments qui portent ses tags et les **regroupe** sur plusieurs niveaux d'après leurs
    infos.
  - Une **liste** est un regroupement fait à la main, dans l'ordre choisi.
- **L'explorateur** montre tous les éléments en colonnes, comme le Finder du Mac, et permet de les gérer.
  - Il fait partie du cœur et ne prend aucun thème, seulement les palettes de couleurs.
  - Il reste toujours accessible : c'est le mode secours.
- **Les thèmes** sont des façons plus visuelles de parcourir les mêmes pages. Le thème par défaut, « Mire », est
  construit avec dot-stash : c'est le travail de l'ancienne phase 2. Un thème peut aussi avoir son propre code : il
  change alors tout l'agencement et accède à toute la bibliothèque (D-23).
- **Le Centre** remplace Téléchargements et Boutique : dépôts, plugins, apps et téléchargements au même endroit. Le
  dépôt officiel est signé, et l'utilisateur peut ajouter d'autres dépôts.
- **Un assistant de premier lancement** installe ce dont l'utilisateur a besoin : Mire reste simple malgré le
  nombre de plugins.
- **Les niveaux de sécurité restent ceux d'aujourd'hui** : données seules, code limité, code sensible. Rien
  n'affaiblit l'isolation de la fenêtre principale.

## Vocabulaire

| Terme | Sens |
| --- | --- |
| Élément | Ce que l'utilisateur ouvre : un fichier (vidéo, morceau, image), un jeu, un site, une chaîne, une radio, un épisode de podcast. |
| Tag | Une étiquette simple portée par un élément : `video`, `series`, `stream`, `favori`. Sert à choisir ce qu'une page affiche. |
| Info | Une propriété d'un élément, avec sa valeur : `series` = « Friends », `season` = 1, `artist`, `system`, `year`. Sert à regrouper, trier et afficher. |
| Page | Une vue enregistrée : tags requis et exclus, tri, regroupements, affichage, place dans le menu. Remplace les sections. |
| Regroupement | Un niveau de classement dans une page, d'après une info (« par série », puis « par saison »). |
| Liste | Un regroupement fait à la main et ordonné, comme une playlist (« Marvel dans l'ordre »). |
| Source | Ce qui fournit des éléments : un dossier, un serveur, un service, un pack de chaînes, les dossiers de jeux d'une console. |
| Plugin | Un paquet installable qui apporte une ou plusieurs contributions : source, infos, tags automatiques, site, émulateur, pages, thème, palette, langue… Le mot remplace « addon » dans le plan. |
| Dépôt | Une liste signée de plugins, publiée en ligne. Le dépôt officiel est `jezoock/mire-addons` (D-09). |
| Centre | L'écran qui installe et met à jour les plugins et suit les téléchargements. |
| Thème | Une façon d'afficher l'accueil, les pages, les regroupements et les éléments. |
| Palette | Un jeu de couleurs (Écran éteint, Plein jour…), repris par les thèmes et par l'explorateur. |

## Ce qui reste dans le cœur

La liste complète, avec la décision prise pour chaque élément, est dans `docs/plan/inventaire-plugins.md`. En
résumé :

- **socle** :
  - fenêtre principale et ses protections, politique d'accès et `media://` ;
  - configuration, dossier de données, contrat IPC, client HTTP ;
  - moteur de traduction, navigation au clavier, à la télécommande et à la manette, cycle de vie ;
  - hôte de plugins, dépôts, signatures, dépendances entre plugins ;
- **modèle** :
  - catalogue d'éléments, moteur de tags et d'infos, formats reconnus ;
  - tags selon le type de fichier et selon la source ;
  - tags et infos ajoutés à la main, administration des tags ;
  - pages, regroupements automatiques, listes ;
  - ouvrir un fichier ;
- **écrans** :
  - coquille et menu, accueil, recherche, Centre, réglages ;
  - explorateur et mode secours ;
  - moteur de thèmes et format des thèmes sans code ;
- **lecture** :
  - lecteurs vidéo, musique et images, reprise et volume ;
  - lecteur externe choisi à la main, navigateur du système, lanceur de programmes ;
- **web** :
  - vues web, Widevine (lié au moteur castLabs), identité « Chrome » ;
  - raccourcis, fenêtres surgissantes ;
  - sites ajoutés par l'utilisateur, recherche mémorisée d'un site, marque-pages ;
- **téléchargements** : centre, HTTP, décompression, fin de téléchargement avec des actions paramétrables ;
- **jeux** :
  - référentiel des consoles, ouvert aux plugins ;
  - consoles créées à la main, émulateur choisi par console ;
  - installateurs génériques, fusionnés dans le Centre ;
  - nettoyage et suppression ;
- **apparence** : palettes Écran éteint et Contraste élevé, police Archivo, langue anglaise (langue de repli).

Tout le reste est un plugin :

- **29 plugins inclus**, livrés avec Mire :
  - sources locales et réseau, sous-titres, sources de jeux ;
  - tags automatiques, pages prêtes à l'emploi, thème Mire ;
  - lecteurs mpv et VLC, profils de manettes, connexion Google ;
  - infos des fichiers audio et des photos ;
- **114 plugins à installer** depuis un dépôt.

## Plugins

### Contributions

Un plugin déclare une ou plusieurs contributions. Chaque nature reprend une interface posée en phase 1, ou en
ajoute une.

| Contribution | Interface | Exemples |
| --- | --- | --- |
| `sources` | `ElementSource`, qui réunit `SourceProvider`, `GameSourceProvider` et `TvProvider` | dossier local, NAS, serveur web, Jellyfin, radios, podcasts, chaînes d'une box |
| `metadata` | `MetadataProvider` | TMDB, MusicBrainz, ScreenScraper, OpenSubtitles |
| `taggers` | `Tagger` (nouvelle) | séries d'après le nom du fichier, console d'après l'extension, infos des MP3, EXIF des photos |
| `search` | `SearchProvider` | « Où regarder » |
| `webApps` | données `WebSite` | Netflix, ARTE, Xbox Cloud Gaming |
| `webExtensions` | `WebExtension` | bloqueur de publicités, connexion Google |
| `downloaders` | `Downloader` | torrents |
| `apps` | données d'installation et de lancement (émulateurs, lecteurs externes) | RetroArch, Mesen, RPCS3, mpv |
| `systems` | données `GameSystem` | PS3, Switch, arcade, DOS |
| `packs` | données : chaînes, sites, jeux libres | Freebox, sites de jeux légaux, jeux libres |
| `pages` | données `PageDefinition` | Films, Séries, Musique |
| `themes`, `palettes`, `languages`, `gamepads` | données | thème Mire, Plein jour, français, manettes Xbox |

### Manifeste

Chaque plugin a un manifeste `mire-plugin.json`, validé par un schéma JSON publié dans `@mire/plugin-sdk` :

```json
{
  "id": "mire.infos.tmdb",
  "version": "1.2.0",
  "engines": { "mire": "^1.0.0" },
  "level": "code",
  "contributes": { "metadata": [{ "id": "tmdb", "kinds": ["movie", "series"], "main": "dist/index.js" }] },
  "permissions": { "hosts": ["api.themoviedb.org", "image.tmdb.org"] },
  "dependencies": {},
  "settings": [{ "key": "apiKey", "type": "secret" }],
  "i18n": "i18n/"
}
```

- `id` : en notation inversée. Le préfixe `mire.` est réservé au dépôt officiel.
- `level` : `data`, `code` ou `privileged` (voir les niveaux ci-dessous). Le cœur refuse une contribution qui ne
  correspond pas au niveau déclaré : un plugin `data` n'a pas de `main`.
- `permissions` :
  - hôtes Internet ;
  - dossiers, demandés à l'utilisateur au moment où il en a besoin ;
  - réseau local, lancement de programmes, vues web, suppression de fichiers.
- `dependencies` : les autres plugins requis, avec leur plage de versions.
- `settings` : les réglages du plugin.
  - Ils sont rangés sous `plugins.<id>` dans la configuration.
  - Les Réglages les présentent à partir du schéma de P1-26.
  - Un réglage `secret` (clé d'API) est chiffré quand le système le permet (`safeStorage`) et n'est jamais exporté
    en clair.
- `i18n` : les textes du plugin, au format des catalogues (`docs/i18n.md`). L'anglais est obligatoire, et le
  français pour un plugin du dépôt officiel.

### Niveaux de sécurité et exécution

Ce sont les trois niveaux présentés au tri ; cette section précise où tourne le code (D-18, qui précise D-07).

| Niveau | Contient | Où il tourne | Peut venir de |
| --- | --- | --- | --- |
| **Données seules** (`data`) | JSON, images, sons, polices, jetons de couleurs | Rien ne s'exécute. Le cœur lit et valide les fichiers (schémas JSON, adresses `https:` seulement). | Tout dépôt |
| **Code limité** (`code`) | Du JavaScript qui n'a besoin que de l'API de Mire | Dans l'**hôte isolé** (voir ci-dessous). Le plugin reçoit un contexte (`http`, `files`, `storage`, `settings`, `log`, `events`) relayé au processus principal, qui applique ses permissions. | Tout dépôt |
| **Code sensible** (`privileged`) | Du code qui a besoin de Node ou d'un accès sensible : lancer des programmes, réseau local, supprimer des fichiers, extensions des vues web, moteur de téléchargement | Dans le processus principal, derrière la même API par messages (D-07) | Le dépôt officiel signé. Un dépôt tiers seulement après l'accord explicite de l'utilisateur, plugin par plugin, avec un avertissement renforcé. |

- **L'hôte isolé** : une `WebContents` cachée, `sandbox: true`, `contextIsolation`, sans `nodeIntegration`.
  - Il tourne dans une session dont toute requête réseau est refusée.
  - Les plugins sont chargés par un protocole en lecture seule, `mire-plugin://<id>/…`, limité au dossier du
    plugin, et communiquent par `MessagePort`.
  - Il y a un hôte pour les plugins officiels et un par dépôt tiers : un plugin tiers ne peut pas gêner les autres.
  - Le prototype de la tâche « hôte isolé » mesure le coût (mémoire, temps d'analyse de 20 000 éléments) avant de
    figer ce choix. L'autre voie étudiée est un `utilityProcess`.
- **Le contexte du plugin** :
  - le client HTTP refuse tout hôte absent de `permissions.hosts` ;
  - `files` ne lit que les dossiers accordés, en passant par la politique d'accès (`src/main/security/`) ;
  - `files.walk` parcourt les dossiers dans le processus principal, pour ne pas faire transiter chaque fichier.
- **Erreurs** : un plugin qui lève une exception, dépasse son délai ou fait planter son hôte est désactivé avec un
  message clair. L'hôte redémarre sans lui, et Mire continue de fonctionner.

### Plugins inclus, plugins à installer

- **Inclus** : livrés dans l'installateur (`resources/plugins/`) et installés au premier lancement. Ils sont
  désactivables et mis à jour par le dépôt officiel comme les autres. Mire fonctionne hors ligne avec eux.
- **À installer** : proposés par un dépôt, installés à la demande depuis le Centre ou par l'assistant du premier
  lancement.
- **Dépendances** : le Centre installe un plugin avec ses dépendances. Par exemple, le pack Freebox installe aussi la
  télévision par liste M3U. Il refuse de désinstaller un plugin dont un autre a besoin, et dit pourquoi.
- **Fichiers d'un plugin** :
  - `userData/plugins/<id>/<version>/` pour le code ;
  - `userData/plugin-data/<id>/` pour son stockage ;
  - à la désinstallation, l'utilisateur choisit de garder ou non les données du plugin.

## Dépôts et Centre

- **Index signé** : chaque dépôt publie un `index.json`, signé en ed25519 (format et chaîne de publication :
  [`docs/index-format.md` de `mire-addons`](https://github.com/jezoock/mire-addons/blob/main/docs/index-format.md)).
  - Il décrit pour chaque plugin : versions, empreinte sha256 de chaque paquet, niveau, permissions, dépendances.
  - La clé du dépôt officiel est intégrée à Mire.
  - La clé d'un dépôt tiers est fournie à l'ajout du dépôt, et son empreinte est affichée pour vérification.
- **Confiance** :
  - l'origine du plugin (officiel ou tiers, et quel dépôt) est affichée partout et avant chaque installation, avec
    les permissions demandées ;
  - un identifiant appartient au dépôt qui l'a installé, et le plugin ne se met à jour que depuis ce dépôt.
- **Hors ligne** : le dernier index de chaque dépôt est gardé en cache. Les plugins installés fonctionnent sans
  connexion.
- **Centre** : un seul écran pour :
  - les dépôts ;
  - les plugins installés, disponibles, et leurs mises à jour ;
  - les apps (émulateurs, lecteurs externes), installées par les installateurs génériques du cœur ;
  - les téléchargements en cours.
- **Premier lancement** : un assistant court, aussi simple à la manette qu'au clavier.
  1. La langue : celle du système, installée d'office (D-20).
  2. Ce qu'on veut faire : films et séries, musique, photos, jeux, télévision, streaming.
  3. La box, pour la télévision.
  4. Les services de streaming utilisés.

  L'assistant installe les plugins correspondants, et tout se change ensuite dans le Centre.
- **JustStream et Voir-Anime** quittent le dépôt officiel et le catalogue intégré. Un dépôt tiers ajouté par
  l'utilisateur peut les proposer ; le plan ne prévoit pas de le créer.

## Éléments, tags et infos

Le catalogue d'éléments vit dans le processus principal (`src/main/catalog/`). L'interface ne calcule plus les
regroupements, comme elle le fait aujourd'hui dans `src/renderer/domain/` et `app.js` : elle les demande au
catalogue.

### Élément

```ts
interface Element {
  key: string; // stable, préfixée par la source : « local:/films/Intouchables.mkv », « web:netflix »
  source: { plugin: string; instance: string }; // le plugin et l'emplacement configuré qui l'ont fourni
  name: string;
  open: OpenSpec; // comment l'ouvrir : fichier, site, jeu (console + fichier), programme, flux
  tags: string[]; // tags effectifs, calculés
  infos: Record<string, InfoValue>; // infos effectives, calculées
  images: { poster?: string; background?: string; logo?: string };
  added: number;
}
```

### D'où viennent les tags et les infos

| Origine | Tags | Infos |
| --- | --- | --- |
| Type de fichier (cœur) | `.mkv` → `video`, `.mp3` → `audio`, `.jpg` → `image`, d'après les formats reconnus ; règles modifiables | extension |
| Source (le plugin source les déclare) | site de streaming → `stream`, site de jeux → `roms`, chaîne → `tv`, radio → `radio` | dossier, serveur |
| Tags automatiques (plugins `taggers`) | `series`, `movie`, `game`… | série, saison et épisode d'après « Friends S01E03 » ; console d'après l'extension ; artiste, album, piste d'après les tags ID3 ; date et lieu d'après l'EXIF |
| Infos en ligne (plugins `metadata`) | — | titre, année, genres, résumé, images |
| À la main | ajout ou retrait | toute info |

- **Priorités** : pour une info, la valeur saisie à la main l'emporte. Viennent ensuite les infos en ligne (dans
  l'ordre des fournisseurs choisi par l'utilisateur), puis les tags automatiques, puis la source.
- **Tags à la main** : un ajout ou un **retrait** à la main est gardé pour l'élément. Il l'emporte sur
  l'automatique, même après une nouvelle analyse.
- **Identifiants** :
  - les tags et les infos du cœur ont un identifiant stable en anglais (`video`, `series`, `season`) et un nom
    affiché tiré des catalogues ;
  - un plugin déclare ses propres tags et infos (identifiant, nom, type de valeur) ;
  - un tag créé par l'utilisateur prend pour identifiant son nom simplifié.
- **Administration des tags** (Réglages) : renommer, fusionner, supprimer, choisir une couleur et une icône,
  modifier les règles par type de fichier, et voir quel plugin pose quel tag.

### Index et stockage

- **Index en mémoire** : tag → ensemble de clés, et info → valeurs → clés. Une page se calcule par intersection,
  sans parcourir tout le catalogue. Objectif : une réponse en moins de 50 ms pour 20 000 éléments sur une machine
  modeste.
- **Stockage** (`userData/catalog/`) :
  - un fichier par emplacement de source, avec le résultat de la dernière analyse ;
  - un fichier des modifications faites à la main (tags, infos, images), qui reprend `src/main/meta/user-meta.ts` ;
  - `lists.json` et `pages.json` ;
  - la base des fiches d'infos en ligne (`src/main/scrape/`) reste à part, indexée par clé d'élément.
- **IPC** :
  - `catalog.page(pageId, path, cursor)` renvoie les regroupements ou les éléments d'un niveau, par tranches ;
  - `catalog.element(key)`, `catalog.search(query)`, `catalog.setTags`, `catalog.setInfos` ;
  - `lists.*`, `pages.*` ;
  - les changements (fin d'analyse, nouvelle fiche) arrivent par événement.

## Pages, regroupements et listes

```json
{
  "id": "series",
  "name": { "key": "pages.series" },
  "icon": "tv",
  "require": ["video", "series"],
  "exclude": [],
  "where": [],
  "groupBy": ["series", "season"],
  "sort": [{ "by": "episode" }],
  "display": "posters",
  "menu": { "pinned": true, "order": 2 }
}
```

- **Filtre** : une page garde les éléments qui portent :
  - tous les tags de `require` ;
  - aucun tag de `exclude` ;
  - les conditions simples de `where` sur les infos (égal, contient, entre deux valeurs), pour des pages comme
    « Films des années 90 ».
- **Regroupements** : chaque niveau de `groupBy` est une info ; un élément sans cette info va dans « Autres ».
  - Exemple : Séries → Friends → Saison 1 → épisodes.
  - Un plugin `taggers` qui pose une nouvelle info rend possible un nouveau regroupement, sans rien changer d'autre.
- **Listes** : créées à la main, ordonnées, rangées dans l'explorateur. Une liste peut être épinglée au menu comme
  une page, ou servir de rangée sur l'accueil.
- **Pages prêtes à l'emploi** (plugin inclus), modifiables et supprimables ; l'utilisateur peut en créer d'autres :

  | Page | Tags | Regroupée par |
  | --- | --- | --- |
  | Films | `video` + `movie` | genre |
  | Séries | `video` + `series` | série, puis saison |
  | Musique | `audio` | artiste, puis album |
  | Images | `image` | dossier |
  | Streaming | `stream` | catégorie |
  | Télévision | `tv` | — |
  | Jeux | `game` | console |

- **`display`** est une indication pour le thème (affiches, vignettes, liste, rangées). L'explorateur l'ignore.

## Écrans

Les écrans système font partie du cœur :

- la **coquille** et le menu : pages épinglées, position du menu, en-tête, horloge, aide de la manette ;
- l'**Accueil** : « Reprendre », et des rangées tirées des pages et des listes choisies ;
- la **Recherche** : tout le catalogue, et les fournisseurs `search` ;
- le **Centre** ;
- les **Réglages** : Mire, plugins, tags, pages, configuration ;
- l'**Explorateur** ;
- les **lecteurs**.

L'accueil et les pages sont dessinés par le thème. Le Centre, les Réglages et l'explorateur gardent l'habillage du
cœur.

### Explorateur

- **Colonnes** :
  - la première propose Pages, Listes, Tags, Sources et Dossiers (les dossiers autorisés) ;
  - chaque choix ouvre la colonne suivante : les regroupements, puis les éléments ;
  - la dernière est un **aperçu** : image, infos, tags, source, emplacement du fichier, et les actions Lire,
    Modifier les infos, Tags, Ajouter à une liste.
- **Navigation** :
  - gauche et droite changent de colonne, haut et bas changent de ligne ;
  - Entrée ou le bouton A ouvre ;
  - le bouton de menu ou le clic droit affiche les actions ;
  - la souris et le clavier fonctionnent comme dans un explorateur de fichiers.
- **Gérer ses fichiers** : renommer, déplacer ou supprimer un fichier ou un dossier.
  - Seulement dans les dossiers autorisés, et après confirmation.
  - Un service du processus principal s'en charge. Il passe par la politique d'accès et reprend le contrôle de
    chemin de la suppression des jeux (P0-06).
  - Le catalogue suit le changement.
- **Sélection** : choisir plusieurs éléments pour leur ajouter un tag, les ranger dans une liste ou les supprimer.
- **Affichage fixe** : les thèmes ne s'appliquent jamais à l'explorateur. Seules les palettes de couleurs s'y
  appliquent, sans effets visuels particuliers.
- **Mode secours** : l'explorateur s'ouvre toujours, quel que soit le thème :
  - par un raccourci clavier et une combinaison de la manette, captés par le processus principal
    (`before-input-event`) pour qu'un thème ne puisse pas les bloquer ;
  - par une option au démarrage (`--explorateur`, ou une touche maintenue au lancement) ;
  - automatiquement, avec un message, si le thème ne se charge pas, dépasse son délai ou plante deux fois de suite.

## Thèmes

- **Rôle** : un thème sans code dessine l'accueil, les pages, les regroupements et les cartes d'éléments ; un thème
  avec code dessine en plus son menu et tout son agencement. Aucun ne touche aux lecteurs, au Centre, aux Réglages
  ni à l'explorateur : ces écrans du cœur s'ouvrent par-dessus le thème.
- **Palettes** : les anciens thèmes (Écran éteint, Plein jour, Minuit, Velours, Contraste élevé) deviennent des
  palettes, c'est-à-dire des jeux de jetons de couleurs (D-05). Écran éteint et Contraste élevé sont au cœur, les
  autres sont des plugins.
- **Thèmes sans code** (format du cœur) : un `theme.json` choisit :
  - la palette, les polices, les images et les sons ;
  - la mise en page parmi les composants de Mire : rangées ou grille, taille et forme des cartes, place du menu,
    fond.

  Le moteur de thèmes les affiche avec les composants `mire-*`, et aucun code tiers ne s'exécute.

  ```json
  {
    "palette": "ecran-eteint",
    "fonts": { "ui": "fonts/Archivo.woff2" },
    "home": { "layout": "rows" },
    "page": { "layout": "grid", "card": "poster", "size": "m" },
    "menu": { "position": "left" },
    "sounds": { "move": "sounds/move.ogg" }
  }
  ```

- **Thème Mire** (plugin inclus, thème par défaut) : l'interface actuelle refaite avec dot-stash.
  - C'est un thème sans code.
  - Ses composants (`mire-page-view`, `mire-card`, `mire-row`…) sont ceux du cœur.
  - Les concevoir pour lui oblige à les rendre assez souples pour d'autres thèmes.
- **Thèmes avec leur propre code** (D-23) : un thème qui n'a rien à voir avec le thème Mire, en visuels comme en
  agencement.
  - **Où il tourne** : dans un cadre isolé qui occupe toute la fenêtre, une `iframe` sandboxée (origine opaque)
    chargée par `mire-theme://<id>/`. La CSP de la fenêtre gagne seulement `frame-src mire-theme:` ;
    `script-src 'self'` ne change pas.
  - **Ce qu'il lit** : tout le catalogue (éléments, tags, infos, images, pages, regroupements, listes, recherche,
    « Reprendre », historique, sites, chaînes, jeux, téléchargements en cours), avec les événements de changement.
  - **Ce qu'il fait** :
    - ouvrir, lire ou lancer un élément, piloter la lecture et suivre son état ;
    - ouvrir une page ou un écran du cœur, chercher ;
    - modifier tags, infos, listes, favoris et positions de reprise ;
    - relancer l'analyse des sources.
  - **Ses entrées et ressources** :
    - clavier, souris et manette en direct, plus les actions de navigation du cœur ;
    - ses propres fichiers (images, polices, sons, vidéos, bibliothèques JavaScript), son stockage, ses réglages ;
    - Internet vers les hôtes qu'il déclare, affichés avant l'installation.
  - **Ce qui reste refusé** : ce sont les limites des niveaux de sécurité, rien de plus.
    - Node, et l'accès direct aux fichiers.
    - Les réglages de Mire et des autres plugins, et les secrets.
    - Supprimer ou déplacer des fichiers, installer des plugins.
    - Les sites ouverts dans les vues web.
    - Bloquer le mode secours.
  - **Niveau** : code limité, depuis tout dépôt. L'API est versionnée, et son client JavaScript est publié dans
    `@mire/plugin-sdk`.

## Jeux et émulateurs

- **Un plugin par émulateur** (`apps`). Il décrit :
  - comment l'installer : release GitHub, page de téléchargement ou programme autonome, avec les installateurs
    génériques du cœur ;
  - comment trouver l'exécutable et le lancer, avec les arguments propres à chaque console ;
  - les consoles gérées et les rappels de BIOS.

  Il ne contient que des données, mais il fait lancer un programme : il a donc le niveau code sensible pour les
  permissions.
- **Consoles ouvertes aux plugins** : le référentiel des consoles (22 aujourd'hui, `packages/shared/src/systems.ts`)
  accepte celles qu'apporte un plugin (`systems` : identifiant, nom, extensions, alias, nom utilisé pour les
  jaquettes).
- **Émulateur par console** : quand plusieurs émulateurs gèrent une console, l'utilisateur choisit celui par défaut,
  et peut en changer pour un jeu.
- **Ce que Mire fournit** : les émulateurs seulement, y compris les plus populaires pour les consoles récentes.
  Jamais de BIOS, de firmware ni de clés : Mire indique où l'utilisateur doit placer les siens.
- **Fin de téléchargement** : les actions deviennent des règles paramétrables (décompresser, ranger dans le dossier
  de la console, signaler un programme d'installation, faire venir les pistes d'un jeu sur disque).

## Télévision

- **Par liste M3U** et **par portail web** deviennent deux plugins qui servent de dépendances. Chaque pack de box les
  installe avec lui :
  - Freebox et Orange : liste M3U ;
  - SFR, B.tv et Molotov : portail web.
- **La détection de la box est retirée** : on choisit sa box dans l'assistant du premier lancement ou dans le Centre.
  Aujourd'hui, elle confond tout routeur en `192.168.1.1` avec une box SFR.
- **Le programme TV** (guide XMLTV) est un plugin à installer.

## Langues

- **L'anglais est au cœur** et sert de langue de repli. **Le français devient un pack de langue**, comme les autres
  langues (D-20, qui modifie D-11).
- Le catalogue français reste dans le dépôt de Mire (`packages/shared/src/i18n/locales/fr.json`), donc la règle
  « chaque texte en français et en anglais dans la même PR » ne change pas. La publication de Mire produit le pack
  et le publie dans le dépôt officiel.
- Au premier lancement, Mire installe d'office le pack de la langue du système s'il existe. Sans connexion, il
  démarre en anglais et installe le pack dès que possible.

## Sécurité

**Ce qui ne bouge pas** :

- la fenêtre principale garde l'isolation, la sandbox, la CSP `script-src 'self'` et le refus de toute navigation ;
- `media://` reste derrière la politique d'accès ;
- les vues web restent dans leur session séparée, sans l'API de Mire ;
- aucun plugin ne reçoit Node dans l'interface, ni un accès direct au processus principal.

**Surfaces nouvelles et parades** :

| Surface | Parade |
| --- | --- |
| Code de plugins tiers | Hôte isolé sans Node ni réseau ; permissions déclarées et appliquées par le cœur ; code sensible réservé au dépôt officiel ou à un accord explicite |
| Dépôts tiers | Index signé, empreinte de la clé vérifiée à l'ajout, sha256 par paquet, préfixe `mire.` réservé, origine affichée partout |
| Données de plugins | Schémas JSON, adresses `https:` seulement, aucun HTML interprété |
| Gestion des fichiers dans l'explorateur | Dossiers autorisés seulement, contrôle du chemin, confirmation |
| Thème cassé | Mode secours capté par le processus principal ; un thème sans code ne peut rien exécuter |
| Thème avec code | Cadre isolé sans Node ni fichiers ; Internet seulement vers les hôtes déclarés, affichés avant l'installation ; aucune action destructrice, ni accès aux réglages, aux secrets ou aux sites ouverts |
| Clés d'API des plugins | Réglages `secret` chiffrés quand le système le permet, jamais exportés en clair |

## Reprise des installations existantes

Une migration de la configuration (v8 → v9) a lieu au premier lancement après la mise à jour :

- les sections deviennent les pages prêtes à l'emploi, et une section masquée devient une page non épinglée ;
- ce qui est configuré devient des emplacements ou des réglages des plugins correspondants :
  - dossiers de la bibliothèque, sources web et M3U, consoles ;
  - services de streaming et de télévision ;
  - clé TMDB, torrents, bloqueur de publicités ;
- les plugins inclus sont déjà là, et les plugins à installer le sont dès que la connexion le permet ;
- les infos modifiées à la main, les positions de reprise et les recherches récentes sont reprises par clé
  d'élément ;
- un récapitulatif dit à l'utilisateur ce qui a été installé, et ce qui n'a pas pu l'être.

Les configurations de test des versions précédentes (`test/fixtures/config-v*.json`) servent à vérifier la
migration.

## Conséquences sur le plan

Les phases 2 et 3 d'origine sont remplacées par les phases 2 à 6 ci-dessous. Fiches détaillées :
`docs/plan/phase-2.md` à `docs/plan/phase-6.md` ; suivi : `docs/plan/BACKLOG.md`.

| Phase | Contenu | Reprend |
| --- | --- | --- |
| 2 — Éléments, tags et pages | catalogue d'éléments ; sources → éléments ; moteur de tags et d'infos ; interface `Tagger` et tags automatiques existants ; pages, regroupements et listes (processus principal et IPC) ; recherche ; migration v9 | la logique de `src/renderer/domain/`, `parseVideo`, `guessSystem` |
| 3 — Socle des plugins | SDK et manifeste ; hôte isolé (prototype, puis réalisation) ; hôte de plugins et permissions ; plugins inclus et dépendances ; dépôt `mire-addons` et sa CI ; client des dépôts ; dépôts tiers | P3-02, P3-03, P3-05, P3-06, P3-08 |
| 4 — Interface | intégration de dot-stash, palettes, navigation, contrôleurs et traduction, composants, dialogues, coquille ; puis explorateur et mode secours, moteur de thèmes et thème Mire, vue de page générique, accueil, recherche, lecteurs, vue web et télévision, jeux, Centre, réglages (dont tags et pages), éditeurs, assistant du premier lancement, retrait de l'interface historique ; thèmes avec leur propre code (cadre et API) | P2-01 à P2-07, P2-13, P2-14, P2-19 à P2-23 ; la vue de page générique remplace P2-08 à P2-12 et P2-15 à P2-18 |
| 5 — Extraction en plugins | tout ce que l'inventaire classe « inclus » ou « à installer » quitte le cœur, les données d'abord, puis le code ; continuité pour les installations existantes ; pack de langue français | P3-07, P3-10 à P3-29 |
| 6 — Nouveaux plugins | services de streaming, radios et podcasts, jeux dans le cloud, serveurs multimédias, infos en ligne, émulateurs, thèmes | — |

- Les premières tâches de la phase 4 (intégration de dot-stash, palettes, navigation) ne dépendent pas des phases 2
  et 3. Elles peuvent avancer en parallèle si besoin.
- Les tâches de dot-stash (DS-03 à DS-07) restent liées à la phase 4.
- Points d'étape :
  - **G2c** valide ce document ;
  - **G3** clôt la phase 2 ;
  - **G4** clôt la phase 3, prototype de l'hôte isolé compris ;
  - **G5** suit les premières tâches de la phase 4 (P4-01 à P4-04) ;
  - **G6** clôt la phase 4, **G7** la phase 5.

## Questions tranchées

### Q-01 — Thèmes avec leur propre code

Tranchée le 16/11/2026 (D-23). La première proposition (un cadre qui ne pouvait qu'ouvrir un élément ou une page,
chercher et revenir) était trop restrictive. Un thème avec code doit pouvoir ne ressembler en rien au thème Mire et
accéder à tout le contenu de la bibliothèque ; les seules limites gardées sont celles des niveaux de sécurité. Voir
la section « Thèmes ».
