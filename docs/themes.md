# Habillage du cœur et palettes

L'interface de Mire est habillée par l'**habillage du cœur** (`packages/ui/src/theme/`), écrit sur le moteur SCSS de
dot-stash. Ses couleurs viennent d'une **palette** : un simple fichier de jetons, sans code (D-17, P4-02). Les
**thèmes des pages** (`theme.json`, P4-11) dessinent les pages : ils choisissent une palette, des polices, un fond et
une mise en page parmi les composants de Mire. Ce document décrit les deux, et la façon dont l'habillage lit une
palette.

## Une palette

Une palette est un dossier `palettes/<id>/` qui contient deux fichiers :

- `<id>.css` : une seule règle, `[data-palette='<id>'] { … }`, qui donne une valeur aux jetons listés plus bas ;
- `palette.json` : ses métadonnées.

```json
{
  "name": "palettes.ecran",
  "background": "#1F2321",
  "scheme": "dark"
}
```

| Champ | Rôle |
| --- | --- |
| `name` | Clé de son nom dans les catalogues de textes (`palettes.<id>`, en français et en anglais). |
| `background` | Couleur de fond de la fenêtre avant l'affichage de l'interface (`#rrggbb`) : la même que `--bg`. Le processus principal la lit au lancement et à chaque changement de palette. |
| `scheme` | `dark` ou `light` : la même valeur que `color-scheme` dans le fichier de jetons. |

L'identifiant (`<id>`) ne contient que des minuscules, des chiffres et des tirets. Le réglage de l'apparence
(`ui.theme` dans la configuration) contient l'identifiant de la palette, ou `auto`.

### Palettes du cœur

Les palettes sont dans `src/renderer/palettes/`, copiées par la construction dans `dist/renderer/palettes/`.

| Id | Nom | Mode | Où |
| --- | --- | --- | --- |
| `ecran` | Écran éteint (par défaut) | sombre | cœur |
| `contraste` | Contraste élevé | sombre | cœur |
| `jour` | Plein jour | clair | plugin en P5-02 |
| `minuit` | Minuit | sombre | plugin en P5-02 |
| `velours` | Velours | sombre | plugin en P5-02 |

« Automatique » retient `jour` quand le système est en mode clair, `ecran` sinon (`AUTO_PALETTES` de
`@mire/shared`), et suit les changements du système sans recharger la page.

## Jetons qu'une palette peut définir

Toutes les couleurs sont en `#rrggbb`. La liste fait foi dans `@mire/shared` (`PALETTE_TOKENS`,
`PALETTE_OPTIONAL_TOKENS`) ; `npm test` vérifie que chaque palette du cœur la respecte.

### Obligatoires

| Jeton | Rôle |
| --- | --- |
| `color-scheme` | `dark` ou `light` (propriété CSS : barres de défilement, contrôles natifs). |
| `--bg` | Fond de la page. |
| `--bg-rail` | Fond du menu principal. |
| `--surface` | Fond des blocs (cartes, panneaux, champs). |
| `--surface-2` | Fond des boutons et des blocs dans un bloc. |
| `--line` | Bordures discrètes, séparateurs. |
| `--line-strong` | Bordures des boutons et des champs. |
| `--text` | Texte. |
| `--muted` | Texte secondaire. |
| `--ink` | Texte posé sur une barre de la mire (accueil, pastilles). |
| `--bar-white`, `--bar-yellow`, `--bar-cyan`, `--bar-green`, `--bar-magenta`, `--bar-red`, `--bar-blue` | Les sept barres de la mire : chaque section prend la sienne comme accent. |
| `--ring-mix` | Part de l'accent dans sa version lisible (`--ring`), le reste en noir : `100%` sur un fond sombre, moins sur un fond clair (`58%` pour Plein jour). |

### Facultatifs

Leur valeur par défaut est dans l'habillage (`packages/ui/src/theme/_palettes.scss`).

| Jeton | Par défaut | Rôle |
| --- | --- | --- |
| `--ring-w` | `3px` | Épaisseur de l'anneau de focus. |
| `--ring-from` | aucune | Couleur imposée à l'anneau de focus et aux textes accentués, quelle que soit la section (Contraste élevé : `#FFE600`). |
| `--mire-edge` | `0px` | Liseré autour de la mire de l'accueil (Plein jour : `1px`), dans la couleur `--line`. |
| `--mono-mix` | `100%` | Part de la couleur des monogrammes de vignettes, le reste en noir (Plein jour : `62%`). |

Une palette ne définit rien d'autre : ni règle sur un élément, ni jeton `--ds-…` du moteur.

## Comment l'habillage lit une palette

- `index.html` lie la feuille de l'habillage (`ui/mire-ui.css`), puis les palettes du cœur, dans cet ordre : à
  spécificité égale, la palette l'emporte sur les valeurs par défaut des jetons facultatifs.
- `<html data-palette="…">` désigne la palette affichée. Le **chargeur de palette** (`@mire/ui/palettes`) change cet
  attribut : la bascule est immédiate, sans rechargement. Une palette qui n'est pas liée par la page (celle d'un
  plugin, plus tard) voit sa feuille ajoutée à la première demande ; elle n'est affichée qu'une fois chargée.
- Un bloc peut porter sa propre palette (`data-palette` : aperçus des réglages, page de démonstration) : les jetons
  de la palette, et ceux du moteur qui en dérivent, s'y appliquent.
- L'habillage règle le moteur de dot-stash une fois pour toutes (`theme/_tokens.scss`) : ses couleurs
  (`$colors`, `--ds-color-…`) sont des références aux jetons des palettes (`var(--bg)`, `var(--text)`…) et à
  l'accent de la section (`var(--ring)`, calculé par `styles.css`). Les jetons du moteur qui en dépendent sont
  redéclarés là où ces valeurs changent (`body`, mini-lecteur, lecteurs plein écran, blocs `[data-palette]`).

Correspondance des couleurs du moteur :

| Couleurs de dot-stash | Jetons de Mire |
| --- | --- |
| `primary` | `--text` (action principale, comme `.btn-primary`), `--surface-2` (`light`) |
| `secondary` | `--muted`, `--line` (`light`), `--text` (`darker`) |
| `gray` (`white` → `black`) | `--bg`, `--surface`, `--surface-2`, `--line`, `--line-strong`, `--muted`, `--text` |
| `status` | barres de la mire, assombries par `--ring-mix` (`info` : bleu, `success` : vert, `warning` : jaune, `error` : rouge) |
| `input` (cases, interrupteurs) | `--line-strong`, `--line`, `--muted`, accent `--ring` une fois coché |
| focus | `--ring`, épaisseur `--ring-w` |

## L'habillage du cœur

`packages/ui/src/theme/` :

| Fichier | Contenu |
| --- | --- |
| `_tokens.scss` | Réglages du moteur : couleurs (ci-dessus), anneau de focus, police (`--font`), échelles agrandies pour la lecture à distance (texte de base à 18 px, de 15 à 56 px ; espacements de 6 à 80 px ; arrondis de Mire). Chargé en premier par toute la feuille. |
| `_base.scss` | Animations du moteur (`spin`), texte pour lecteurs d'écran, redéclaration des jetons dérivés. |
| `_palettes.scss` | Valeurs par défaut des jetons facultatifs des palettes. |
| `components/_trigger.scss` | Contrôles (`ds-trigger`) : `.ds-button` (tailles `xs` à `xl`, styles `stl-1` à `stl-3`, `rounded`, `shadow`), `.ds-link`, `.ds-control` ; anneau de focus de Mire au clavier et à la manette. |
| `index.scss` | Assemble l'habillage, avec les habillages du thème `default` de dot-stash pour les autres composants `ds-*` utilisés : ils ne lisent que les jetons du moteur, qui sont ici ceux de Mire. |

Les composants `mire-*` ont leur feuille à côté de leur code ; `packages/ui/src/styles/index.scss` assemble le tout.
L'interface historique (`styles.css`) lit directement les jetons des palettes.

## Contrastes

« Contraste élevé » est vérifiée par `npm test` (`test/ui/palettes.test.ts`), avec les rapports mesurés :

- texte et texte secondaire sur le fond et les surfaces : au moins 7:1 (12,05:1 au plus bas) ;
- anneau de focus sur le fond et les surfaces : au moins 3:1 (12,55:1 au plus bas), épaisseur 4 px ;
- bordures sur le fond et les surfaces : au moins 3:1 (4,61:1 au plus bas) ;
- couleurs des sections, en texte sur le fond et les surfaces, et sous l'encre des barres : au moins 4,5:1 (5,19:1
  au plus bas).

## Thèmes des pages (`theme.json`)

Un thème sans code (D-17) dessine les pages et l'accueil : la vue de page (`mire-page-view`) avec ses cartes, ses
rangées et ses grilles, et l'accueil (`mire-home-view`, P4-12) avec son horloge, ses barres et ses rangées. Les écrans
du cœur (Centre, Réglages, explorateur, lecteurs) et le menu gardent l'habillage du cœur et la palette des réglages.
Les thèmes avec leur propre code viendront avec P4-27 (D-23).

**Portée du thème** : le moteur habille deux hôtes, `<mire-page>` et `<mire-home>`, avec les mêmes valeurs (une portée
commune, `sharedScope` de `src/renderer/themes/engine.ts`) : palette (`data-palette`), polices, fond (`data-theme`,
propriétés CSS). Rien n'est posé sur `<mire-app>` ni sur la vue des écrans, qui affiche aussi les écrans du cœur.

Un thème est un dossier `<id>/` : son `theme.json`, et ses fichiers (polices, images, sons), désignés par des chemins
relatifs à ce dossier. Le schéma (`THEME_SCHEMA`) et la lecture (`validateTheme`, `parseTheme`) sont dans
`@mire/shared` (`theme.ts`).

```json
{
  "format": 1,
  "id": "papier",
  "name": { "key": "themes.papier.name" },
  "description": { "key": "themes.papier.description" },
  "palette": "jour",
  "fonts": { "body": { "family": "Georgia, serif" }, "heading": { "file": "fonts/titre.woff2", "family": "serif" } },
  "images": { "background": "images/fond.svg" },
  "sounds": { "move": "sons/deplacement.wav" },
  "menu": { "position": "top" },
  "home": { "layout": "grid" },
  "page": { "layout": "rows", "card": "thumbnail", "size": "l", "background": "image" }
}
```

| Champ | Rôle |
| --- | --- |
| `format` | Version du format : `1`. |
| `id` | Identifiant (minuscules, chiffres, tirets) : le nom du dossier. |
| `name`, `description` | Un texte, ou une clé des catalogues de textes (`{ "key": "themes.<id>.name" }`). |
| `palette` | Palette posée sur les pages seulement (`data-palette` de `<mire-page>`). Sans elle, les pages suivent la palette des réglages. |
| `fonts.body`, `fonts.heading` | Police du texte et des titres : un fichier du thème (`woff2`, `woff`, `ttf`, `otf`), chargé par `FontFace`, et des familles de repli (`family`), ou seulement des familles du système. |
| `images.background`, `images.logo` | Images du thème (`svg`, `png`, `jpg`, `webp`, `avif`, `gif`). |
| `sounds.move`, `sounds.select`, `sounds.back` | Sons (`ogg`, `opus`, `wav`, `mp3`, `m4a`) : `move` quand le focus passe d'une carte à l'autre, `select` à l'ouverture d'un regroupement, `back` au retour d'un niveau. |
| `menu.position` | Place du menu (`left`, `right`, `top`, `bottom`) ; elle l'emporte sur celle des réglages tant que le thème est choisi. |
| `home.layout` | Mise en page de l'accueil : `rows` (la mire en bandes, les rangées défilantes) ou `grid` (la mire en tuiles, les rangées en grilles). L'accueil suit aussi `page.card` (carte de « Reprendre » et des rangées), `page.size` et le fond `image`. |
| `page.layout` | `grid` : grilles de cartes ; `rows` : chaque regroupement du dernier niveau devient une rangée de ses premiers éléments. Une page dont le `display` vaut `rows` est toujours en rangées. |
| `page.card` | `auto` (la carte qu'indique le `display` de la page : affiches, vignettes, lignes), ou `poster`, `thumbnail`, `line`. |
| `page.size` | Taille des cartes : `s`, `m`, `l`. |
| `page.background` | `none`, `backdrop` (l'image de fond de l'élément sélectionné, en fondu) ou `image` (`images.background`, répétée). |

Un chemin qui sortirait du dossier du thème (`..`, chemin absolu, adresse, lecteur Windows, `\`) est refusé, comme
une extension qui ne correspond pas au rôle du fichier. Les familles de polices n'admettent que des lettres, chiffres,
espaces, virgules, tirets et guillemets.

### Thèmes intégrés

`src/renderer/themes/`, copiés dans `dist/renderer/themes/` : leurs fichiers sont des fichiers de la page (`'self'`
dans la CSP, qui ne change pas).

| Id | Nom | Rôle |
| --- | --- | --- |
| `mire` | Mire (par défaut) | L'apparence de Mire : grilles, carte indiquée par la page, palette des réglages, fond de l'élément sélectionné. Deviendra un plugin inclus (P5-10). |
| `papier` | Papier | Thème d'essai, très différent : palette claire, polices à empattements, rangées de vignettes, grandes cartes, menu en haut, fond dessiné, son de déplacement. |

Le réglage `ui.pageTheme` (Réglages, Apparence, « Thème des pages ») contient l'identifiant du thème ; un identifiant
inconnu revient au thème Mire. Le changement s'applique sans redémarrage.

