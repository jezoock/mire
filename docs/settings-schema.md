# Schéma des réglages

Chaque réglage de Mire est décrit **une seule fois**, dans `@mire/shared/settings/schema`
(`packages/shared/src/settings/`). Ce schéma dit quels réglages existent, où ils sont rangés dans la
configuration (`config.json`), leur valeur par défaut et le texte affiché. Il servira :

- à construire l'écran des réglages de la phase 2 (P2-19), avec les composants `ds-field`, `ds-select`,
  `ds-toggle` de dot-stash ;
- aux addons, qui décriront leurs propres réglages de la même façon (P3-04).

Aujourd'hui, l'écran des réglages (`src/renderer/app.js`) ne s'en sert pas encore : il garde son rendu actuel
(décision D-05).

## Blocs et champs

Le schéma est une liste de **blocs**. Un bloc a un identifiant (`id`), un titre, un texte d'aide facultatif et
des **champs**.

Chaque champ a un identifiant (unique dans son bloc), un type, un libellé (`label`) et parfois une aide
(`help`). Sauf pour les blocs personnalisés, il a aussi :

- `path` : l'endroit du réglage dans la configuration, en notation pointée (`ui.home.clock`) ;
- `default` : sa valeur par défaut, la même que dans `DEFAULT_CONFIG` (les tests le vérifient).

| Type | Ce que c'est | Valeur | En plus |
| --- | --- | --- | --- |
| `text` | Texte libre | texte | `placeholder` |
| `secret` | Texte masqué (clé, jeton) | texte | `placeholder` |
| `choice` | Liste de choix | texte | `options` (`value`, `label`) ; `optionsFrom` pour des choix tirés de la configuration |
| `toggle` | Case à cocher | oui / non | |
| `path` | Programme ou dossier sur l'ordinateur, avec « Parcourir » | texte | `pick` : `program` ou `folder` ; `placeholder` |
| `list` | Liste de textes ajoutés ou retirés un à un | liste de textes | `placeholder` |
| `custom` | Bloc personnalisé | — | `component`, `paths` |

Exemple :

```ts
{
  id: 'clock',
  type: 'toggle',
  path: 'ui.home.clock',
  default: true,
  label: 'Afficher l’heure et la date',
}
```

## Blocs personnalisés

Certains réglages ne tiennent pas dans un champ simple : la grille des thèmes, les listes qu'on réordonne, les
sources, le choix du service de télévision, la boutique, les consoles… Ils sont décrits par un champ `custom`
qui désigne le composant chargé de les afficher (`component`) et liste les chemins de la configuration qu'il
modifie (`paths`). Les composants connus sont dans `SETTINGS_COMPONENTS` :

| Composant | Réglages |
| --- | --- |
| `themes` | `ui.theme` |
| `ordered-list` | `ui.home.bars`, `ui.home.services` (un champ chacun) |
| `sources` | `library.sources`, `gameSources` |
| `tv-services` | `tv.active`, `tv.services` |
| `web-sites` | `web` |
| `consoles` | `emulators` |
| `store` | `store.romsRoot` |
| `pc-games` | `games` |
| `link-sites` | `pcSites` |

## Règles

- Un chemin de configuration figure **une seule fois** dans tout le schéma, et jamais à l'intérieur d'un autre
  (`tv` et `tv.active` ensemble sont refusés).
- Chaque chemin existe dans `DEFAULT_CONFIG`, et la valeur par défaut d'un champ est celle de `DEFAULT_CONFIG`.
- Les identifiants commencent par une minuscule et ne contiennent que des lettres et des chiffres.
- `validateSettingsSchema(schema)` vérifie tout cela et rend la liste des erreurs (vide si tout va bien). Un
  addon pourra s'en servir pour vérifier ses propres réglages.

## Textes et traduction

Tant que la localisation (P1-28) n'existe pas, les libellés sont écrits en français dans le schéma. Les
identifiants des blocs, des champs et des options sont stables : chaque texte a déjà sa future clé de
catalogue, donnée par `settingsTextKey` :

- titre d'un bloc : `settings.<bloc>.title` ;
- libellé d'un champ : `settings.<bloc>.<champ>.label` (et `.help`, `.placeholder`) ;
- option d'une liste de choix : `settings.<bloc>.<champ>.options.<valeur>`.

Une fois P1-28 faite, les textes passeront dans les catalogues français et anglais sous ces clés.

## Ce qui n'est pas dans le schéma

- Les **actions** des réglages (analyser à nouveau, mettre à jour les listes du bloqueur, exporter ou importer
  la configuration…) et les **informations** (état du bloqueur, de la lecture protégée) : ce ne sont pas des
  réglages.
- L'éditeur JSON « Sites, jeux et consoles » : il modifie `web`, `games` et `emulators`, déjà décrits par leurs
  blocs personnalisés.
- Les valeurs de la configuration qu'aucun écran ne propose : `externalPlayer.args`, `browser.args`,
  `search.language`, `tv.detected`, ainsi que les données (`bookmarks`, `gameBookmarks`, `version`).
