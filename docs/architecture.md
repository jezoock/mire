# Architecture de Mire

Document créé par la tâche P1-05 (dossier de données et stockage) ; il sera complété en P1-27.

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
| `meta/meta.json` | Infos modifiées à la main (titre, année, genre, résumé, images) | `index.js`, stockage JSON |
| `meta/img/` | Images choisies à la main | `index.js` |
| `scrape/db.json` | Infos récupérées en ligne (films, séries, jeux) et titres introuvables | moteur de récupération (`scrape/`), stockage JSON |
| `scrape/img/` | Affiches et images de fond téléchargées | moteur de récupération (`scrape/`) |
| `scrape/cache/` | Index des jaquettes et listes de jeux par console, gardés quelques jours (cache) | moteur de récupération (`scrape/`) |
| `telechargements.json` | Liste des téléchargements (en cours, terminés, en attente) | `downloads.js`, stockage JSON |
| `torrents/` | Fichiers `.torrent` gardés pour reprendre un torrent | `downloads.js` |
| `emulators/` | Émulateurs installés par la boutique, un dossier chacun | `store.js` |
| `emulators/installed.json` | Version et programme de chaque émulateur installé | `store.js`, stockage JSON |
| `adblock/moteur.bin` | Moteur compilé du bloqueur de publicités | `adblock.js` |
| `adblock/listes.json` | Date de mise à jour et état des listes de filtres | `adblock.js`, stockage JSON |
| `cache/roms/` | Jeux en ligne téléchargés pour être lancés | `index.js` |
| `bin/7za` | Copie exécutable de 7-Zip, quand l'original ne peut pas l'être (application empaquetée) | `store.js` |

Le dossier `userData` contient aussi les dossiers propres à Chromium (cache, cookies, `Local Storage`…), gérés
par Electron.

## Configuration

`src/main/config/` détient la configuration (`config.json`) ; ses types (`Config`, `WebSite`, `TvService`,
`Emulator`…) sont dans `@mire/shared`.

- `defaults.ts` (`DEFAULT_CONFIG`, valeurs admises) et `catalogs/` (`DEFAULT_TV`, `DEFAULT_WEB` : données, futur
  contenu d'addons) ;
- `migrations/` : une étape par version (`v2.ts` … `v5.ts`) et leur registre ; `migrate(brut)` rend
  `{ config, from, changed }`. Nouvelle version : ajouter `vN.ts`, l'inscrire dans `MIGRATIONS`, monter
  `CONFIG_VERSION` ;
- `normalize/` : une fonction par section ; `normalizeConfig(valeur)` rend toujours une configuration complète ;
- `merge.ts` : import « compléter » ;
- `service.ts` : `createConfigService({ file })`, seul point d'accès dans le processus principal. `load()` au
  démarrage (fichier absent → valeurs par défaut écrites ; illisible → mis de côté en `config.json.illisible-<date>`) ;
  `get()` ; `update(mutateur)` et `replace(config)` normalisent, écrivent (stockage JSON, écriture immédiate) puis
  appellent chaque abonné de `onChange((suivante, précédente) => …)` une fois. Les modules reçoivent `get` (et
  `replace` pour ceux qui enregistrent) ; les handlers IPC passent par `ctx.config`.

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
  (`before-quit`), `index.js` suspend la sortie, attend `flush()` de `scrape/db.json` et `telechargements.json`
  deux secondes au plus (`flushWithin`), puis quitte ;
- le format est celui d'avant : `JSON.stringify(valeur, null, space)`, en UTF-8, sans saut de ligne final.

| Fichier | Indentation | Écriture |
| --- | --- | --- |
| `scrape/db.json` | aucune | différée (400 ms) |
| `telechargements.json` | 1 | différée (300 ms) ; la liste est relevée au moment de l'écriture |
| `emulators/installed.json` | 2 | immédiate |
| `meta/meta.json` | 2 | immédiate |
| `adblock/listes.json` | aucune | immédiate |

Ordre de grandeur (mesuré sous Linux, SSD) : un `scrape/db.json` de 5 000 fiches pèse 3,6 Mo ; `JSON.stringify`
prend environ 13 ms (toujours sur le processus principal), l'écriture sur le disque environ 11 ms (hors du
processus principal grâce à l'écriture différée asynchrone).
