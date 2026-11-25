# Phase 5 — Extraction en plugins

But : tout ce que `docs/plan/inventaire-plugins.md` classe « Plugin inclus » ou « À installer » quitte le cœur pour
devenir un plugin publié dans `jezoock/mire-addons`. À la fin, le cœur ne contient plus que les éléments classés
« Cœur » (D-14).

Prérequis : phase 3 terminée (point **G4**) ; pour chaque tâche, les tâches de la phase 2 ou 4 citées dans
« Dépend de ».

Règles communes à chaque extraction :

- le code ou les données quittent `src/main/`, `src/renderer/` ou `packages/shared` et deviennent un plugin de
  `mire-addons` (un dossier, un manifeste, ses tests, ses textes en français et en anglais) ;
- le niveau du plugin (données seules, code limité, code sensible) est le plus bas possible ; la PR le justifie ;
- un **plugin inclus** est ajouté à `resources/plugins/` (P3-05) ; un plugin **à installer** est seulement publié ;
- **continuité** : la tâche ajoute sa règle à P5-01, pour qu'une installation existante active ou installe le
  plugin et retrouve ses réglages ; aucune fonctionnalité perdue sans le dire à l'utilisateur ;
- les tests qui couvraient le code déplacé partent avec lui ; le cœur garde des tests avec un plugin factice ;
- l'inventaire est mis à jour (colonne « Code actuel » : le plugin) ;
- une PR dans `mire-addons` et une PR dans Mire si le cœur change ; le titre des deux commence par l'identifiant.

À la fin de la phase, point d'étape **G7** : bilan du cœur (P5-21).

---

## P5-01 — Continuité pour les installations existantes

- **Dépend de** : P3-07, P2-11 · **Taille** : M
- **Objectif** : une installation existante retrouve tout, même quand ses fonctions deviennent des plugins.
- **À faire** : table de règles « ce que contient la configuration → plugins à activer ou installer, réglages à
  déplacer sous `plugins.<id>` » (migration de configuration v10) ; plugins inclus activés tout de suite, plugins à
  installer mis en attente et installés dès que la connexion le permet ; récapitulatif à l'utilisateur (installé,
  en attente, impossible) ; chaque tâche de la phase ajoute sa règle et son test.
- **Critères d'acceptation** : tests avec `test/fixtures/config-v*.json` ; installation hors ligne puis en ligne.
- **Fait** : table `CONTINUITY_RULES` (`src/main/config/migrations/continuity.ts`, migration v10) et service de
  continuité (`src/main/plugins/continuity.ts`). **Ajouter sa règle (chaque tâche P5-xx)** : une entrée dans la table
  (`id` = la tâche, `plugin` du dépôt officiel, `mode` `bundled` ou `install`, `applies(config)`, `settings` à déplacer
  sous `plugins.<id>`), suivant le mode d'emploi en tête du fichier, et son test dans `test/config/continuity.test.ts`.

---

## P5-05 — Services de streaming

- **Dépend de** : P5-01 · **Taille** : M · 🧑
- **À faire** : un plugin de données par service (`webApps`) pour les 13 services du catalogue actuel
  (`src/main/config/catalogs/web.ts`) : adresse, couleur, recherche, alias pour « Où regarder », lecture en fond,
  catégorie ; JustStream et Voir-Anime sortent du catalogue intégré et ne sont pas publiés (D-21) : un utilisateur
  qui les avait configurés les garde comme sites ajoutés à la main, avec un message.
- **Critères d'acceptation** : 🧑 Netflix et Spotify ouverts depuis un plugin installé, lecture protégée comprise.

---

## P5-06 — Télévision

- **Dépend de** : P5-01, P3-05 · **Taille** : M · 🧑
- **À faire** : deux plugins qui servent de dépendances, « télévision par liste M3U » et « télévision par portail
  web » (`TvProvider`) ; un pack de données par box (Freebox et Orange avec la liste M3U ; SFR, B.tv et Molotov avec
  le portail web), chacun avec sa dépendance (D-19) ; retrait de la détection automatique de la box
  (`src/main/tv/detect.ts`) ; la box d'une installation existante est reprise par P5-01.
- **Critères d'acceptation** : installer le pack Freebox installe la liste M3U ; 🧑 chaînes d'une box réelle.

---

## P5-08 — Langue française et packs de langue

- **Dépend de** : P5-01, P4-26 · **Taille** : M
- **Objectif** : l'anglais au cœur, le français et les autres langues en packs (D-20).
- **À faire**
  - contribution `languages` : catalogue au format de P1-28 et métadonnées (code BCP 47, nom dans la langue,
    version de Mire visée, couverture) ; langue de repli : l'anglais ;
  - le catalogue français reste dans `packages/shared/src/i18n/locales/fr.json` (règle D-11 inchangée) ; la
    publication de Mire produit le pack et le publie dans le dépôt officiel ;
  - au premier lancement, installation d'office du pack de la langue du système ; sans connexion, démarrage en
    anglais puis installation dès que possible ;
  - outils du SDK : `mire-plugin i18n init <code>` (pack vide tiré du catalogue anglais) et
    `mire-plugin i18n check` (couverture, variables) ; la CI de `mire-addons` valide chaque pack.
- **Critères d'acceptation** : un système en français démarre en français après installation du pack ; désinstaller
  le pack ramène à l'anglais ; un pack incomplet affiche en anglais les textes manquants.

---

## P5-18 — Torrents

- **Dépend de** : P5-01 · **Taille** : L · 🧑
- **À faire** : le moteur WebTorrent (`Downloader`) devient un plugin de code sensible ; `parse-torrent`, le dossier
  `vendor/` et la section `overrides` de `package.json` quittent l'application pour le plugin (lire la section
  correspondante du README avant d'y toucher) ; les liens magnet et les `.torrent` sont proposés au plugin s'il est
  installé, sinon le Centre propose de l'installer.
- **Critères d'acceptation** : 🧑 téléchargement réel d'un torrent légal ; l'application se construit sans
  `vendor/`.

---

## P5-19 — Émulateurs existants

- **Dépend de** : P5-01, P4-17 · **Taille** : L · 🧑
- **À faire** : un plugin par émulateur du catalogue actuel (`src/main/store/catalog/emulators.ts`) : RetroArch
  (avec le choix de ses consoles, `emu-consoles-ra`), DuckStation, PCSX2, PPSSPP, Dolphin, melonDS, Azahar, Cemu ;
  chacun décrit installation, exécutable, arguments par console, consoles gérées et **rappels de BIOS** (D-21 : Mire
  ne fournit jamais de BIOS, de firmware ni de clés) ; les installateurs génériques restent au cœur ; un émulateur
  déjà installé est reconnu et son plugin installé par P5-01.
- **Critères d'acceptation** : 🧑 installation réelle de deux émulateurs depuis le Centre et lancement d'un jeu
  libre avec chacun.
- **Découpage** (décision de la session de pilotage, 25/11/2026) :
  - **P5-19a — Socle, RetroArch, DuckStation** (fait) : le cœur lit les contributions `apps` de genre `emulator`
    (`src/main/store/catalog/read.ts`, `src/main/plugins/emulators.ts`) des seuls plugins inclus ou du dépôt officiel :
    site, source (dernière version d'un dépôt GitHub et nom du fichier, lien d'une page de téléchargement, ou
    installateur RetroArch du cœur), programme, arguments (`{rom}` seulement), consoles, dossier des BIOS ; noms de
    fichiers et de liens en motifs simples (`*`, `?`), jamais en expression régulière. Le cœur garde les
    installateurs, la ligne de commande et la lecture des BIOS. Plugins à installer `mire.emulator.retroarch` (avec
    ses consoles, `emu-consoles-ra`) et `mire.emulator.duckstation`, de niveau `data`. Une console installée garde son
    programme et ses arguments dans la configuration et se lance sans le plugin. Continuité : `P5-19-retroarch`,
    `P5-19-duckstation` (mode `install`, si une console a été installée avec l'émulateur).
  - **P5-19b — PCSX2, PPSSPP, Dolphin, melonDS, Azahar, Cemu** : même modèle ; leurs données sont déjà dans la forme
    d'une contribution (`BUILTIN_EMULATOR_DATA`, `src/main/store/catalog/emulators.ts`) et leurs textes dans les
    catalogues (`store.emulators.<id>`, `store.bios.<id>`).

---

## Les autres extractions

| Tâche | Plugin(s) | Éléments de l'inventaire | Décision | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- | --- |
| P5-02 | Palettes Plein jour, Minuit, Velours | `th-jour`, `th-minuit`, `th-velours` | à installer | P5-01, P4-02 | S | |
| P5-03 | Pages prêtes à l'emploi | `page-films` à `page-jeux` | inclus | P5-01, P2-07 | S | |
| P5-04 | Profils de manettes Xbox, PlayStation, Nintendo | `pad-xbox`, `pad-ps`, `pad-nintendo` | inclus | P5-01, P4-03 | S | |
| P5-07 | Sites de jeux légaux, jeux libres | `jeux-sites`, `jeux-libres` | à installer | P5-01 | S | |
| P5-09 | Tags automatiques : séries, films, musique, consoles, photos, genres et années | `tagauto-*` | inclus | P5-01, P2-05, P2-06 | M | |
| P5-10 | Thème Mire | `theme-mire` | inclus | P4-11, P4-24 | S | |
| P5-11a | Socle des sources de fichiers (voir plus bas) | — | cœur | P5-01, P3-04 | M | |
| P5-11b | Sous-titres | `src-subs` | inclus | P5-11a | S | |
| P5-11c | Dossier local | `src-local` | inclus | P5-11a | M | |
| P5-11d | Partage réseau | `src-smb` | inclus | P5-11a, P5-11c | S | 🧑 |
| P5-12 | Serveur web, liste M3U | `src-http`, `src-m3u` | à installer | P5-11a | M | |
| P5-13a | Jeux PC : dossiers de jeux (voir plus bas) | `jeux-pc` | inclus | P5-01, P5-11a | M | 🧑 |
| P5-13b | Jeux PC : jeu ajouté à la main (voir plus bas) | `jeux-pc-manuel` | inclus | P5-13a | M | 🧑 |
| P5-14a | Jeux de console : dossiers d'une console (voir plus bas) | `jeux-roms` | inclus | P5-01, P5-11a | M | |
| P5-14b | Jeux de console : sources en ligne (voir plus bas) | `jeux-roms` | inclus | P5-14a, P5-12 | S | |
| P5-14c | Marque-pages de jeux (voir plus bas) | `jeux-marque` | inclus | P5-14a, P5-18 | M | |
| P5-15 | Infos en ligne TMDB et « Où regarder » | `info-tmdb`, `info-ouregarder` | à installer | P5-01, P2-06 | M | |
| P5-16 | Infos en ligne MusicBrainz, libretro, Steam | `info-mb`, `info-libretro`, `info-steam` | à installer | P5-01, P2-06 | M | |
| P5-17 | Bloqueur de publicités, connexion Google | `web-adblock` (à installer), `web-google` (inclus) | voir colonne | P5-01 | M | 🧑 |
| P5-20 | Lecteurs externes mpv et VLC | `lec-externes` | inclus | P5-01 | S | |
| P5-21 | Bilan du cœur | — | — | P5-02 à P5-20 | S | |

- **P5-12** (fait) : plugins à installer `mire.source.http` (pages d'index d'un serveur web) et `mire.source.m3u`
  (liste M3U en ligne, ou de cet ordinateur), niveau `code`, sans hôte ni réseau local (`folders` pour une liste
  locale). Socle (décision de la session de pilotage) : une adresse de `library.sources` prise par un plugin inclus ou
  officiel lui est accordée tant qu'elle reste configurée (`assignedUrls`, contexte `http`, `urlGranted`) : origine
  exacte (schéma, hôte, port), chemin de départ ou en dessous, réseau local et adresse IP permis pour elle seule,
  redirection suivie seulement vers une adresse accordée ou un hôte du manifeste ; ni identifiants dans l'adresse, ni
  séparateur encodé. Un emplacement qui désigne un fichier (liste locale) accorde aussi son dossier. Clés gardées :
  `remote:<adresse>` (fichier sous l'adresse de l'emplacement) et `m3u:<liste>|<flux>` (liste analysée). Le cœur ne
  lit plus aucun emplacement (`DEFAULT_PROVIDERS` vide) ; un emplacement qu'aucun plugin actif ne lit le dit dans son
  état (`note`, sans erreur) ; `crawlHttp` reste au cœur (`net/crawl.ts`) pour les sources en ligne d'une console
  (P5-14b, qui reprendra le même accord). `mire.source.local` 1.0.2 laisse les listes `.m3u` à `mire.source.m3u`.
  Emplacement injoignable (décision de la session de pilotage : pas de changement du SDK, le cœur respecte le contrat
  de `scan`) : l'exception levée par la source à l'analyse d'un emplacement ne désactive plus le plugin
  (`keepOnPluginError` ; délai dépassé, hôte disparu ou réponse trop grosse restent des pannes), le catalogue garde
  l'analyse précédente et l'état de la source montre « Emplacement inaccessible : <message du plugin> » (texte brut,
  500 caractères) jusqu'à la prochaine analyse réussie ; vaut aussi pour `mire.source.local` et `mire.source.network`.
- **P5-13** (découpée, décision de la session de pilotage, 24/11/2026) :
  - **P5-13a — Dossiers de jeux** (fait) : plugin inclus `mire.games.pc` (`privileged`, `folders` + `launch` : le pont
    des sources n'accepte un élément « programme » que de ce niveau). Socle : chaque dossier de `config.gameSources`
    est proposé aux sources des plugins avec le type `game` (`SourceMediaKind`), sous l'instance `game:<chemin>` ;
    mêmes règles que P5-11a. Les clés des jeux ne changent pas (`pc:<chemin>`). Le cœur lance un programme par la clé
    de son élément (`gameLaunch`) : jeu ajouté à la main avec ses arguments, sinon seulement un programme d'un dossier
    de jeux (chemin écrit puis réel), sans les arguments du plugin.
  - **P5-13b — Jeu ajouté à la main** : demande d'abord une décision de SDK, le SDK ne donnant pas à un plugin un
    programme choisi par l'utilisateur ni la liste `config.games` (nom, chemin, arguments, image, édités par les
    Réglages). Deux options : `ctx.files.requestProgram` + stockage du plugin + migration de `config.games` ; ou
    proposer les jeux ajoutés à la main comme emplacements (type à définir), la liste restant dans la configuration.
- **P5-14** (découpée, décision de la session de pilotage, 24/11/2026) :
  - **P5-14a — Dossiers d'une console** (fait) : plugin inclus `mire.games.roms` (`code`, `folders` : il liste des
    fichiers, le cœur lance l'émulateur par la clé de l'élément, `gameLaunch`). Socle : chaque dossier local d'une
    console est proposé aux sources des plugins avec le type `rom` (`SourceMediaKind`) et sa console
    (`SourceLocation.console` : identifiant, système, extensions, dossier d'images, accordé lui aussi), sous l'instance
    `rom:<console>|<chemin>`. Un plugin `code` peut rendre un élément `game` d'une console connue, sur un fichier local
    de ses dossiers accordés (vérifié aussi sur le chemin réel) ; sa clé `rom:<console>|<chemin>` n'est gardée que si
    elle vaut celle de son `open`. Le pont vérifie aussi la permission `launch` d'un élément `program`.
  - **P5-14b — Sources en ligne d'une console** : les adresses saisies par l'utilisateur ne sont pas des hôtes du
    manifeste ; demande un accord d'hôtes tiré de la configuration, décidé avec P5-12. D'ici là, le cœur les lit.
  - **P5-14c — Marque-pages de jeux** : reportée jusqu'à une extension du SDK pour les téléchargements
    (`ctx.downloads`, fin d'un téléchargement, action de l'interface vers un plugin), à décider avec P5-18.
  - **Jeux sur disque** (`jeux-disque`) : reclassés « Cœur » (formats lus par les téléchargements, la copie locale et
    le cache des jeux en ligne du cœur) ; le plugin des consoles garde sa copie de la lecture des listes `.m3u` et
    `.cue` pour cacher les disques cités.
- **P5-15** : la clé TMDB d'une installation existante devient le réglage `secret` du plugin.
- **P5-17** : les dépendances `@ghostery/*` quittent l'application ; 🧑 YouTube sans publicité.
- **P5-21** : le cœur ne contient plus que les éléments « Cœur » de l'inventaire (vérification dans la PR) ;
  `docs/architecture.md` reprend `docs/architecture-cible.md`, qui devient historique ; mesures (démarrage, mémoire)
  comparées à celles de la fin de la phase 4.

---

## P5-11 — Dossier local, partage réseau, sous-titres (découpée)

L'extraction demandait d'abord des changements du socle des plugins de code ; elle est découpée en quatre tâches
(décision de la session de pilotage, 23/11/2026).

- **P5-11a — Socle des sources de fichiers** (fait) :
  - les emplacements restent dans `config.library.sources` (`src/main/library/locations.ts`) ; le pont des sources
    (`src/main/plugins/bridges.ts`) demande `handles(location)` à chaque source active, et la première qui accepte
    reçoit `scan(location)`, une instance par emplacement (chemin ou adresse normalisés) ;
  - seuls les plugins inclus ou du dépôt officiel reçoivent ces emplacements, et un dossier seulement s'ils déclarent
    `folders` ; un dossier pris est accordé au plugin tant qu'il reste dans la bibliothèque (accord dérivé de la
    configuration : les dossiers d'une installation existante sont repris sans champ de plus dans les règles de
    continuité) ; la bibliothèque du cœur laisse au plugin l'emplacement qu'il a pris (`claimed`) ;
  - clé `local:<chemin>` gardée pour un plugin `code` si elle vaut celle de son `open.path`, dans ses dossiers
    accordés ; images locales acceptées dans ces dossiers ; les deux sont vérifiées une seconde fois sur le chemin
    réel (`keepReal`, liens symboliques refusés) ; `media://` et la politique d'accès de l'interface ne changent pas ;
  - bornes : 150 000 éléments par analyse, 10 minutes par emplacement, 150 000 fichiers pour `walk` ; option
    `skipHidden` de `walk` (SDK) ; type `SourceLocation` (SDK).
- **P5-11b — Sous-titres** : nature `subtitles` dans le SDK (`find(videoPath)`, le cœur ne transmet qu'un chemin déjà
  autorisé par sa politique d'accès ; P6-16 OpenSubtitles s'en servira), son pont, plugin inclus `mire.subtitles`
  (`code`, `folders`), règle de continuité.
- **P5-11c — Dossier local** (fait) : plugin inclus `mire.source.local` (`code`, `folders`) qui lit les dossiers de
  la bibliothèque par `ctx.files.walk` ; le cœur ne parcourt plus lui-même que les partages réseau (`networkProvider`,
  jusqu'à P5-11d) ; règle de continuité `P5-11c` (mode `bundled`, mêmes clés `local:<chemin>`) ; plugin désactivé :
  ses éléments disparaissent et reviennent à la réactivation. L'interface historique (jusqu'à P4-24) reçoit les
  fichiers d'un emplacement lu par un plugin depuis le catalogue (`library/from-element.ts`), après les analyses des
  plugins ; l'état des sources (dossier introuvable) reste calculé par le cœur. Socle : `files.walk` rend les fichiers
  sous la racine telle que donnée (un dossier atteint par un lien symbolique garde ses clés), `rescan` attend une
  analyse identique déjà en cours au lieu d'en lancer une deuxième.
- **P5-11d — Partage réseau** (fait) : plugin inclus `mire.source.network` (`code`, `folders` : un partage est lu
  comme un dossier monté par le système, `smb://…` traduit en chemin par le cœur, sans « Réseau local ») ; le cœur
  ne parcourt plus aucun dossier (`providers/local.ts` retiré ; ses tests utilisent une source factice) ; il garde le
  message d'un partage absent, vérifié pendant les analyses des plugins (une seule attente) ; règle de continuité
  `P5-11d` (mode `bundled`, mêmes clés `local:<chemin>`). Vitesse : option `details` de `walk` (SDK, `false` : chemins
  seuls, sans taille ni date), prise par les deux plugins (`mire.source.local` 1.0.1) ; `keepReal` lit les dossiers
  d'abord puis vérifie les fichiers sans attente, et ne lit les dossiers accordés sans rapport avec les fichiers que
  si l'un d'eux mène ailleurs. 🧑 Vérification sur un vrai NAS.

