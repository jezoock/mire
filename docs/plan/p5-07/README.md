# P5-07 — Création des deux plugins dans `mire-addons`

Ce dossier est la commande passée à la session qui travaille dans `jezoock/mire-addons`. Le cœur de Mire (cette PR)
lit les contributions `packs` ; les deux plugins ci-dessous ne contiennent que des données. Les fichiers
`jeux-sites.data.json` et `jeux-libres.data.json` sont les données exactes de `main` avant cette PR : à copier tels
quels dans les plugins (sans le champ qu'ils n'ont pas, voir plus bas). Rien d'autre n'est à reprendre : les tests de
`rom-sites.ts` partent avec le plugin (voir « Tests »).

D-21 : Mire ne fournit jamais de BIOS, de firmware, de clés ni de jeux non libres. Ne rien ajouter aux listes.

## Plugin `mire.game-sites` (« Sites de jeux » / « Game sites »)

- `plugins/mire.game-sites/mire-plugin.json` : `version` `1.0.0`, `engines.mire` `^1.0.0`, `level` `data`, aucune
  permission, `i18n` `i18n/`, `contributes.packs: [{ "id": "game-sites", "file": "packs/game-sites.json" }]`.
- `packs/game-sites.json` : copie de `jeux-sites.data.json`. Forme lue par le cœur :
  `{ "kind": "romSites", "systems": { "<nom libretro du système>": [ { "name", "url", "search" } ] } }`
  (`search` : adresse `https:` contenant `{q}`, ou `""`). Limites : 64 systèmes, 8 sites par système, nom 80 caractères
  sans `<` ni `>`, adresses `https:` de 500 caractères au plus, sans identifiants. Un élément hors règle est ignoré.
- `i18n/fr.json` et `i18n/en.json` : `plugin.name` (« Sites de jeux » / « Game sites »), `plugin.description` (sites
  légaux — homebrew, domaine public, jeux récents — proposés pour chaque console par « Ajouter des jeux »).
- Permissions : aucune (le cœur ouvre ces sites dans sa vue web, comme avant). Le niveau est le plus bas : `data`.
  Le tableau de l'inventaire note « Vue web ⚠ » : si le SDK exige une permission pour des adresses, la déclarer
  sans plus (hôtes : `hh.gbdev.io`, `db.universal-team.net`, `pdroms.de`, `itch.io`) et le dire dans la PR.
- Tests (`plugins/mire.game-sites/test/`) : fichier conforme à la forme ci-dessus ; adresses toutes `https:` ; chaque
  système est un identifiant de `SYSTEMS` (`@mire/shared`) ou de la liste du plugin ; reprendre les cas de l'ancien
  `test/games/rom-sites.test.js` de Mire (visible dans l'historique, `git show main:test/games/rom-sites.test.js`).

## Plugin `mire.free-games` (« Jeux libres » / « Free games »)

- `plugins/mire.free-games/mire-plugin.json` : mêmes champs ; `contributes.packs: [{ "id": "free-games", "file": "packs/free-games.json" }]`.
- `packs/free-games.json` : copie de `jeux-libres.data.json`. Forme : `{ "kind": "freeGames", "games": [ { "id", "name",
  "system", "author", "basedOn"?, "url", "file", "desc" } ] }` — `id` en minuscules, chiffres et tirets (40 au plus) ;
  `system` : identifiant du système RetroArch de la boutique (`nes`, `gb`, `gbc`, `md`…) ; `file` : un nom de fichier
  simple avec extension (ni `/`, ni `\`, ni `..`) ; `url` : `https:` ; `desc` : clé d'un texte du plugin. 64 jeux au plus.
- Textes (`messages.freeGames.<id>.desc`), repris de l'ancien catalogue de Mire :

| id | fr | en |
|---|---|---|
| nova | Plateformes : un écureuil qui copie les pouvoirs de ses ennemis. | Platformer: a squirrel who copies the powers of its enemies. |
| thwaite | Défendez vos villages contre une pluie de missiles. | Defend your villages from a rain of missiles. |
| croom | Jeu de mémoire : retrouvez les paires de cartes. | Memory game: find the matching pairs of cards. |
| libbet | Réflexion : passez sur chaque case du sol sans rester coincé. | Puzzle: step on every tile of the floor without getting stuck. |
| ucity | Construisez et gérez votre ville, dans l’esprit de SimCity. | Build and run your own city, in the spirit of SimCity. |
| cavestory | Le grand jeu d’aventure gratuit, adapté pour la Mega Drive, en français. | The great free adventure game, ported to the Mega Drive, in French. |

  Plus `plugin.name` (« Jeux libres » / « Free games ») et `plugin.description` (jeux récents créés pour de vieilles
  consoles, distribués gratuitement par leurs auteurs).
- Permissions : aucune (le téléchargement est fait par le cœur, vers le dossier de jeux de la console). Hôte de tous
  les jeux : `github.com`.
- Tests : forme, adresses `https:`, noms de fichiers simples, `desc` présent dans `fr.json` et `en.json` pour chaque jeu,
  extension du fichier connue du système (reprend l'ancien test « chaque jeu libre vise un système RetroArch »).

## Vérifier avec le cœur

`npm run validate`, `npm test`, `npm run index:test` dans `mire-addons`. Pour l'essai à la main : copier un plugin dans
le dossier des plugins de Mire, l'activer, puis « Ajouter des jeux » d'une console (sites) ou la page Boutique (jeux).
