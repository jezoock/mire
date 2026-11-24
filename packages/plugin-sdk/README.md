# @mire/plugin-sdk

Contrat public des plugins de Mire : types des contributions et du contexte d'un plugin, types des éléments et des
cibles, schéma JSON du manifeste `mire-plugin.json` et outil de validation. Le paquet ne dépend de rien.

## Installation

Le paquet n'est pas publié sur un registre : il s'installe depuis l'archive attachée à une release de Mire, comme
dot-stash (D-13).

```sh
npm install --save-dev https://github.com/jezoock/mire/releases/download/<version>/mire-plugin-sdk-<version>.tgz
```

## Contenu

| Import | Contenu |
| --- | --- |
| `@mire/plugin-sdk` | Types : `Element`, `OpenSpec`, `InfoValue`… ; contributions de code (`ElementSource`, `Tagger`, `InfoDeclaration`, `MetadataProvider`, `SearchProvider`, `SubtitleProvider`, `WebExtension`, `Downloader`) ; contexte d'un plugin (`PluginContext` : `http`, `files`, `storage`, `settings`, `log`, `events`) ; manifeste (`PluginManifest`). Fonctions : cibles (`parseTarget`, `formatTarget`, `CORE_SCREENS`), `validateManifest`. |
| `@mire/plugin-sdk/validate` | `validatePluginDir(dossier, { official })` (Node). |
| `@mire/plugin-sdk/mire-plugin.schema.json` | Schéma JSON du manifeste, pour les éditeurs (`"$schema"`). |

## Valider un plugin

```sh
npx mire-plugin validate <dossier>             # dépôt tiers
npx mire-plugin validate <dossier> --official  # dépôt officiel : préfixe « mire. » permis, textes français obligatoires
```

L'outil vérifie le manifeste (champs, listes fermées de contributions et de permissions, versions), la cohérence entre
le niveau et les contributions (un plugin `data` n'a pas de code ; extensions des vues web, moteurs de téléchargement
et permissions sensibles demandent `privileged`), la présence des fichiers déclarés (`main`, `file`) et des textes
anglais (`plugin.name`, tags, infos et réglages déclarés). Il rend 0 si le plugin est valide, 1 sinon.

## Manifeste

```json
{
  "$schema": "./node_modules/@mire/plugin-sdk/schema/mire-plugin.schema.json",
  "id": "org.exemple.radios",
  "version": "1.0.0",
  "engines": { "mire": "^1.0.0" },
  "level": "code",
  "contributes": { "sources": [{ "id": "radios", "main": "dist/index.js", "tags": ["radio"] }] },
  "permissions": { "hosts": ["api.radio-browser.info"] },
  "dependencies": {},
  "settings": [{ "key": "country", "type": "text" }],
  "i18n": "i18n/"
}
```

Les textes du plugin sont dans `i18n/en.json` (obligatoire) et les autres langues, au format des catalogues de Mire
(`meta`, `messages`) : `plugin.name`, `tags.<id>`, `infos.<id>`, `settings.<key>.label`,
`settings.<key>.options.<valeur>`.
