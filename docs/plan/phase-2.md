# Phase 2 — Frontend StencilJS

> **⏸ Fiches provisoires — décision D-05 reportée.** L'approche retenue s'appuiera sur un toolkit et un set de
> composants que tu as déjà créés. On en parle en détail au point G2 ; cette phase sera alors réécrite (périmètre,
> découpage, dépendances). Les fiches ci-dessous décrivent l'approche initialement proposée et ne doivent pas
> être lancées en l'état. Ce qui reste vrai quelle que soit l'approche : migration progressive, thèmes par jetons,
> navigation au focus compatible avec les composants encapsulés, captures de P0-09 comme référence.

But : remplacer l'interface rendue en chaînes HTML par des composants web Stencil (TypeScript + JSX), et faire
du thème un véritable contrat de « skin » (jetons CSS + `::part`), réutilisable par des thèmes-addons.

Stratégie : migration **progressive**. Les composants Stencil sont des balises standards : la coquille Stencil
héberge d'abord les vues historiques, puis chaque tâche remplace une vue. L'application reste utilisable et
testable après chaque PR ; les captures de P0-09 servent de référence visuelle.

Prérequis : point d'étape **G2** ; phase 1 terminée (au minimum P1-22 à P1-25 et P1-08). Après P2-01 à P2-03,
point d'étape **G2b** avant de migrer les vues.

Ces fiches seront affinées au point G2 (versions exactes, choix confirmés par le prototype).

---

## P2-01 — Prototype et ADR : Stencil dans Electron

- **Dépend de** : G2 · **Taille** : M
- **Objectif** : prouver la chaîne complète et trancher les questions techniques avant d'écrire des composants.
- **À faire**
  1. Paquet `packages/ui` (`@mire/ui`) : Stencil (dernière version stable, figée), sortie adaptée à Electron :
     essayer la sortie « lazy » chargée en `file://` avec la CSP actuelle (`script-src 'self'`) ; sinon
     `dist-custom-elements` + bundle esbuild. Mesurer le temps de démarrage.
  2. Composant de démonstration `mire-demo-tile` affiché dans une vue existante (gabarit HTML historique) :
     prouve la cohabitation.
  3. Prototype de **navigation au focus à travers le Shadow DOM** (voir P2-03) sur une grille de 200 tuiles.
  4. Gestion d'état : `@stencil/store` branché sur le client API (abonnements aux événements du processus principal).
  5. Tests de composants : runner proposé par Stencil, intégré à `npm test` et à la CI.
  6. Rédiger `docs/adr/0001-stencil.md` : sortie retenue, Shadow DOM ou `scoped` (décision D-05), conventions
     (préfixe `mire-`, nommage des `part`, des événements `mire*`), état, tests, mode `watch`.
- **Critères d'acceptation** : `npm start` affiche le composant de démonstration ; navigation clavier et manette
  dans la grille du prototype ; ADR relu au point G2b.

---

## P2-02 — Jetons de design et thèmes en fichiers

- **Dépend de** : P2-01 · **Taille** : M
- **Objectif** : un système de thèmes indépendant des composants.
- **À faire**
  - `packages/ui/src/tokens/` : jetons communs (typographie, rayons, espacements, tailles du menu et de l'en-tête,
    anneau de focus, ratios d'affiches) et jetons de couleur (`--bg`, `--surface`, `--line`, `--text`, `--muted`,
    `--bar-*`, `--accent`, `--ring`…) documentés ;
  - un fichier par thème (`themes/ecran.css`, `jour.css`, `minuit.css`, `velours.css`, `contraste.css`), extraits
    de `styles.css` sans changement de valeurs ; métadonnées du thème (nom, description, couleur de fond de
    fenêtre, clair/sombre) dans un `theme.json` à côté ;
  - chargeur de thème (mode « Automatique » compris) ; le processus principal lit la couleur de fond de fenêtre
    depuis les métadonnées du thème (fin de la copie `THEME_BG` dans `main.js`) ;
  - convention des `part` exposés par les composants (liste tenue à jour dans `docs/themes.md`).
- **Critères d'acceptation** : captures de l'accueil identiques dans les cinq thèmes ; changer de thème reste
  immédiat.

---

## P2-03 — Service de focus, clavier et manette compatibles Shadow DOM

- **Dépend de** : P2-01, P1-24 · **Taille** : L · 🧑
- **Objectif** : conserver la navigation spatiale de Mire (flèches, manette, contextes) avec des composants
  encapsulés — point le plus risqué de la phase.
- **À faire** : service `focus` (registre des éléments navigables déclarés par les composants, ou parcours des
  racines fantômes), réutilisant `pickNeighbor` (P1-24) ; portée limitée à la boîte de dialogue au premier plan ;
  restauration du focus au retour d'un lecteur ; contextes de la manette (liste, vidéo, images, site, dialogue) et
  barre de rappel des boutons ; défilement de la liste au stick droit.
- **Critères d'acceptation** : tests du service ; 🧑 parcours manette complet sur les vues migrées et historiques
  (les deux coexistent).

---

## P2-04 — Primitives d'action et de formulaire

- **Dépend de** : P2-02, P2-03 · **Taille** : M
- **À faire** : `mire-icon` (jeu d'icônes actuel), `mire-button` (variantes principale, discrète, petite, danger),
  `mire-icon-button`, `mire-input`, `mire-select`, `mire-check`, `mire-range` (remplissage `--p`), `mire-loading`
  (barres de la mire), `mire-empty`, `mire-toast` (avec action).
- **Critères d'acceptation** : tests de composants ; page de démonstration interne (cachée) montrant chaque
  primitive dans les cinq thèmes ; accessibilité (rôles, `aria-*`, focus visible).

---

## P2-05 — Composants médias

- **Dépend de** : P2-04 · **Taille** : M
- **À faire** : `mire-art` (ratios affiche, carré, jeu ; carton monogramme coloré quand l'image manque),
  `mire-tile` (titre, sous-titre, badge), `mire-grid` (groupes, « Afficher plus »), `mire-strip`,
  `mire-focus-info` (panneau d'infos de l'élément sélectionné), `mire-backdrop` (fondu entre deux images).
- **Critères d'acceptation** : tests ; une grille de 5 000 éléments reste fluide (mesure dans la PR).

---

## P2-06 — Boîtes de dialogue et panneau de réglages

- **Dépend de** : P2-04 · **Taille** : M
- **À faire** : `mire-dialog` (équivalent d'`openForm` : champs texte, liste, image, zone de texte, actions,
  résultat par promesse), `mire-confirm`, `mire-pick-dialog` (choisir la bonne fiche, image de secours),
  `mire-panel` (réglages de page à onglets) ; pile des fenêtres ouvertes (la dernière reçoit clavier et manette) ;
  la vue web native est masquée pendant qu'une fenêtre est ouverte, puis réaffichée.
- **Critères d'acceptation** : tests ; les boîtes historiques peuvent appeler ces composants (cohabitation).

---

## P2-07 — Coquille de l'application

- **Dépend de** : P2-05, P2-06 · **Taille** : L
- **À faire** : `mire-app`, `mire-rail` (gauche, droite, haut, bas ; rétractable ; carrousel ; sites ouverts sous
  Streaming et Jeux ; badge des téléchargements), `mire-header` (titre, outils de section, recherche, rouage,
  horloge), routeur par état (sections, sous-vues : série, saison, console), `mire-legacy-view` qui héberge une vue
  historique non encore migrée ; `index.html` ne contient plus que `<mire-app>`.
- **Critères d'acceptation** : captures identiques pour toutes les sections ; menu dans les quatre positions.

---

## P2-08 à P2-18 — Migration des sections (une tâche par section)

Chaque tâche remplace une vue historique par ses composants, supprime le code correspondant de
`src/renderer/views` et `actions`, garde le comportement et ajoute des tests de composants. Critères communs :
capture identique (ou écart justifié), parcours clavier et manette, aucune régression du test de fumée.

| Tâche | Section | Contenu | Taille |
| --- | --- | --- | --- |
| P2-08 | Accueil | horloge, barres de la mire, « Vos services », « Reprendre », personnalisation | S |
| P2-09 | Recherche globale | résultats locaux, films et séries (TMDB), sites, télévision, jeux, images, recherches récentes | M |
| P2-10 | Vidéos | grille, séries → saisons → épisodes, filtres genre/source, tri, source de recherche, panneau d'infos | M |
| P2-11 | Musique | albums, morceaux, morceau en cours, `mire-mini-player` | M |
| P2-12 | Images | grille groupée, `mire-image-viewer` (diaporama, préchargement) | S |
| P2-13 | Lecteur vidéo | `mire-video-player` : OSD, sous-titres, reprise, son absent, lecteur externe | M |
| P2-14 | Streaming et vue web | services par catégorie, `mire-webbar`, `mire-web-slot` (position de la vue native, `ResizeObserver`) | M |
| P2-15 | Télévision | chaînes, services, portail web | S |
| P2-16 | Jeux | liste unifiée, filtres système/genre, console, jeux en ligne, marque-pages « à télécharger », suppression | L |
| P2-17 | Boutique | cartes d'émulateurs, choix des consoles RetroArch, BIOS, jeux libres, import | M |
| P2-18 | Téléchargements | liste, mises à jour fines (sans redessin de la page), ajout de lien et de `.torrent` | S |

Dépendances : toutes dépendent de P2-07 ; P2-13 avant P2-10 (le lecteur est ouvert depuis les vidéos) ;
P2-11 et P2-13 partagent le volume (P1-24). 🧑 pour P2-13 et P2-14 (lecture réelle, Widevine).

---

## P2-19 — Réglages

- **Dépend de** : P2-07, P1-26 · **Taille** : M
- **À faire** : page Réglages et panneaux de page générés depuis le schéma de P1-26 ; cartes de thème avec aperçu
  réel ; listes ordonnables ; sources ; configuration (import, export).

---

## P2-20 — Éditeurs

- **Dépend de** : P2-06, P2-10, P2-16 · **Taille** : M
- **À faire** : modifier un média, un album, un morceau, un jeu, une console ; recherche en ligne et choix de
  fiche ; images (choisir, retirer) ; réinitialisation.

---

## P2-21 — Retrait de l'interface historique et audits

- **Dépend de** : P2-08 à P2-20 · **Taille** : M · 🧑
- **À faire** : suppression de `src/renderer/views`, `actions`, `styles.css` monolithique, `mire-legacy-view` ;
  audit accessibilité (lecteur d'écran sur les parcours principaux, contrastes du thème « Contraste élevé ») ;
  performance (bibliothèque factice de 20 000 éléments : temps d'affichage, mémoire) ; comparaison visuelle
  automatique des captures (seuil de tolérance) ajoutée au test de bout en bout.
- **Critères d'acceptation** : plus aucun `innerHTML` construit à partir de données ; mesures dans la PR.

---

## P2-22 — Guide « Créer un thème »

- **Dépend de** : P2-02, P2-21 · **Taille** : S
- **À faire** : `docs/themes.md` complet (jetons, `part`, métadonnées, exemples), un thème d'exemple
  (par exemple « Néon ») livré comme futur addon de thème, captures.
