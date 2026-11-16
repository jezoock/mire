# Phase 6 — Nouveaux plugins

But : les plugins ajoutés au tri du 16/11/2026 (`docs/plan/inventaire-plugins.md`, éléments « à créer ») :
services de streaming, radios et podcasts, jeux dans le cloud, serveurs multimédias, infos en ligne, émulateurs,
thèmes. Ils sont publiés dans `jezoock/mire-addons`.

Prérequis : phase 3 terminée (point **G4**), et la tâche de la phase 5 qui a posé le modèle de la même famille
(colonne « Dépend de »). Les tâches de la phase 6 peuvent commencer avant la fin de la phase 5, dans l'ordre que tu
choisis.

Règles communes :

- une PR dans `mire-addons` par tâche ; une PR dans Mire seulement si le cœur doit changer (c'est alors dit dans la
  ligne de la tâche) ;
- le niveau le plus bas possible, les hôtes Internet déclarés un par un, les textes en français et en anglais ;
- les tests n'appellent jamais le vrai service : réponses enregistrées, rejouées en CI ;
- un service qui demande une clé ou un compte le dit dans sa fiche du Centre, et fonctionne avec la clé de
  l'utilisateur (réglage `secret`) ; aucune clé n'est publiée dans le dépôt ;
- **émulateurs** : Mire ne fournit jamais de BIOS, de firmware ni de clés (D-21) ; chaque plugin d'émulateur porte
  ses rappels de BIOS et les consoles qu'il ajoute (`systems`) ;
- 🧑 : essai réel sur une vraie machine (service en ligne, émulateur, manette).

## Tags automatiques inclus

| Tâche | Plugin(s) | Éléments | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- |
| P6-01 | Infos des fichiers audio : artiste, album, piste, pochette (ID3, Vorbis, MP4) | `info-tags-audio` | P5-09 | M | |
| P6-02 | Infos des photos : date, appareil, position (EXIF) | `info-exif` | P5-09 | S | |

- **P6-01** : demande une bibliothèque de lecture des tags, à justifier (D-03) ; regroupement par artiste et album
  d'après les tags, plus seulement d'après les dossiers.

## Streaming, radios, podcasts et jeux dans le cloud

| Tâche | Plugin(s) | Éléments | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- |
| P6-03 | ARTE, TF1+, M6+, TV5MONDEplus, Auvio, Play RTS, ICI TOU.TV | `svc-arte`, `svc-tf1`, `svc-m6`, `svc-tv5`, `svc-auvio`, `svc-rts`, `svc-toutv` | P5-05 | S | 🧑 |
| P6-04 | ADN, Rakuten TV, MUBI, Pluto TV, Twitch, Dailymotion | `svc-adn`, `svc-rakuten`, `svc-mubi`, `svc-pluto`, `svc-twitch`, `svc-dailymotion` | P5-05 | S | 🧑 |
| P6-05 | YouTube Music, Apple Music, Tidal, Qobuz, SoundCloud, Radio France | `svc-ytmusic`, `svc-applemusic`, `svc-tidal`, `svc-qobuz`, `svc-soundcloud`, `svc-radiofrance` | P5-05 | S | 🧑 |
| P6-06 | Xbox Cloud Gaming, GeForce NOW, Boosteroid | `svc-xcloud`, `svc-gfn`, `svc-boosteroid` | P5-05 | M | 🧑 |
| P6-07 | Radios du monde (annuaire Radio Browser) | `svc-radios` | P5-11 | M | |
| P6-08 | Podcasts (abonnement par flux, épisodes hors ligne) | `svc-podcasts` | P5-11 | M | |

- **P6-06** : change le cœur : un réglage par site pour **transmettre la manette au site** au lieu de la garder pour
  Mire (aujourd'hui les raccourcis des vues web captent ses boutons), F9 restant le retour à Mire.

## Serveurs multimédias

| Tâche | Plugin(s) | Éléments | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- |
| P6-09 | Serveur Jellyfin ou Emby | `src-jellyfin` | P5-12 | M | 🧑 |
| P6-10 | Serveur Plex | `src-plex` | P5-12 | M | 🧑 |
| P6-11 | Partages DLNA de la maison (code sensible : réseau local) | `src-dlna` | P5-12 | M | 🧑 |
| P6-12 | Stockage WebDAV (Nextcloud…) | `src-webdav` | P5-12 | S | |

## Infos en ligne

| Tâche | Plugin(s) | Éléments | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- |
| P6-13 | TVmaze, TheTVDB, AniList | `info-tvmaze`, `info-tvdb`, `info-anilist` | P5-15 | M | |
| P6-14 | fanart.tv, OMDb, Wikipédia et Wikidata | `info-fanart`, `info-omdb`, `info-wikidata` | P5-15 | M | |
| P6-15 | Trakt (synchronisation de ce qu'on a vu, à activer explicitement) | `info-trakt` | P5-15 | M | |
| P6-16 | OpenSubtitles | `info-opensubs` | P5-11 | M | |
| P6-17 | Last.fm, Discogs, pochettes Deezer | `info-lastfm`, `info-discogs`, `info-deezerapi` | P5-16 | M | |
| P6-18 | Paroles synchronisées (LRCLIB) | `info-paroles` | P5-16, P4-15 | M | |
| P6-19 | ScreenScraper | `info-screenscraper` | P5-16 | M | |
| P6-20 | IGDB, TheGamesDB, SteamGridDB | `info-igdb`, `info-tgdb`, `info-sgdb` | P5-16 | M | |
| P6-21 | LaunchBox Games DB (base téléchargée, hors ligne) | `info-launchbox` | P5-16 | M | |
| P6-22 | RetroAchievements | `info-ra` | P5-16 | M | |
| P6-23 | Lieux des photos (OpenStreetMap, à activer explicitement) | `info-lieux` | P6-02 | S | |
| P6-24 | Programme TV (guide XMLTV) | `info-epg` | P5-06 | M | |

- **P6-18** : change le cœur : le lecteur de musique affiche des paroles synchronisées quand une info `lyrics` existe.
- **P6-21** : vérifier d'abord les conditions de réutilisation de la base ; la tâche s'arrête si elles ne le
  permettent pas.
- **P6-24** : change le cœur : la page Télévision affiche « maintenant » et « ensuite » quand les chaînes portent ces
  infos.

## Émulateurs

| Tâche | Plugin(s) | Éléments | Consoles ajoutées au référentiel | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- | --- |
| P6-25 | Mesen, Snes9x, mGBA, Rosalie's Mupen GUI | `emu-mesen`, `emu-snes9x`, `emu-mgba`, `emu-rmg` | WonderSwan | P5-19 | M | 🧑 |
| P6-26 | ares, BlastEm, Mednafen, Flycast | `emu-ares`, `emu-blastem`, `emu-mednafen`, `emu-flycast` | Mega-CD, 32X, Lynx, Virtual Boy, NAOMI, Atomiswave | P5-19 | M | 🧑 |
| P6-27 | MAME, Stella, DOSBox Staging, ScummVM | `emu-mame`, `emu-stella`, `emu-dosbox`, `emu-scummvm` | arcade, DOS, ScummVM | P5-19 | M | 🧑 |
| P6-28 | RPCS3, shadPS4, Vita3K | `emu-rpcs3`, `emu-shadps4`, `emu-vita3k` | PS3, PS4, PS Vita | P5-19 | M | 🧑 |
| P6-29 | xemu, Xenia, émulateur Switch | `emu-xemu`, `emu-xenia`, `emu-switch` | Xbox, Xbox 360, Switch | P5-19 | M | 🧑 |

- **P6-28 et P6-29** : chaque plugin dit d'où vient ce que l'utilisateur doit fournir (logiciel système téléchargeable
  chez Sony, fichiers tirés de sa propre console) ; l'émulateur Switch retenu est choisi au moment de la tâche parmi
  les plus suivis (D-21).

## Thèmes

| Tâche | Plugin(s) | Éléments | Dépend de | Taille | 🧑 |
| --- | --- | --- | --- | --- | --- |
| P6-30 | Thèmes Mur d'affiches, Salon, Liste compacte (sans code ou avec code, au choix de la tâche) | `theme-affiches`, `theme-salon`, `theme-compact` | P4-25, P4-28 | M | |
