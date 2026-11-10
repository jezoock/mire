# Phase 2 — Frontend avec dot-stash

But : remplacer l'interface rendue en chaînes HTML par les composants de `jezoock/dot-stash` (`ds-*`, light DOM)
et des composants propres à Mire (`mire-*`), toutes les actions passant par `ds-trigger`, et faire du thème un
simple jeu de jetons, réutilisable par des thèmes-addons. Décision et justification : D-05
(`docs/analyse/D-05-dot-stash.md`, décidée le 10/11/2026).

Principes :

- **dot-stash** fournit les composants génériques (`ds-trigger`, `ds-modal`, `ds-field`, `ds-select`,
  `ds-toggle`, `ds-panel-group`, `ds-toaster`, `ds-loader`…) et ceux qui lui sont ajoutés pour Mire (`ds-range`,
  `ds-thumb`, `ds-scroller`, `ds-sortable`, voir la section « Dans dot-stash » de `BACKLOG.md`). Mire l'installe
  depuis l'archive attachée à une release, épinglée par version ;
- **`packages/ui` (`@mire/ui`)** contient l'habillage Mire et les composants `mire-*` propres à Mire, en light
  DOM, construits avec dot-stash comme toolkit (moteur SCSS, utilitaires `labels` et `focus`, conventions de
  classes et de modificateurs) ;
- **actions** : chaque action est une méthode publique d'un contrôleur (`mire-app`, `mire-videos`,
  `mire-games`…) appelée par un `ds-trigger` (`target`, `action='play:["v:/films/Intouchables.mkv"]'`) ;
  les arguments désignent les éléments par une clé stable (chemin, identifiant), jamais par leur rang ;
- **thèmes** : un habillage Mire compilé avec le moteur dot-stash, et les cinq thèmes (Écran éteint, Plein jour,
  Minuit, Velours, Contraste élevé) en jeux de jetons (propriétés CSS) appliqués à l'exécution ;
- **textes** : tous par les catalogues de P1-28, en français et en anglais, passés aux composants par leurs
  attributs (`label`, `labels`, gabarits avec `{count}`) avec la langue (`lang`) pour les pluriels.

Stratégie : migration **progressive**. Les composants sont des balises standards : la coquille héberge d'abord
les vues historiques (`mire-legacy-view`), puis chaque tâche remplace une vue. L'application reste utilisable et
testable après chaque PR. Les captures de P0-09 servent de référence ; l'habillage vise le rendu actuel, et tout
écart visible est justifié dans la PR et ses captures sont mises à jour.

Prérequis : point d'étape **G2** ; phase 1 terminée (au minimum P1-08, P1-22 à P1-24 et P1-26) ; une release de
dot-stash avec son archive et son moteur SCSS (DS-01, DS-02). Après P2-01 à P2-04, point d'étape **G2b** avant
de migrer les vues.

---

## P2-01 — Intégration de dot-stash et `@mire/ui`

- **Dépend de** : G2, DS-01, DS-02 · **Taille** : M
- **Objectif** : prouver la chaîne complète dans Electron et trancher les questions techniques avant d'écrire des
  composants.
- **À faire**
  1. Dépendance `dot-stash` installée depuis l'archive de la release (adresse versionnée, empreinte dans
     `package-lock.json`) ; mise à jour documentée dans le README (changer la version, `npm install`).
  2. Chargement des composants dans le renderer avec la CSP actuelle (`script-src 'self'`, `file://`) : essayer
     le chargeur paresseux copié dans `dist/renderer/` ; sinon des imports par composant (`dist-custom-elements`,
     tâche B-122 de dot-stash) intégrés au bundle esbuild du renderer (P1-22). Mesurer le temps de démarrage.
  3. Paquet `packages/ui` (`@mire/ui`) : Stencil (version de dot-stash, figée), sortie en light DOM
     (`shadow: false`), feuille de style compilée avec le moteur SCSS de dot-stash (`sass` en dépendance de
     développement) ; composant de démonstration `mire-demo` affiché dans une vue existante (cohabitation avec le
     gabarit HTML historique).
  4. Tests de composants : l'outil de dot-stash (Vitest, tests unitaires et navigateur) intégré à `npm test` et à
     la CI, ou une alternative sans nouvelle dépendance si elle suffit ; justifier le choix (D-03 : dépendances
     minimales).
  5. Page de démonstration interne (cachée) montrant les composants `ds-*` utilisés par Mire dans les cinq thèmes.
  6. `docs/adr/0001-dot-stash.md` : livraison, chargement, `@mire/ui`, conventions (préfixe `mire-`, classes et
     modificateurs à la manière de dot-stash, événements `mire*`), tests, mode `watch`.
- **Critères d'acceptation** : `npm start` affiche le composant de démonstration et un `ds-trigger` fonctionnel ;
  CSP inchangée ; ADR relu au point G2b.

---

## P2-02 — Habillage Mire et thèmes en jeux de jetons

- **Dépend de** : P2-01 · **Taille** : M
- **Objectif** : un système de thèmes indépendant des composants, où un thème n'est qu'un fichier de jetons.
- **À faire**
  - thème Mire sur le moteur dot-stash (`packages/ui/src/theme/`) : habillage des contrôles (`.ds-button`,
    `.ds-link`, `.ds-control` et leurs modificateurs), des composants `ds-*` utilisés et des `mire-*` ; échelles
    agrandies pour la lecture à distance (« 10-foot UI ») ;
  - un fichier de jetons par thème (`themes/ecran.css`, `jour.css`, `minuit.css`, `velours.css`,
    `contraste.css`), valeurs reprises de `styles.css` ; métadonnées (nom, description, couleur de fond de
    fenêtre, clair ou sombre) dans un `theme.json` à côté ;
  - chargeur de thème (mode « Automatique » compris), bascule à l'exécution sans rechargement ; le processus
    principal lit la couleur de fond de fenêtre dans les métadonnées (fin de la copie `THEME_BG`) ;
  - liste des jetons qu'un thème peut définir, tenue à jour dans `docs/themes.md`.
- **Critères d'acceptation** : la page de démonstration et l'accueil s'affichent dans les cinq thèmes ; changer de
  thème reste immédiat ; contrastes du thème « Contraste élevé » vérifiés.

---

## P2-03 — Navigation clavier et manette sur les composants

- **Dépend de** : P2-01, P1-24 · **Taille** : L · 🧑
- **Objectif** : garder la navigation spatiale de Mire (flèches, manette, contextes) sur les composants `ds-*` et
  `mire-*`.
- **À faire** : service `focus` qui choisit les candidats avec les aides de dot-stash (`isFocusable`,
  `checkVisibility` : ni masqués ni inertes) et `pickNeighbor` (P1-24) ; cohabitation avec les composants qui
  utilisent déjà les flèches (onglets de `ds-panel-group`, `ds-combo`, `ds-select`, `ds-scroller`) ; le bouton A
  de la manette clique l'élément focalisé (`ds-trigger` gère lui-même Entrée et Espace : pas de double
  déclenchement) ; B et Retour ; portée limitée à la boîte de dialogue au premier plan (`ds-modal`) ; restauration
  du focus au retour d'un lecteur ; contextes de la manette (liste, vidéo, images, site, dialogue) ; défilement
  de la liste au stick droit.
- **Critères d'acceptation** : tests du service (navigateur) ; 🧑 parcours manette complet sur les vues migrées et
  historiques (les deux coexistent).

---

## P2-04 — Contrôleurs et actions

- **Dépend de** : P2-01, P1-22, P1-23 · **Taille** : M
- **Objectif** : remplacer le `switch` de ~120 actions par des méthodes publiques de contrôleurs, appelées par
  `ds-trigger`.
- **À faire**
  - `mire-app` (navigation entre sections, recherche, réglages, notifications) et un contrôleur par section
    (`mire-home`, `mire-search`, `mire-videos`, `mire-music`, `mire-images`, `mire-streaming`, `mire-tv`,
    `mire-games`, `mire-store`, `mire-downloads`, `mire-settings`), branchés sur l'état et le client API de
    P1-22 et la logique de P1-23 ;
  - conventions : noms des méthodes, arguments JSON par clé stable, retour d'erreur (toast), actions
    asynchrones (état « en cours » du `ds-trigger`) ;
  - pont temporaire : les `data-action` des vues historiques appellent les mêmes méthodes, pour que les deux
    interfaces cohabitent ;
  - script de vérification (`npm run check:actions`, en CI) : chaque `action` d'un `ds-trigger` des gabarits
    désigne une méthode existante du contrôleur visé.
- **Critères d'acceptation** : tests des contrôleurs (méthodes appelées avec des clés, erreurs) ; le script de
  vérification passe ; captures identiques.

---

## P2-05 — Composants médias

- **Dépend de** : P2-02, P2-03, P2-04, DS-04, DS-05 · **Taille** : M
- **À faire** : `mire-tile` (un `ds-trigger` autour d'un `ds-thumb`, titre, sous-titre, badge, jauge de
  reprise), `mire-grid` (groupes, « Afficher plus »), rangées défilantes avec `ds-scroller`, `mire-focus-info`
  (panneau d'infos de l'élément sélectionné), `mire-backdrop` (fondu entre deux images).
- **Critères d'acceptation** : tests ; une grille de 5 000 éléments reste fluide (mesure dans la PR) ; navigation
  à la manette dans une grille et une rangée.

---

## P2-06 — Boîtes de dialogue et formulaires

- **Dépend de** : P2-02, P2-03 · **Taille** : M
- **À faire** : équivalent d'`openForm` sur `ds-modal` et `ds-field` / `ds-select` / `ds-toggle` (champs texte,
  liste, image, zone de texte, actions, résultat par promesse), confirmation, choix de la bonne fiche (image de
  secours), panneau de réglages de page à onglets (`ds-panel-group`) ; pile des fenêtres ouvertes (la dernière
  reçoit clavier et manette) ; la vue web native est masquée pendant qu'une fenêtre est ouverte, puis réaffichée ;
  notifications par `ds-toaster`.
- **Critères d'acceptation** : tests ; les boîtes historiques peuvent appeler ces composants (cohabitation).

---

## P2-07 — Coquille de l'application

- **Dépend de** : P2-05, P2-06 · **Taille** : L
- **À faire** : `mire-app` complet, `mire-rail` (gauche, droite, haut, bas ; rétractable ; carrousel ; sites
  ouverts sous Streaming et Jeux ; badge des téléchargements), `mire-header` (titre, outils de section, recherche,
  rouage, horloge), `mire-padbar` (barre de rappel de la manette), routeur par état (sections, sous-vues : série,
  saison, console), `mire-legacy-view` qui héberge une vue historique non encore migrée ; `index.html` ne contient
  plus que `<mire-app>`.
- **Critères d'acceptation** : captures de toutes les sections (identiques ou écarts justifiés) ; menu dans les
  quatre positions ; parcours manette du menu.

---

## P2-08 à P2-18 — Migration des sections (une tâche par section)

Chaque tâche remplace une vue historique par ses composants, supprime le code correspondant de `app.js` (gabarits
et cas du `switch`), garde le comportement et ajoute des tests. Critères communs : capture identique (ou écart
justifié), parcours clavier et manette, aucune régression du test de fumée, actions par `ds-trigger` uniquement
(le script de P2-04 passe), **aucun texte écrit en dur : tout passe par les catalogues de P1-28, en français et en
anglais**.

| Tâche | Section | Contenu | Taille |
| --- | --- | --- | --- |
| P2-08 | Accueil | horloge, barres de la mire, « Vos services », « Reprendre », personnalisation | S |
| P2-09 | Recherche globale | résultats locaux, films et séries (TMDB), sites, télévision, jeux, images, recherches récentes | M |
| P2-10 | Vidéos | grille, séries → saisons → épisodes, filtres genre/source, tri, source de recherche, panneau d'infos | M |
| P2-11 | Musique | albums, morceaux, morceau en cours, `mire-mini-player` | M |
| P2-12 | Images | grille groupée, `mire-image-viewer` (diaporama, préchargement) | S |
| P2-13 | Lecteur vidéo | `mire-video-player` : OSD (`ds-range` pour la position et le volume), sous-titres, reprise, son absent, lecteur externe | M |
| P2-14 | Streaming et vue web | services par catégorie, `mire-webbar`, `mire-web-slot` (position de la vue native, `ResizeObserver`) | M |
| P2-15 | Télévision | chaînes, services, portail web | S |
| P2-16 | Jeux | liste unifiée, filtres système/genre, console, jeux en ligne, marque-pages « à télécharger », suppression | L |
| P2-17 | Boutique | cartes d'émulateurs, choix des consoles RetroArch, BIOS, jeux libres, import | M |
| P2-18 | Téléchargements | liste, mises à jour fines (sans redessin de la page), ajout de lien et de `.torrent` | S |

Dépendances : toutes dépendent de P2-07 ; P2-13 avant P2-10 (le lecteur est ouvert depuis les vidéos) ;
P2-11 et P2-13 partagent le volume (P1-24). 🧑 pour P2-13 et P2-14 (lecture réelle, Widevine).

---

## P2-19 — Réglages

- **Dépend de** : P2-07, P1-26, DS-06 · **Taille** : M
- **À faire** : page Réglages et panneaux de page générés depuis le schéma de P1-26 (`ds-field`, `ds-select`,
  `ds-toggle`, `ds-toggle-group`) ; cartes de thème avec aperçu réel ; listes ordonnables (`ds-sortable`) ;
  sources ; configuration (import, export).
- **Changement visible à valider en revue** : tous les champs s'enregistrent dès qu'ils changent ; seul l'éditeur
  JSON « Sites, jeux et consoles » garde son bouton « Enregistrer ».

---

## P2-20 — Éditeurs

- **Dépend de** : P2-06, P2-10, P2-16 · **Taille** : M
- **À faire** : modifier un média, un album, un morceau, un jeu, une console ; recherche en ligne et choix de
  fiche ; images (choisir, retirer) ; réinitialisation.

---

## P2-21 — Retrait de l'interface historique et audits

- **Dépend de** : P2-08 à P2-20 · **Taille** : M · 🧑
- **À faire** : suppression de `app.js` et de ce qui en reste, de `styles.css` monolithique, de
  `mire-legacy-view` et du pont `data-action` ; audit accessibilité (lecteur d'écran sur les parcours principaux,
  contrastes du thème « Contraste élevé ») ; performance (bibliothèque factice de 20 000 éléments : temps
  d'affichage, mémoire) ; comparaison visuelle automatique des captures (seuil de tolérance) ajoutée au test de
  bout en bout.
- **Critères d'acceptation** : plus aucun `innerHTML` construit à partir de données ; mesures dans la PR.

---

## P2-22 — Guide « Créer un thème »

- **Dépend de** : P2-02, P2-21 · **Taille** : S
- **À faire** : `docs/themes.md` complet (jetons, métadonnées `theme.json`, exemples), un thème d'exemple (par
  exemple « Néon ») livré comme futur addon de thème : un fichier de jetons et ses métadonnées, sans Sass ni code ;
  captures.

---

## P2-23 — Sélecteur de langue et finitions de la localisation

- **Dépend de** : P2-19, P1-28, P1-29 · **Taille** : S
- **À faire** : choix de la langue dans Réglages (« Automatique », français, anglais, puis les packs installés en
  phase 3) avec bascule immédiate ; attribut `lang` du document (pluriels des composants dot-stash) ;
  vérification des mises en page avec les textes anglais (souvent plus courts, parfois plus longs : boutons,
  en-têtes, menu en carrousel) ; captures de référence en anglais ajoutées au test de bout en bout ;
  `npm run i18n:check` vert.
- **Critères d'acceptation** : toute l'application est utilisable en anglais sans redémarrage ; aucun texte
  français ne reste visible avec l'anglais choisi (parcours de toutes les sections).
