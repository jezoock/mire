# Inventaire des plugins

Tout ce qui ajoute quelque chose à Mire, relevé dans le code à la fin de la phase 1 et complété par les ajouts
demandés (explorateur, thèmes, streaming, infos en ligne, émulateurs). Chaque élément a été trié le 16/11/2026.
Les fichiers qu'on lance (jeu, vidéo, musique, flux) ne sont pas des plugins et ne figurent pas ici.
L'architecture qui découle de ce tri est décrite dans `docs/architecture-cible.md`.

Décisions :

- **Cœur** : fait partie de Mire, toujours présent, n'est pas un plugin ;
- **Plugin inclus** : livré avec Mire, désactivable, mis à jour par le dépôt officiel ;
- **À installer** : proposé par un dépôt, installé à la demande depuis le Centre ;
- **Retiré** : n'est plus proposé ;
- **Hors dépôt officiel** : retiré du dépôt officiel et du catalogue intégré ;
- **Mis de côté** : idée notée, pas planifiée ;

Colonne « Accès » : ce dont l'élément a besoin. ⚠ marque un accès sensible (réseau local, lancer des programmes,
vue web, supprimer des fichiers, dessiner l'interface) : un plugin qui le demande vient du dépôt officiel signé, ou
est installé après l'accord explicite de l'utilisateur. Colonne « Code actuel » : où se trouve l'élément
aujourd'hui (« à créer » pour un ajout).

Bilan : 68 éléments au cœur, 29 plugins inclus, 114 plugins à installer, 5 décisions particulières.

## Sources de la bibliothèque

Ce qui remplit Vidéos, Musique et Images.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `src-local` | Dossier sur cet ordinateur | Plugin inclus | Source | Fichiers | plugin `mire.source.local` (mire-addons ; copie incluse dans `plugins/`) ; cœur : emplacements (`library.sources`), pont des sources (src/main/plugins/bridges.ts), fichiers de l'interface historique tirés du catalogue (src/main/library/from-element.ts) |  |
| `src-smb` | Partage réseau (NAS) | Plugin inclus | Source | Fichiers, Réseau local ⚠ | src/main/library/location.ts |  |
| `src-http` | Serveur web (page d'index) | À installer | Source | Internet | src/main/library/providers/http-index.ts |  |
| `src-m3u` | Liste M3U | À installer | Source | Fichiers, Internet | src/main/library/providers/m3u.ts |  |
| `src-subs` | Sous-titres | Plugin inclus | Fonction | Fichiers, Internet | plugin `mire.subtitles` (mire-addons, P5-11b ; copie incluse dans `plugins/`) ; cœur : pont `subtitles` (src/main/plugins/bridges.ts), lecture et sous-titres des serveurs web (src/main/library/subtitles.ts) | Les sous-titres d'un serveur web restent au cœur jusqu'à P5-12 |
| `src-open` | Ouvrir un fichier | Cœur | Socle | Fichiers | src/main/library/item-from-path.ts, app/lifecycle.ts |  |
| `src-formats` | Formats reconnus | Cœur | Socle | Données seules | packages/shared (KIND, NATIVE, MIME, EXT) |  |
| `src-meta` | Infos modifiées à la main | Cœur | Socle | Fichiers | src/main/meta/user-meta.ts |  |
| `src-jellyfin` | Serveur Jellyfin ou Emby | À installer | Source | Internet, Réseau local ⚠ | à créer |  |
| `src-plex` | Serveur Plex | À installer | Source | Internet, Réseau local ⚠ | à créer |  |
| `src-dlna` | Partages DLNA de la maison | À installer | Source | Réseau local ⚠ | à créer |  |
| `src-webdav` | Stockage WebDAV (Nextcloud…) | À installer | Source | Internet | à créer |  |

## Sources de jeux

Ce qui remplit la section Jeux.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `jeux-pc` | Dossiers de jeux PC | Plugin inclus | Source | Fichiers, Lance des programmes ⚠ | plugin `mire.games.pc` (mire-addons ; copie incluse dans `plugins/`, P5-13) ; cœur : dossiers proposés (src/main/games/pc/locations.ts), lancement par la clé (src/main/games/pc/launch.ts) | Niveau `privileged` : seul niveau dont le pont accepte un élément « programme » |
| `jeux-pc-manuel` | Jeu PC ajouté à la main | Plugin inclus | Fonction | Lance des programmes ⚠ | src/main/games/pc/launch.ts, src/main/games/element-sources.ts (encore au cœur) | Reporté à P5-13b : le SDK ne donne pas à un plugin un programme choisi par l'utilisateur |
| `jeux-roms` | Dossiers de jeux d'une console | Plugin inclus | Source | Fichiers, Internet | src/main/games/roms/ |  |
| `jeux-disque` | Jeux sur disque | Plugin inclus | Fonction | Fichiers, Internet | src/main/games/disc/ |  |
| `jeux-sites` | Sites de jeux par console | À installer | Pack de données | Données seules, Vue web ⚠ | plugin `mire.game-sites` (le cœur lit les packs `romSites`, P5-07) |  |
| `jeux-marque` | Marque-pages de jeux à télécharger | Plugin inclus | Fonction | Internet, Fichiers | src/main/games/bookmarks.ts |  |
| `jeux-libres` | Jeux libres | À installer | Pack de données | Données seules, Internet | plugin `mire.free-games` (le cœur lit les packs `freeGames`, P5-07) |  |
| `jeux-suppr` | Nettoyage et suppression de jeux | Cœur | Socle | Supprime des fichiers ⚠ | src/main/games/cleanup.ts, games/delete.ts |  |
| `jeux-systemes` | Référentiel des systèmes de jeu | Cœur | Socle | Données seules | packages/shared (guessSystem) |  |
| `jeux-consoles` | Consoles créées à la main | Cœur | Fonction | Fichiers, Lance des programmes ⚠ | src/main/config (consoles) |  |
| `jeux-choix-emu` | Émulateur choisi pour une console | Cœur | Fonction | Données seules | src/main/config (consoles), à étendre |  |
| `jeux-systemes-plugins` | Consoles ajoutées par les plugins | Cœur | Socle | Données seules | packages/shared (SYSTEMS), à ouvrir |  |

## Télévision

Les façons de regarder la télé et les services connus.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `tv-m3u` | Télé par liste M3U | À installer | Source | Internet, Réseau local ⚠ | src/main/tv/channels.ts | devrait être une dépendance et splitée en deux. Une liste pour free et une pour orange qui serait installée avec le pack de donnée correspondant |
| `tv-web` | Télé par portail web | À installer | Source | Vue web ⚠ | src/main/tv/ | devrait être une dépendance et splitée en trois. Une liste pour SFR, une pour Btv et une pour molotov. qui serait installée avec le pack de donnée correspondant |
| `tv-freebox` | Freebox TV | À installer | Pack de données | Données seules, Réseau local ⚠ | src/main/config/catalogs/tv.ts |  |
| `tv-orange` | Orange TV | À installer | Pack de données | Données seules, Réseau local ⚠ | src/main/config/catalogs/tv.ts |  |
| `tv-sfr` | SFR TV | À installer | Pack de données | Données seules, Vue web ⚠, Réseau local ⚠ | src/main/config/catalogs/tv.ts |  |
| `tv-btv` | B.tv (Bouygues) | À installer | Pack de données | Données seules, Vue web ⚠ | src/main/config/catalogs/tv.ts |  |
| `tv-molotov` | Molotov | À installer | Pack de données | Données seules, Vue web ⚠ | src/main/config/catalogs/tv.ts |  |
| `tv-detect` | Détection de la box | Retiré | Fonction | Réseau local ⚠ | src/main/tv/detect.ts | utilité? probablement à retirer — Remplacé par le choix de la box (premier lancement ou Centre). |

## Services de streaming

Les sites proposés dans Streaming : adresse, couleur, recherche, alias pour « Où regarder ». Chacun deviendrait une app.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `svc-netflix` | Netflix | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.netflix` (P5-05) |  |
| `svc-prime` | Prime Video | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.prime` (P5-05) |  |
| `svc-disney` | Disney+ | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.disney` (P5-05) |  |
| `svc-canal` | Canal+ | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.canal` (P5-05) |  |
| `svc-hbomax` | HBO Max | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.hbomax` (P5-05) |  |
| `svc-appletv` | Apple TV | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.appletv` (P5-05) |  |
| `svc-paramount` | Paramount+ | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.paramount` (P5-05) |  |
| `svc-crunchyroll` | Crunchyroll | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.crunchyroll` (P5-05) |  |
| `svc-youtube` | YouTube | À installer | App (site) | Données seules, Vue web ⚠ | plugin `mire.web.youtube` (P5-05) | plugin à faire évoluer. Il faudrait pouvoir downloader les vidéos youtube pour pouvoir les auvegarder et les regarder offline. |
| `svc-francetv` | france.tv | À installer | App (site) | Données seules, Vue web ⚠ | plugin `mire.web.francetv` (P5-05) |  |
| `svc-amazonmusic` | Amazon Music | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.amazon-music` (P5-05) |  |
| `svc-spotify` | Spotify | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.spotify` (P5-05) |  |
| `svc-deezer` | Deezer | À installer | App (site) | Données seules, Vue web ⚠, Widevine | plugin `mire.web.deezer` (P5-05) |  |
| `svc-juststream` | JustStream | Hors dépôt officiel | App (site) | Données seules, Vue web ⚠ | aucun : retiré du catalogue (P5-05) ; gardé comme site ajouté à la main | à écarter du repo officiel mais prévoir un backup sur un autre repo — Ni dans le dépôt officiel, ni dans le catalogue intégré. |
| `svc-voiranime` | Voir-Anime | Hors dépôt officiel | App (site) | Données seules, Vue web ⚠ | aucun : retiré du catalogue (P5-05) ; gardé comme site ajouté à la main | à écarter du repo officiel mais prévoir un backup sur un autre repo — Ni dans le dépôt officiel, ni dans le catalogue intégré. |
| `svc-arte` | ARTE | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-tf1` | TF1+ | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-m6` | M6+ | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-adn` | ADN (Anime Digital Network) | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-rakuten` | Rakuten TV | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-mubi` | MUBI | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-pluto` | Pluto TV | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-tv5` | TV5MONDEplus | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-auvio` | Auvio (RTBF) | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-rts` | Play RTS | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-toutv` | ICI TOU.TV | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-twitch` | Twitch | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-dailymotion` | Dailymotion | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-ytmusic` | YouTube Music | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-applemusic` | Apple Music | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-tidal` | Tidal | À installer | App (site) | Données seules, Vue web ⚠, Widevine | à créer |  |
| `svc-qobuz` | Qobuz | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-soundcloud` | SoundCloud | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-radiofrance` | Radio France | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-radios` | Radios du monde | À installer | Source | Internet | à créer |  |
| `svc-podcasts` | Podcasts | À installer | Source | Internet, Fichiers | à créer |  |
| `svc-xcloud` | Xbox Cloud Gaming | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-gfn` | GeForce NOW | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `svc-boosteroid` | Boosteroid | À installer | App (site) | Données seules, Vue web ⚠ | à créer |  |
| `web-perso` | Sites ajoutés par l'utilisateur | Cœur | Fonction | Vue web ⚠ | src/main/web/entries.ts |  |
| `web-learn` | Mémoriser la recherche d'un site | Cœur | Fonction | Vue web ⚠ | src/main/web/learn-search.ts |  |
| `web-bm` | Marque-pages de sites | Cœur | Fonction | Vue web ⚠ | src/main/web/entries.ts (bm:) |  |

## Infos, images et recherche en ligne

Affiches, résumés, jaquettes, et « sur quel service regarder ».

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `info-tmdb` | TMDB | À installer | Infos en ligne | Internet | plugin `mire.tmdb` (mire-addons, P5-15) |  |
| `info-mb` | MusicBrainz et Cover Art Archive | À installer | Infos en ligne | Internet | plugin `mire.musicbrainz` (mire-addons, P5-16) |  |
| `info-libretro` | libretro-thumbnails | À installer | Infos en ligne | Internet | plugin `mire.libretro` (mire-addons, P5-16) ; cœur : jeux rassemblés par les ponts (`coreGames`, données sans chemin) |  |
| `info-steam` | Steam | À installer | Infos en ligne | Internet | plugin `mire.steam` (mire-addons, P5-16) | Réglage « Langue des fiches » propre au plugin |
| `info-ouregarder` | Où regarder | À installer | Infos en ligne | Internet | plugin `mire.tmdb` (mire-addons, P5-15) ; cœur : `src/main/search/watch.ts` (rapprochement des sites) | Même plugin que TMDB (même clé, même hôte) |
| `info-moteur` | Moteur de récupération | Cœur | Socle | Fichiers | src/main/scrape/engine.ts |  |
| `info-tvmaze` | TVmaze | À installer | Infos en ligne | Internet | à créer |  |
| `info-tvdb` | TheTVDB | À installer | Infos en ligne | Internet | à créer |  |
| `info-fanart` | fanart.tv | À installer | Infos en ligne | Internet | à créer |  |
| `info-omdb` | OMDb | À installer | Infos en ligne | Internet | à créer |  |
| `info-anilist` | AniList | À installer | Infos en ligne | Internet | à créer |  |
| `info-wikidata` | Wikipédia et Wikidata | À installer | Infos en ligne | Internet | à créer |  |
| `info-trakt` | Trakt | À installer | Infos en ligne | Internet | à créer |  |
| `info-opensubs` | OpenSubtitles | À installer | Infos en ligne | Internet, Fichiers | à créer |  |
| `info-tags-audio` | Infos des fichiers audio | Plugin inclus | Tags automatiques | Fichiers | à créer |  |
| `info-lastfm` | Last.fm | À installer | Infos en ligne | Internet | à créer |  |
| `info-discogs` | Discogs | À installer | Infos en ligne | Internet | à créer |  |
| `info-deezerapi` | Pochettes Deezer | À installer | Infos en ligne | Internet | à créer |  |
| `info-paroles` | Paroles (LRCLIB) | À installer | Infos en ligne | Internet | à créer |  |
| `info-screenscraper` | ScreenScraper | À installer | Infos en ligne | Internet | à créer |  |
| `info-igdb` | IGDB | À installer | Infos en ligne | Internet | à créer |  |
| `info-tgdb` | TheGamesDB | À installer | Infos en ligne | Internet | à créer |  |
| `info-sgdb` | SteamGridDB | À installer | Infos en ligne | Internet | à créer |  |
| `info-launchbox` | LaunchBox Games DB | À installer | Infos en ligne | Internet | à créer |  |
| `info-ra` | RetroAchievements | À installer | Infos en ligne | Internet | à créer |  |
| `info-exif` | Infos des photos | Plugin inclus | Tags automatiques | Fichiers | à créer |  |
| `info-lieux` | Lieux des photos | À installer | Infos en ligne | Internet | à créer |  |
| `info-epg` | Programme TV | À installer | Infos en ligne | Internet | à créer |  |

## Vues web et extensions des sites

Ce qui s'applique à tous les sites ouverts dans Mire.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `web-vues` | Vues web | Cœur | Socle | Vue web ⚠ | src/main/web/manager.ts, web/session.ts |  |
| `web-drm` | Widevine | Cœur | Socle | Widevine | src/main/web/drm.ts |  |
| `web-adblock` | Bloqueur de publicités | À installer | Extension des sites | Internet, Vue web ⚠ | src/main/web/adblock.ts |  |
| `web-google` | Compatibilité connexion Google | Plugin inclus | Extension des sites | Vue web ⚠ | src/main/web/google-signin.ts |  |
| `web-ua` | Identité « Chrome » des sites | Cœur | Socle | Vue web ⚠ | src/main/web/user-agent.ts |  |
| `web-raccourcis` | Raccourcis dans les sites | Cœur | Socle | Vue web ⚠ | src/main/web/shortcuts.ts |  |
| `web-popups` | Fenêtres surgissantes et liens magnet | Cœur | Socle | Vue web ⚠ | src/main/web/manager.ts (windowOpenAction) |  |

## Téléchargements

Le centre de téléchargements deviendrait aussi le centre d'installation des plugins.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `dl-centre` | Centre de téléchargements | Cœur | Socle | Fichiers, Internet | src/main/downloads/manager.ts |  |
| `dl-http` | Téléchargement HTTP | Cœur | Téléchargement | Internet, Fichiers | src/main/downloads/http.ts |  |
| `dl-torrent` | Torrents et liens magnet | À installer | Téléchargement | Internet, Fichiers | src/main/downloads/torrent.ts |  |
| `dl-archive` | Décompression .zip et .7z | Cœur | Socle | Lance des programmes ⚠, Fichiers | src/main/archive/ |  |
| `dl-fin` | Fin d'un téléchargement | Cœur | Socle | Fichiers | src/main/downloads/finish.ts | action à effectuer paramétrables |
| `dl-video` | Télécharger des vidéos de sites | Mis de côté | Téléchargement | Internet, Fichiers, Lance des programmes ⚠ | à créer | ok on met de côté — Pas planifié (conditions de YouTube). |

## Émulateurs et consoles

La boutique d'aujourd'hui. Chaque émulateur deviendrait une app installable depuis le centre.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `store-install` | Installateurs de la boutique | Cœur | Socle | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/installers/ | ok pour la fusion |
| `emu-retroarch` | RetroArch | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-duckstation` | DuckStation | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-pcsx2` | PCSX2 | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-ppsspp` | PPSSPP | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-dolphin` | Dolphin | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-melonds` | melonDS | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-azahar` | Azahar | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-cemu` | Cemu | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | src/main/store/catalog/emulators.ts |  |
| `emu-mesen` | Mesen | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-snes9x` | Snes9x | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-mgba` | mGBA | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-rmg` | Rosalie's Mupen GUI | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-ares` | ares | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-blastem` | BlastEm | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-mednafen` | Mednafen | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-flycast` | Flycast | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-mame` | MAME | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-stella` | Stella | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-dosbox` | DOSBox Staging | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-scummvm` | ScummVM | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-rpcs3` | RPCS3 | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-shadps4` | shadPS4 | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-vita3k` | Vita3K | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-xemu` | xemu | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-xenia` | Xenia | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer |  |
| `emu-switch` | Émulateur Switch | À installer | App (programme) | Internet, Fichiers, Lance des programmes ⚠ | à créer | pas grave, on propose les plus populaires. Ca reste à l'utilisateur de choisir de se mettre hors la loi en mettant les clefs et le firmware. Nous on ne fournit que l'émulateur |
| `emu-consoles-ra` | Consoles de RetroArch | À installer | Pack de données | Données seules | src/main/store/catalog/systems.ts |  |
| `emu-bios` | Rappels des BIOS | Avec chaque émulateur | Pack de données | Données seules, Fichiers | src/main/store/bios.ts, catalog/bios-hints.ts | oui avec chaque émulateur — Les rappels de BIOS font partie du plugin de chaque émulateur. |

## Lecture et programmes externes

Ce qui lit les fichiers finaux ou les confie à un autre programme.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `lec-video` | Lecteur vidéo intégré | Cœur | Lecteur | Fichiers | src/renderer/players/video.ts |  |
| `lec-audio` | Lecteur de musique | Cœur | Lecteur | Fichiers | src/renderer/players/audio.ts |  |
| `lec-images` | Visionneuse d'images | Cœur | Lecteur | Fichiers | src/renderer/players/images.ts |  |
| `lec-reprise` | Reprendre et volume | Cœur | Socle | Fichiers | src/main/usage/, renderer/players/volume.ts |  |
| `lec-externes` | Lecteurs externes mpv et VLC | Plugin inclus | App (programme) | Lance des programmes ⚠ | plugin `mire.players.external` (mire-addons ; copie incluse dans `plugins/`) ; lancement par le cœur (src/main/platform/players.ts, lecteur src/main/plugins/apps.ts) |  |
| `lec-perso` | Lecteur externe choisi à la main | Cœur | Fonction | Lance des programmes ⚠ | src/main/platform/players.ts |  |
| `lec-navigateur` | Navigateur du système | Cœur | Socle | Lance des programmes ⚠ | src/main/platform/players.ts |  |
| `lec-lanceur` | Lanceur de programmes | Cœur | Socle | Lance des programmes ⚠ | src/main/platform/launcher.ts |  |

## Pages, tags et regroupements

Remplace les sections fixes (Vidéos, Musique, Jeux…) : chaque élément porte des tags, et une page affiche ce qui porte les tags choisis.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `tag-moteur` | Moteur de tags | Cœur | Socle | Fichiers | à créer (processus principal) |  |
| `tag-fichier` | Tags selon le type de fichier | Cœur | Socle | Données seules | packages/shared (KIND, EXT) |  |
| `tag-source` | Tags selon la source | Cœur | Socle | Données seules | à créer |  |
| `tag-manuel` | Tags ajoutés à la main | Cœur | Fonction | Fichiers | à créer |  |
| `tag-admin` | Administration des tags | Cœur | Fonction | Données seules | à créer (Réglages) |  |
| `pages-moteur` | Pages | Cœur | Socle | Données seules | à créer (remplace les sections de src/renderer/app.js) |  |
| `grp-auto` | Regroupements automatiques | Cœur | Fonction | Données seules | à créer |  |
| `grp-manuel` | Regroupements à la main | Cœur | Fonction | Fichiers | à créer |  |
| `tagauto-series` | Tags auto : séries | Plugin inclus | Tags automatiques | Données seules | plugin `mire.tags.series` (mire-addons ; copie incluse dans `plugins/`) |  |
| `tagauto-films` | Tags auto : films | Plugin inclus | Tags automatiques | Données seules | plugin `mire.tags.movies` (mire-addons ; copie incluse dans `plugins/`) |  |
| `tagauto-musique` | Tags auto : musique | Plugin inclus | Tags automatiques | Fichiers | plugin `mire.tags.music` (mire-addons ; copie incluse dans `plugins/`) |  |
| `tagauto-consoles` | Tags auto : consoles | Plugin inclus | Tags automatiques | Données seules | plugin `mire.tags.consoles` (mire-addons ; copie incluse dans `plugins/`) |  |
| `tagauto-images` | Tags auto : photos | Plugin inclus | Tags automatiques | Fichiers | plugin `mire.tags.photos` (mire-addons ; copie incluse dans `plugins/`) |  |
| `tagauto-genres` | Tags auto : genres et années | Plugin inclus | Tags automatiques | Internet | src/main/scrape/ ; rien à extraire (P5-09) : l’année tirée du nom est dans `mire.tags.movies`, les genres et années en ligne viennent des plugins d’infos en ligne (P5-15, P5-16) | Pas de tag automatique : un `Tagger` est sans réseau et ne voit pas les fiches |
| `page-films` | Page Films | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.movies` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-series` | Page Séries | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.series` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-musique` | Page Musique | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.music` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-images` | Page Images | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.images` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-streaming` | Page Streaming | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.streaming` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-tv` | Page Télévision | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.tv` (mire-addons ; copie incluse dans `plugins/`) |  |
| `page-jeux` | Page Jeux | Plugin inclus | Page prête à l'emploi | Données seules | plugin `mire.page.games` (mire-addons ; copie incluse dans `plugins/`) |  |
| `ecran-accueil` | Accueil | Cœur | Écran | Données seules | src/renderer/app.js |  |
| `ecran-recherche` | Recherche globale | Cœur | Écran | Internet | src/renderer/app.js, renderer/domain/search.ts |  |
| `ecran-centre` | Centre (téléchargements, dépôts, plugins) | Cœur | Écran | Internet | src/renderer/app.js |  |
| `ecran-reglages` | Réglages | Cœur | Écran | Fichiers | src/renderer/app.js, packages/shared/settings |  |
| `ecran-menu` | Menu et coquille | Cœur | Socle | Données seules | src/renderer/app.js |  |

## Explorateur et thèmes

L'explorateur montre tout, en colonnes, sans habillage : il marche toujours. Les thèmes en sont des versions plus visuelles.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `explo-ecran` | Explorateur | Cœur | Écran | Données seules | à créer |  |
| `explo-apercu` | Panneau d'aperçu | Cœur | Fonction | Données seules | à créer |  |
| `explo-gestion` | Gérer ses fichiers | Cœur | Fonction | Fichiers, Supprime des fichiers ⚠ | à créer (politique d'accès) |  |
| `explo-lot` | Actions sur une sélection | Cœur | Fonction | Fichiers | à créer |  |
| `explo-secours` | Mode secours | Cœur | Socle | Données seules | à créer |  |
| `explo-sobre` | Affichage fixe de l'explorateur | Cœur | Socle | Données seules | à créer | on peut ajuster les couleurs uniquement, pas de trucs visuels spéciaux |
| `theme-moteur` | Moteur de thèmes | Cœur | Socle | Données seules | à créer |  |
| `theme-donnees` | Thèmes sans code | Cœur | Fonction | Données seules | à créer (format de thème) |  |
| `theme-code` | Thèmes avec leur propre code | Cœur | Fonction | Dessine l'interface ⚠ | à créer (cadre isolé) | tu peux m'expliquer plus en détail — Tranchée : oui, avec une API large (D-23). |
| `theme-mire` | Thème Mire | Plugin inclus | Thème | Données seules | src/renderer/ (phase 2) |  |
| `theme-affiches` | Thème Mur d'affiches | À installer | Thème | Données seules | à créer |  |
| `theme-salon` | Thème Salon | À installer | Thème | Données seules | à créer |  |
| `theme-compact` | Thème Liste compacte | À installer | Thème | Données seules | à créer |  |

## Couleurs, langues et manettes

Des données seules, sans code. Les anciens thèmes deviennent des palettes de couleurs, que les thèmes peuvent reprendre.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `th-ecran` | Palette Écran éteint | Cœur | Palette de couleurs | Données seules | src/renderer/styles.css |  |
| `th-jour` | Palette Plein jour | À installer | Palette de couleurs | Données seules | plugin `mire.palette.jour` (mire-addons) |  |
| `th-minuit` | Palette Minuit | À installer | Palette de couleurs | Données seules | plugin `mire.palette.minuit` (mire-addons) |  |
| `th-velours` | Palette Velours | À installer | Palette de couleurs | Données seules | plugin `mire.palette.velours` (mire-addons) |  |
| `th-contraste` | Palette Contraste élevé | Cœur | Palette de couleurs | Données seules | src/renderer/styles.css |  |
| `lang-fr` | Français | À installer | Langue | Données seules | packages/shared/src/i18n/locales/fr.json |  |
| `lang-en` | Anglais | Cœur | Langue | Données seules | packages/shared/src/i18n/locales/en.json |  |
| `lang-packs` | Autres langues | À installer | Langue | Données seules | à créer (P3-29) |  |
| `pad-xbox` | Manettes Xbox | Plugin inclus | Manette | Données seules | plugin `mire.gamepad.xbox` (mire-addons ; copie incluse dans `plugins/`) |  |
| `pad-ps` | Manettes PlayStation | Plugin inclus | Manette | Données seules | plugin `mire.gamepad.playstation` (mire-addons ; copie incluse dans `plugins/`) |  |
| `pad-nintendo` | Manettes Nintendo | Plugin inclus | Manette | Données seules | plugin `mire.gamepad.nintendo` (mire-addons ; copie incluse dans `plugins/`) |  |
| `police` | Police Archivo | Cœur | Socle | Données seules | src/renderer/fonts/ |  |

## Socle de l'application

Ce que je propose de garder hors plugins : sécurité, données, et la mécanique des plugins elle-même.

| ID | Élément | Décision | Nature | Accès | Code actuel | Note du tri |
| --- | --- | --- | --- | --- | --- | --- |
| `s-fenetre` | Fenêtre principale et ses protections | Cœur | Socle | Données seules | src/main/window/main-window.ts |  |
| `s-acces` | Politique d'accès et media:// | Cœur | Socle | Fichiers | src/main/security/, media-protocol/ |  |
| `s-config` | Configuration | Cœur | Socle | Fichiers | src/main/config/ |  |
| `s-stockage` | Dossier de données | Cœur | Socle | Fichiers | src/main/storage/ |  |
| `s-ipc` | Contrat entre l'interface et le processus principal | Cœur | Socle | Données seules | packages/shared/src/ipc.ts |  |
| `s-http` | Client HTTP | Cœur | Socle | Internet | src/main/net/http.ts |  |
| `s-i18n` | Moteur de traduction | Cœur | Socle | Données seules | src/main/i18n/, packages/shared/src/i18n/ |  |
| `s-nav` | Navigation clavier, télécommande et manette | Cœur | Socle | Données seules | src/renderer/nav/ |  |
| `s-cycle` | Cycle de vie | Cœur | Socle | Données seules | src/main/app/lifecycle.ts |  |
| `s-hote` | Hôte de plugins (à créer) | Cœur | Socle | Lance des programmes ⚠ | à créer (P3-03) |  |
| `s-depots` | Gestion des dépôts (à créer) | Cœur | Socle | Internet | à créer (P3-06, P3-08) |  |
| `s-signature` | Signatures et confiance (à créer) | Cœur | Socle | Données seules | à créer (D-08) |  |
| `s-dependances` | Dépendances entre plugins | Cœur | Socle | Données seules | à créer |  |
