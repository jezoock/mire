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
| `config.json` | Configuration (bibliothèque, consoles, sites, TV, interface…) | `index.js` (service de configuration en P1-06) |
| `config.json.illisible-<date>` | Configuration illisible mise de côté au démarrage | `index.js` |
| `meta/meta.json` | Infos modifiées à la main (titre, année, genre, résumé, images) | `index.js`, stockage JSON |
| `meta/img/` | Images choisies à la main | `index.js` |
| `scrape/db.json` | Infos récupérées en ligne (films, séries, jeux) et titres introuvables | `scraper.js`, stockage JSON |
| `scrape/img/` | Affiches et images de fond téléchargées | `scraper.js` |
| `scrape/cache/` | Index des jaquettes et listes de jeux par console, gardés quelques jours (cache) | `scraper.js` |
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

## Stockage JSON

`createJsonStore(fichier, { defaults, debounceMs, onCorrupt, onError, space })` dans
`src/main/storage/json-store.ts` est la seule façon de lire et d'écrire un fichier de données JSON :

- **lecture tolérante** (`load()`) : fichier absent → valeurs par défaut ; fichier illisible (JSON invalide, ou
  contenu qui n'est pas un objet) → `onCorrupt(erreur, fichier)` puis valeurs par défaut. Les clés lues complètent
  les valeurs par défaut ;
- **écriture atomique** : le JSON est écrit dans `<fichier>.<pid>.tmp`, mis sur le disque (`fsync`), puis renommé
  par-dessus l'ancien. Une coupure pendant l'écriture laisse l'ancien fichier intact. Sous Windows, un renommage
  refusé un instant (antivirus, indexation) est réessayé ;
- **écriture différée** (`debounceMs`) : les modifications rapprochées donnent une seule écriture ; un échec est
  signalé à `onError` (journal par défaut). Sans délai, l'écriture est immédiate et une erreur remonte à l'appelant ;
- **`flush()`** écrit tout de suite l'écriture en attente ; `index.js` l'appelle à la fermeture de l'application
  (`before-quit`) pour `scrape/db.json` et `telechargements.json` ;
- le format est celui d'avant : `JSON.stringify(valeur, null, space)`, en UTF-8, sans saut de ligne final.

| Fichier | Indentation | Écriture |
| --- | --- | --- |
| `scrape/db.json` | aucune | différée (400 ms) |
| `telechargements.json` | 1 | différée (300 ms) ; la liste est relevée au moment de l'écriture |
| `emulators/installed.json` | 2 | immédiate |
| `meta/meta.json` | 2 | immédiate |
| `adblock/listes.json` | aucune | immédiate |

Les écritures sont synchrones : elles sont petites et rares, et un `flush()` à la fermeture ne peut pas croiser
une écriture en cours.
