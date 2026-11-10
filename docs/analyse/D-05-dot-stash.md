# D-05 — Interface : intégrer dot-stash

État : **✅ décidée le 10/11/2026** (réponses en fin de document). La phase 2 est réécrite en conséquence
(`docs/plan/phase-2.md`). Librairie étudiée : `jezoock/dot-stash` 0.1.0 (10 novembre 2026).

## Ce qu'est dot-stash

- Des composants web `ds-*` construits avec Stencil 4.45, **en light DOM** (pas de Shadow DOM), avec des classes
  simples (`ds-block`, `ds-block__body`, `--modifier`) : une feuille de style ordinaire peut les habiller.
- Un toolkit de thèmes SCSS : un moteur (jetons, fonctions, mixins) et des thèmes compilés en une feuille globale.
  Les jetons sont écrits en propriétés CSS (`--ds-color-primary-base`…) et **se changent à l'exécution**, sans
  recompiler.
- Aucune dépendance à l'exécution, licence MIT, accessibilité travaillée (motifs WAI-ARIA, focus, mouvement réduit),
  textes des composants traduisibles (gabarits passés en attributs, pluriels par `Intl.PluralRules`).
- Composants : alert, badge, block, breadcrumb, combo, field, grid, heading, icon (Lucide), loader, modal, nav,
  pagination, panel / panel-group (onglets, accordéons), select, sidebar, slider (carrousel), text, title, title-bar,
  toaster, toggle / toggle-group, tooltip, **trigger**, ajax, back-to-top, responsive.
- Testé sous Chromium, ce qui est exactement le moteur de Mire (Electron) : aucune dégradation à prévoir.

## Ce que ça change pour Mire

**Le principal risque de la phase 2 disparaît.** La navigation au clavier et à la manette de Mire cherche les
éléments focalisables dans le document : en light DOM, elle continue de fonctionner sur les composants, sans service
de focus à réinventer. Les aides de focus de dot-stash (ce qui peut prendre le focus, hors éléments masqués ou
inertes) peuvent même servir à choisir les candidats.

**Toutes les actions passent par `ds-trigger`** (consigne du 10/11/2026). `ds-trigger` appelle une méthode d'un
élément cible, avec des arguments JSON, et porte le style du bouton :

```html
<ds-trigger type="button" mods="stl-1" target="mire-videos" action='play:["v:/films/Intouchables.mkv"]'>Lire</ds-trigger>
<ds-trigger target="mire-app" action='go:["games"]'><mire-tile …></mire-tile></ds-trigger>
```

Conséquences :

- les ~120 actions du `switch` actuel deviennent les **méthodes publiques de quelques éléments contrôleurs**
  (l'application, une section, le lecteur…), ce qui remplace le registre d'actions prévu en P1-25 ;
- les arguments désignent les éléments par une **clé stable** (chemin, identifiant de console), jamais par leur rang
  dans une liste (même logique que P1-07) ;
- un thème n'habille qu'un seul contrôle (`.ds-button`, `.ds-link`, `.ds-control` et leurs modificateurs) : les
  thèmes, et les thèmes-addons, deviennent beaucoup plus simples ;
- `ds-trigger` gère lui-même Entrée et Espace : le routeur de touches de Mire ne doit pas cliquer une seconde fois ;
  le bouton A de la manette déclenche un clic sur l'élément focalisé.

**Thèmes.** Proposition : un seul habillage Mire compilé avec le moteur dot-stash, et les cinq thèmes actuels
(Écran éteint, Plein jour, Minuit, Velours, Contraste élevé) réduits à des **jeux de jetons** (fichiers de propriétés
CSS) appliqués à l'exécution. Un thème-addon (P3-10) n'est alors qu'un fichier de jetons : ni Sass, ni code.

**Localisation (D-11).** Les textes des composants sont des attributs (`label`, gabarits avec `{count}`) : Mire leur
passe ses catalogues français et anglais (P1-28), et la langue (`lang`) pour les pluriels.

**Ce qui manque à dot-stash pour Mire.** Une tuile d'affiche (image + carton monogramme), une rangée défilante de
tuiles, une jauge de lecture et de volume, le menu principal à quatre positions et rétractable, l'emplacement de la vue
web native, le lecteur vidéo, la visionneuse d'images, le mini-lecteur audio, la barre de rappel de la manette, les
cartes de thème et les listes ordonnables. Les jetons par défaut sont dimensionnés pour une page web : le thème Mire
agrandit les échelles (lecture à distance, « 10-foot UI »).

## Effet sur la phase 1

| Tâche | Proposition |
| --- | --- |
| P1-22, P1-23 | Inchangées : état, client API et logique de domaine seront repris tels quels |
| P1-24 | Inchangée, avec une précision : le calcul du voisin (`pickNeighbor`) travaille sur tout élément focalisable (dont `ds-trigger`), pas sur la seule classe `.focusable` |
| P1-25 | **À abandonner** : découper les vues historiques serait du travail jeté, et le registre d'actions est remplacé par les contrôleurs + `ds-trigger` |
| P1-26 | **Réduite au schéma des réglages** (utile aux addons) et débloquée ; son rendu passe en phase 2, avec `ds-field`, `ds-select`, `ds-toggle` |

## Phase 2 réécrite (esquisse)

1. **Intégration** : dot-stash comme dépendance versionnée de Mire, chargement des composants dans le renderer
   Electron (CSP, file://, bundle), page de démonstration.
2. **Habillage et jetons Mire** : le thème Mire sur le moteur dot-stash, les cinq thèmes en jeux de jetons, bascule à
   l'exécution, échelle « 10-foot ».
3. **Navigation** : clavier et manette sur les composants `ds-*` (widgets qui utilisent déjà les flèches : onglets,
   combo), bouton A, retour, contextes.
4. **Contrôleurs et actions** : les méthodes des contrôleurs, appelées par `ds-trigger`.
5. **Composants propres à Mire** (liste ci-dessus).
6. Puis la migration écran par écran, comme prévu (accueil, recherche, vidéos…), avec les critères communs : capture
   de référence, clavier et manette, aucun texte en dur.

## Décision (10/11/2026)

1. **Livraison** : une archive construite (`npm pack`) attachée à chaque release GitHub de dot-stash ; Mire
   l'installe par son adresse, épinglée par version, l'empreinte étant gardée dans `package-lock.json`
   (tâches B-119 et B-120 de dot-stash).
2. **Composants manquants** :
   - ceux qui servent à d'autres projets que Mire sont ajoutés **à dot-stash**, par des pull requests sur son
     dépôt, validées par toi ;
   - ceux propres à Mire vivent dans Mire (`packages/ui`, éléments `mire-*` en light DOM), construits avec
     dot-stash comme **toolkit** (dépendance de développement : moteur SCSS, utilitaires, conventions).
3. **Thèmes** : un habillage Mire compilé avec le moteur dot-stash, et les cinq thèmes en jeux de jetons
   appliqués à l'exécution. Un thème-addon n'est qu'un fichier de jetons.
4. **Contrôleurs** : un contrôleur par section (`mire-videos`, `mire-games`…) plus l'application (`mire-app`) ;
   toutes les actions passent par `ds-trigger`, avec des arguments par clé stable.

## Travail dans dot-stash

Suivi dans `docs/plan/BACKLOG.md` (section « Dans dot-stash »), réalisé par des pull requests sur
`jezoock/dot-stash`, chacune validée par toi. Chaque composant suit le contrat de dot-stash (structure, habillage
du thème `default`, propriétés personnalisées, accessibilité, textes traduisibles, tests unitaires et navigateur,
readme, CHANGELOG).

| Sujet | Pourquoi Mire en a besoin |
| --- | --- |
| Release : archive construite attachée à la release (B-119, B-120 ; le tag `v0.1.0`, B-117, est à poser de ton côté) | Livraison décidée ci-dessus |
| Moteur SCSS dans le paquet (`scss/` dans `files` et `exports`) | Construire l'habillage Mire et les composants `mire-*` avec le moteur, depuis l'archive |
| `ds-range` : curseur natif habillé, avec remplissage jusqu'à la valeur | Position de lecture, volume, réglages numériques |
| `ds-thumb` : image à proportions fixes, chargement différé, carton de remplacement (initiales sur une couleur tirée du texte) quand l'image manque ou échoue | Affiches, pochettes, jaquettes |
| `ds-scroller` : rangée défilante (horizontale ou verticale) qui garde l'élément focalisé visible, sans rendre inertes les éléments hors vue, boutons précédent et suivant facultatifs | Rangées de l'accueil, « Reprendre », menu en carrousel. `ds-slider` est un carrousel : ses diapositives hors vue sont inertes, ce qui bloquerait la navigation à la manette |
| `ds-sortable` : liste ordonnable au clavier (monter, descendre), annonce des déplacements, événement avec le nouvel ordre | Ordre des services, des sections du menu, des sources |

Restent dans Mire (`mire-*`) : la tuile d'affiche (un `ds-trigger` autour d'un `ds-thumb` et de ses textes), la
grille groupée avec « Afficher plus », le menu à quatre positions rétractable, l'emplacement de la vue web native,
les lecteurs (vidéo, audio, images), la barre de rappel de la manette, les cartes de thème.
