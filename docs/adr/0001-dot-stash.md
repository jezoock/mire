# ADR 0001 — Intégration de dot-stash et `@mire/ui`

- **État** : proposée (P4-01), à relire au point d'étape G5.
- **Contexte** : décisions D-05 (interface avec dot-stash), D-13 (livraison par une release publique), D-03
  (dépendances minimales), D-12 (vérification du TypeScript). Version intégrée : dot-stash **0.2.0**.

## Contexte

L'interface de Mire sera reconstruite avec la librairie de composants dot-stash (`jezoock/dot-stash`) : des
composants web `ds-*` en light DOM (Stencil) et un moteur SCSS de jetons. Les composants propres à Mire (`mire-*`)
vivent dans Mire, dans le paquet `@mire/ui` (`packages/ui/`). Avant d'écrire ces composants, P4-01 prouve la chaîne
complète dans Electron, sous la CSP de la fenêtre principale (`script-src 'self'`, page chargée en `file://`), et
fixe les conventions. L'interface historique (`app.js`, `styles.css`) reste en place et cohabite avec les composants
jusqu'à son retrait (P4-24).

## Décisions

### 1. Livraison

- dot-stash est installé depuis l'archive attachée à sa release GitHub, par son adresse versionnée :
  `https://github.com/jezoock/dot-stash/releases/download/v0.2.0/dot-stash-0.2.0.tgz`. L'empreinte de l'archive est
  gardée dans `package-lock.json` ; le dépôt est public, aucun jeton n'est nécessaire (D-13).
- C'est une **dépendance de développement** : rien n'est chargé depuis `node_modules` à l'exécution. La construction
  copie ce qu'il faut dans `dist/renderer/`, seul dossier embarqué par l'installateur.
- Mettre à jour : remplacer la version dans l'adresse (`npm install --save-dev --save-exact <adresse de la nouvelle
  release>`), lire le CHANGELOG de dot-stash, puis `npm run build` et `npm run test:e2e`. Voir le README.
- Mire a son propre `sass` (1.107.1, figé) pour compiler le moteur SCSS de dot-stash, qui n'en apporte pas, et
  `@stencil/core` à la version qui construit dot-stash (4.45.2, figée).

### 2. Chargement des composants `ds-*` : le chargeur paresseux

- `scripts/build.mjs` copie la construction navigateur de dot-stash (`dist/dot-stash/` : `dot-stash.esm.js` et un
  fichier par composant, 52 fichiers, 340 Ko) dans `dist/renderer/vendor/dot-stash/`, avec sa licence.
  `index.html` la charge par `<script type="module" src="vendor/dot-stash/dot-stash.esm.js">`.
- **La CSP est inchangée.** Les modules sont des fichiers de la page (`'self'`), Electron accepte les modules ES en
  `file://`, et les styles que Stencil insère dans le document sont déjà permis (`style-src 'self' 'unsafe-inline'`).
  Aucun script en ligne, aucun `eval`.
- Le code d'un composant n'est lu qu'à sa première apparition dans la page ; au démarrage, seul le chargeur l'est.
  Les imports par composant (`dist-custom-elements`, tâche DS-07 de dot-stash) ne sont donc **pas nécessaires**.
- Un composant `ds-*` inséré par `innerHTML` (vues historiques) est défini puis rendu de façon asynchrone : un test ou
  un code qui l'utilise attend la classe `hydrated` (ou `customElements.whenDefined`).

**Mesures du démarrage** (Linux, xvfb, médianes de 10 lancements alternés, configuration minimale) :

| Mesure | Avant P4-01 | Avec P4-01 |
| --- | --- | --- |
| `DOMContentLoaded` | 102 ms | 122 ms |
| Premier affichage (`first-contentful-paint`) | 140 ms | 148 ms |
| Accueil affiché (barres de la mire dans le document) | 131 ms | 147 ms |
| Script de l'interface (`main.js`, non réduit) | 250 Ko | 278 Ko |

Le coût (≈ 15 ms) vient surtout du script de l'interface, plus gros (moteur de Stencil des `mire-*`, moteur de
traduction de la page de démonstration), et de la feuille de `@mire/ui` (59 Ko, 8 Ko compressée).

### 3. `@mire/ui` : composants `mire-*`

- Stencil 4.45.2 (celui de dot-stash), composants en **light DOM** (`shadow: false`), sortie `dist-custom-elements`
  dans `packages/ui/dist/components/` (non versionné). Stencil y intègre la seule part de son moteur que les
  composants utilisent (`externalRuntime: false` : 12 Ko avec le composant de démonstration, au lieu des 158 Ko du moteur complet).
- `src/renderer/main.js` importe `@mire/ui` et appelle `defineCustomElements()` : esbuild intègre les composants au
  script de l'interface (un seul script, toujours chargé par `script-src 'self'`). Les deux moteurs de Stencil (celui
  des `ds-*`, paresseux, et celui des `mire-*`) cohabitent sans conflit ; les `mire-*` rendent des `ds-*` dans leur
  contenu.
- **Imports d'un composant** : un composant n'importe que des modules de `packages/ui/src/` sans état (aides comme
  `utils/`), que Stencil copie dans les composants. Il n'importe **ni l'état, ni le client API, ni les contrôleurs**
  de l'interface : constaté en P4-04, Stencil intègre aux composants tout module qu'il compile, même un module de
  `@mire/ui` importé par son nom de paquet (deux exemplaires dans le script de l'interface), et refuse un module
  situé hors de `packages/ui/src/` (hors de son `rootDir`), qu'il soit importé par chemin ou par un paquet. Le lien
  avec l'interface passe par le DOM : actions par les contrôleurs (§ 8), textes en attributs, langue sur `lang`.
  (`rollupConfig.inputOptions.external` garde `@mire/*` en importations, pour un paquet que Stencil n'a pas à lire.)
- **Types des `ds-*` dans le JSX** : `src/dot-stash.d.ts` importe les types de dot-stash (dépendance déjà installée) ;
  `npm run typecheck` vérifie ainsi les attributs des `ds-*` écrits dans le JSX des `mire-*`.
- **TypeScript** : `packages/ui/tsconfig.json` hérite de `tsconfig.base.json` (décorateurs historiques et JSX de
  Stencil en plus) et `npm run typecheck` le vérifie (D-12). Stencil, qui doit produire du JavaScript, lit
  `tsconfig.stencil.json` (le même, avec émission et réécriture des extensions `.ts`). `src/components.d.ts` est
  généré par Stencil et versionné : `npm run typecheck` en a besoin sans construction préalable.
- **Styles** : pas de feuille par composant passée par Stencil (`@stencil/sass` aurait ajouté `sass-embedded`). Une
  feuille unique, `packages/ui/src/styles/index.scss`, est compilée par `scripts/build.mjs` avec `sass` et
  l'importeur de paquets Node (`pkg:dot-stash/scss/…`) dans `dist/renderer/ui/mire-ui.css`, chargée par
  `index.html`. Elle contient les jetons de dot-stash (`--ds-…` sur `:root`), les habillages du thème `default` des
  composants `ds-*` utilisés, les styles des `mire-*` (un fichier `_<composant>.scss` à côté de chaque composant)
  et ceux de la page de démonstration. Elle ne reprend ni les styles de base du thème `default` (`body`, titres,
  liens…), ni `dot-stash/dist/css/default.css` : ils changeraient l'interface historique. Les icônes dessinées sont
  intégrées à la feuille (33) ; leur licence est copiée à côté (`LICENSE-icons.txt`), comme le demande dot-stash.
- **Réglages du moteur** : le moteur SCSS ne se configure qu'à son premier chargement. Un réglage passe par un module
  de jetons (`_tokens.scss` qui fait `@forward 'pkg:dot-stash/scss/engine' with (…)`), chargé en premier par toute la
  feuille ; un `with (…)` sur un moteur déjà chargé provoque une erreur de Sass. P4-02 remplacera les jetons du thème
  `default` par ceux de l'habillage du cœur (`packages/ui/src/theme/`).

### 4. Conventions des composants `mire-*`

- Préfixe `mire-` ; un dossier par composant (`src/components/mire-<nom>/` : `mire-<nom>.tsx`, `_mire-<nom>.scss`).
- Classes à la manière de dot-stash : bloc `.mire-<nom>`, parties `.mire-<nom>__<partie>`, modificateurs
  `--<modificateur>` portés par l'élément (attribut `mods`, comme les `ds-*`, quand le composant en a).
- Événements en `camelCase` préfixés `mire` (`mireDemoChange`), avec un `detail` en objet.
- Actions : méthodes publiques (`@Method()`, donc asynchrones), appelées par `ds-trigger`
  (`target="mire-demo" action='increment:[1]'`), arguments JSON désignant les éléments par une clé stable (P4-04).
- Textes : jamais en dur dans un composant. Ils arrivent en attributs, tirés des catalogues par la page ; les
  pluriels sont des formes en JSON (`count-labels='{"one": "{count} clic", "other": "{count} clics"}'`) choisies par
  `Intl.PluralRules` dans la langue du document (`pluralLabel` de `@mire/ui/utils`).
- Couleurs, tailles, espacements : accesseurs du moteur (`ds-color()`, `ds-spacing()`, `ds-radius()`…), jamais de
  valeur en dur, pour que les palettes (P4-02) s'appliquent.

### 5. Tests

- **Logique sans DOM** (`packages/ui/src/utils/`) : `node:test`, dans `npm test` (`test/ui/`).
- **Composants** : dans Electron, le moteur réel de Mire, par Playwright (`playwright-core`, déjà utilisé par le test
  de fumée) : le test de fumée ouvre la page de démonstration, attend le chargement de chaque `ds-*`, vérifie qu'un
  `ds-trigger` appelle la méthode d'un `mire-*` au clic et à la touche Entrée (une seule fois), que l'événement
  `mire*` est émis, que la CSP est inchangée et qu'aucune erreur n'apparaît dans la console.
- **Pas de Vitest** (l'outil de dot-stash) : il faudrait `vitest`, `vite`, `@stencil/vitest`,
  `@vitest/browser-playwright` et `playwright` (avec son propre Chromium), pour tester dans un navigateur qui n'est
  pas celui de Mire. Le test dans Electron suffit tant que les composants sont peu nombreux ; à réévaluer avec les
  composants d'éléments (P4-05) si les tests de composants isolés deviennent nécessaires.

### 6. Mode `watch`

`npm run dev` (`scripts/build.mjs --watch --electron`) lance Stencil en surveillance (`packages/ui/src`), recompile
la feuille de `@mire/ui` à chaque changement d'un `.scss` du paquet, et esbuild reconstruit le script de l'interface
quand Stencil réécrit `packages/ui/dist/components/`. Comme pour le reste de l'interface : actualiser la fenêtre
(Ctrl+R).

### 7. Page de démonstration interne

Cachée (aucune entrée du menu), ouverte par l'adresse `#demo` : outils de développement (F12), puis
`location.hash = 'demo'`. Elle affiche `mire-demo` dans la vue de l'interface historique et les composants `ds-*`
utilisés par Mire dans les cinq thèmes actuels. En attendant les palettes (P4-02), chaque cadre porte le
`data-theme` d'un thème de `styles.css`, et un pont temporaire (`_demo-page.scss`) relie quelques jetons de
dot-stash aux couleurs du thème ; P4-02 le remplacera par les fichiers de palettes. Code : `src/renderer/demo/`.

### 8. Contrôleurs et actions (P4-04)

- **Un contrôleur par écran**, désigné par la balise de son composant : `mire-app` (écrans, menu, réglages de la page,
  édition, notifications), `mire-home`, `mire-page` (pages de contenus, télévision, jeux et consoles),
  `mire-explorer` (sources), `mire-search`, `mire-centre` (téléchargements, boutique, BIOS), `mire-settings`,
  `mire-player` (lecteurs), `mire-web` (vue web). Code : `src/renderer/controllers/`, une classe par fichier, avec le
  reste de l'interface (état, client API) ; tout leur est injecté (`ControllerContext`), ils se testent sous Node.
- **Les méthodes publiques sont les actions** : un verbe en camelCase (`playVideo`, `openSeries`), au plus un argument,
  un objet JSON qui désigne les éléments par une **clé stable** (`{ path }`, `{ id }`, `{ consoleId }`), jamais par leur
  position dans une liste. Les aides d'un contrôleur sont privées (`#aide`).
- **Appel** : `<ds-trigger target="mire-app" action='go:[{"section":"videos"}]'>`. Le registre
  (`controllers/registry.ts`) donne à chaque élément `mire-*` les actions de son contrôleur : un composant qui a un
  contrôleur émet `mireConnect` à sa connexion (sans rien importer de l'interface), le registre lui ajoute alors les
  méthodes. `<mire-app>` est dans `index.html` (caché, vide jusqu'à la coquille, P4-07), pour que les `ds-trigger`
  le trouvent. La cible d'un `ds-trigger` est toujours la balise d'un `mire-*` : `npm run check:actions` le vérifie,
  avec l'existence de chaque méthode.
- **Erreurs** : une action qui échoue rejette ; le registre l'attrape, l'écrit dans la console et affiche un message
  (`app.errors.actionFailed`). Les échecs attendus (réponse `{ ok: false, error }` du processus principal) gardent leur
  propre message.
- **Actions asynchrones** : pendant l'action, le `ds-trigger` qui l'a lancée porte `aria-busy="true"` et un nouveau
  clic ne la relance pas. (dot-stash n'a pas d'état « en cours » pour `ds-trigger` ; l'habillage de P4-02 pourra
  s'appuyer sur `[aria-busy="true"]`.)
- **Navigation et lecteurs** : `nav/` et `players/` reçoivent les contrôleurs à leur initialisation et appellent leurs
  méthodes (retour, rechercher, modifier, écran suivant, lecteur externe, « Reprendre », vue web) ; `app.js` ne leur
  fournit plus que ce qu'ils doivent savoir de l'affichage (boîte de dialogue ouverte, lecteur ouvert, contexte).
- **Pont temporaire** (`controllers/bridge.ts`, jusqu'à P4-24) : chaque `data-action` des vues historiques a une
  entrée qui appelle la même méthode, en traduisant `data-index` en clé stable ; ce qui ne regarde que la vue
  historique (focus après l'action, champ à vider) reste dans le pont. `npm run check:actions` vérifie que chaque
  `data-action` des gabarits a une entrée et que chaque entrée désigne une méthode existante.

### 9. Traduction de l'interface (P4-04)

`src/renderer/i18n/` : au démarrage, `api.i18nGet()` donne la langue retenue et les catalogues ; le moteur de
`@mire/shared/i18n` fournit `t()` aux contrôleurs (et aux pages qui tirent des catalogues les textes des
composants). Le service suit `api.onLanguageChange` et tient à jour `lang` sur `<html>`. Les vues historiques, en
français jusqu'à leur remplacement, sont marquées `lang="fr"` (sur `<body>`) : un lecteur d'écran les lit en
français quelle que soit la langue de l'interface, et leur rendu ne change pas.

## Conséquences

- Les composants `ds-*` sont utilisables dans n'importe quelle vue, historique ou nouvelle, sans changer la CSP.
- Le démarrage coûte environ 15 ms de plus, et l'installateur environ 430 Ko (chargeur et composants de dot-stash,
  feuille de `@mire/ui`, script de l'interface).
- `npm run build` lance Stencil (environ 1 s de plus).
- Les composants `ds-*` reçoivent leur habillage du thème `default` jusqu'à P4-02.

## Points à trancher au point G5

- Garder le test des composants dans Electron, ou adopter Vitest pour la phase des composants (P4-05).
- Contrôleurs (P4-04) : ils restent dans `src/renderer/controllers/` et se lient aux `mire-*` par le DOM (§ 8),
  plutôt que de déplacer l'état et le client API dans un paquet, que Stencil copierait dans les composants. À
  confirmer, ainsi que le découpage des contrôleurs par écran.
