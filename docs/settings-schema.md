# Schéma des réglages

Chaque réglage de Mire est décrit **une seule fois**, dans `@mire/shared/settings/schema`
(`packages/shared/src/settings/`). Ce schéma dit quels réglages existent, où ils sont rangés dans la
configuration (`config.json`), leur valeur par défaut et la clé de catalogue de chaque texte. Il sert :

- à construire l'écran Réglages (P4-20, `src/renderer/settings/`, composant `mire-settings-view`) : chaque bloc
  devient un panneau, chaque champ un contrôle de dot-stash (`ds-field`, `ds-select`, `ds-toggle`), enregistré dès
  qu'il change ;
- aux plugins, qui décrivent leurs propres réglages de la même façon (P3-04, `settings` du manifeste) : l'écran
  Réglages leur donne un panneau chacun, avec leurs textes (`settings.<clé>.label` dans les textes du plugin).

## Blocs et champs

Le schéma est une liste de **blocs**. Un bloc a un identifiant (`id`), un titre, un texte d'aide facultatif et
des **champs**.

Chaque champ a un identifiant (unique dans son bloc), un type, un libellé (`label`) et parfois une aide
(`help`). Ces textes sont des clés de catalogue (voir « Textes et traduction »). Sauf pour les blocs personnalisés, il a
aussi :

- `path` : l'endroit du réglage dans la configuration, en notation pointée (`ui.home.clock`) ;
- `default` : sa valeur par défaut, la même que dans `DEFAULT_CONFIG` (les tests le vérifient).

| Type | Ce que c'est | Valeur | En plus |
| --- | --- | --- | --- |
| `text` | Texte libre | texte | `placeholder` |
| `secret` | Texte masqué (clé, jeton) | texte | `placeholder` |
| `choice` | Liste de choix | texte | `options` (`value`, `label`) ; `optionsFrom` pour des choix tirés de la configuration ; `buttons` pour un affichage en boutons |
| `toggle` | Case à cocher | oui / non | |
| `path` | Programme ou dossier sur l'ordinateur, avec « Parcourir » | texte | `pick` : `program` ou `folder` ; `placeholder` |
| `list` | Liste de textes ajoutés ou retirés un à un | liste de textes | `placeholder` |
| `custom` | Bloc personnalisé | — | `component`, `paths` |

Dans `schema.ts`, un champ s'écrit sans ses textes : `help: true` et `placeholder: true` disent seulement qu'il en
a, et `options` ne donne que les valeurs. La fonction `keyed` y met les clés. Exemple :

```ts
{ id: 'clock', type: 'toggle', path: 'ui.home.clock', default: true }
// devient
{ id: 'clock', type: 'toggle', path: 'ui.home.clock', default: true, label: 'settings.home.clock.label' }
```

`optionsFrom` ajoute des choix tirés de l'état de Mire : `web-sites` (un choix `web:<id>` par site de streaming) et
`languages` (les langues disponibles, sous leur propre nom).

## Blocs personnalisés

Certains réglages ne tiennent pas dans un champ simple : la grille des thèmes, les listes qu'on réordonne, les
sources, le choix du service de télévision, la boutique, les consoles… Ils sont décrits par un champ `custom`
qui désigne le composant chargé de les afficher (`component`) et liste les chemins de la configuration qu'il
modifie (`paths`). Les composants connus sont dans `SETTINGS_COMPONENTS` :

| Composant | Réglages |
| --- | --- |
| `themes` | `ui.theme` (palette), `ui.pageTheme` (thème des pages) |
| `ordered-list` | `ui.home.rows` (rangées, barres de la mire, sites épinglés) ; `catalog.metadataProviders` (ordre des fournisseurs d'infos) |
| `sources` | `library.sources`, `gameSources` |
| `tv-services` | `tv.active`, `tv.services` |
| `web-sites` | `web` |
| `consoles` | `emulators` |
| `store` | `store.romsRoot` |
| `pc-games` | `games` |
| `link-sites` | `pcSites` |

À l'écran (P4-20), `sources`, `tv-services`, `web-sites`, `pc-games` et `link-sites` sont des listes d'éléments avec
« Retirer » et de quoi ajouter (le service de télévision se choisit parmi les autres) ; `store` est un champ de
dossier ; `consoles` mène à l'onglet « Consoles » du Centre, où elles se créent et se modifient. Les fournisseurs
d'infos des plugins actifs rejoignent la liste de `catalog.metadataProviders`. Un choix (`choice`) marqué `buttons: true`
(peu d'options aux noms courts : position du menu, langue des infos) s'affiche en boutons (`ds-toggle-group`)
plutôt qu'en liste de choix.

## Règles

- Un chemin de configuration figure **une seule fois** dans tout le schéma, et jamais à l'intérieur d'un autre
  (`tv` et `tv.active` ensemble sont refusés).
- Chaque chemin existe dans `DEFAULT_CONFIG`, et la valeur par défaut d'un champ est celle de `DEFAULT_CONFIG`. Seule
  exception : un bloc personnalisé `optional` (`catalog.metadataProviders`), dont le chemin n'existe qu'une fois
  changé.
- Chaque texte est une clé de catalogue (`settings.…`), présente en français et en anglais (les tests le vérifient).
- Les identifiants commencent par une minuscule et ne contiennent que des lettres et des chiffres.
- `validateSettingsSchema(schema)` vérifie tout cela et rend la liste des erreurs (vide si tout va bien). Un
  addon pourra s'en servir pour vérifier ses propres réglages.

## Textes et traduction

Les textes du schéma sont des clés de catalogue (type `SettingsText`), tirées des identifiants par `settingsTextKey` ;
leurs textes sont dans les catalogues de Mire (`@mire/shared/i18n`, section `settings`), en français et en anglais :

- titre et aide d'un bloc : `settings.<bloc>.title`, `settings.<bloc>.help` ;
- libellé d'un champ : `settings.<bloc>.<champ>.label` (et `.help`, `.placeholder`) ;
- option d'une liste de choix : `settings.<bloc>.<champ>.options.<valeur>` (`empty` pour la valeur vide).

`settingsTextKeys()` donne toutes les clés du schéma.

## Ce qui n'est pas dans le schéma

- Les **actions** des réglages (analyser à nouveau, mettre à jour les listes du bloqueur, exporter ou importer
  la configuration…) et les **informations** (état du bloqueur, de la lecture protégée) : ce ne sont pas des
  réglages.
- L'éditeur JSON « Sites, jeux et consoles » : il modifie `web`, `games` et `emulators`, déjà décrits par leurs
  blocs personnalisés.
- Les valeurs de la configuration qu'aucun écran ne propose : `externalPlayer.args`, `browser.args`, `tv.detected`,
  ainsi que les données (`bookmarks`, `gameBookmarks`, `version`).
- `ui.home.recent`, `ui.home.bars` et `ui.home.services` : ceux de l'interface historique. Les rangées de l'accueil
  (`ui.home.rows`, P4-12) les remplacent ; `ui.home.recent` suit la présence de la rangée « Reprendre ».
