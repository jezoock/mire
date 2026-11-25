# Phase 4 — Interface : dot-stash, explorateur et thèmes

But : remplacer l'interface rendue en chaînes HTML par les composants de `jezoock/dot-stash` (`ds-*`, light DOM) et
des composants propres à Mire (`mire-*`), construits sur le modèle de la phase 2 : coquille et écrans du cœur,
explorateur et mode secours, vue de page générique dessinée par le thème, Centre. Décisions : D-05 (dot-stash,
`docs/analyse/D-05-dot-stash.md`), D-13, D-15 à D-17 ; architecture : `docs/architecture-cible.md`.

Principes :

- **dot-stash** fournit les composants génériques (`ds-trigger`, `ds-modal`, `ds-field`, `ds-select`,
  `ds-toggle`, `ds-panel-group`, `ds-toaster`, `ds-loader`, `ds-range`, `ds-thumb`, `ds-scroller`, `ds-sortable`…).
  Mire l'installe depuis l'archive attachée à une release, épinglée par version (D-13) ;
- **`packages/ui` (`@mire/ui`)** contient l'habillage du cœur et les composants `mire-*`, en light DOM, construits
  avec dot-stash comme toolkit (moteur SCSS, utilitaires `labels` et `focus`, conventions de classes) ;
- **actions** : chaque action est une méthode publique d'un contrôleur (`mire-app`, `mire-page`, `mire-explorer`…)
  appelée par un `ds-trigger` ; les arguments désignent les éléments par leur clé (P2-01), jamais par leur rang ;
- **écrans du cœur et thème** : l'explorateur, le Centre, les Réglages et les lecteurs gardent l'habillage du cœur,
  avec la palette choisie. L'accueil et les pages sont dessinés par le moteur de thèmes avec le thème choisi (le
  thème Mire par défaut) ; un thème avec son propre code (P4-27, D-23) dessine en plus son menu et tout son
  agencement ;
- **textes** : tous par les catalogues de P1-28, en français et en anglais, traduits par le service posé en P4-04 ;
- **TypeScript** : `@mire/ui` hérite de `tsconfig.base.json` et passe par `npm run typecheck` (D-12).

Stratégie : migration **progressive**. La coquille héberge d'abord les vues historiques (`mire-legacy-view`), puis
chaque tâche remplace des vues ; l'application reste utilisable et testable après chaque PR. Le thème Mire reprend
l'apparence actuelle (couleurs, cartes, rangées), mais la structure change (pages au lieu des sections) : les
captures de P0-09 sont refaites au fil des tâches, et chaque écart est expliqué dans la PR.

Critères communs à toutes les tâches d'écran : parcours au clavier et à la manette, aucune régression du test de
fumée, actions par `ds-trigger` uniquement (le script de P4-04 passe), **aucun texte écrit en dur**.

Les tâches P4-01 à P4-04 ne dépendent pas des phases 2 et 3 : elles peuvent avancer avant ou pendant. Après P4-01 à
P4-04, point d'étape **G5** avant de construire les écrans. À la fin de la phase (P4-28 comprise), point
d'étape **G6**.

---

## P4-01 — Intégration de dot-stash et `@mire/ui`

- **Dépend de** : G2c, DS-01, DS-02, DS-08 · **Taille** : M
- **Objectif** : prouver la chaîne complète dans Electron et trancher les questions techniques avant d'écrire des
  composants.
- **À faire**
  1. Dépendance `dot-stash` installée depuis l'archive de la release (adresse versionnée, empreinte dans
     `package-lock.json`, dépôt public : aucun jeton, D-13) ; mise à jour documentée dans le README (changer la
     version, `npm install`).
  2. Chargement des composants dans le renderer avec la CSP actuelle (`script-src 'self'`, `file://`) : essayer
     le chargeur paresseux copié dans `dist/renderer/` ; sinon des imports par composant (`dist-custom-elements`,
     DS-07) intégrés au bundle esbuild du renderer (P1-22). Mesurer le temps de démarrage.
  3. Paquet `packages/ui` (`@mire/ui`) : Stencil (version de dot-stash, figée), sortie en light DOM
     (`shadow: false`), feuille de style compilée avec le moteur SCSS de dot-stash (`sass` ≥ 1.107 en dépendance de
     développement) ; composant de démonstration `mire-demo` affiché dans une vue existante (cohabitation avec le
     gabarit HTML historique). Son `tsconfig.json` hérite de `tsconfig.base.json` et `npm run typecheck` le
     vérifie (D-12).
  4. Tests de composants : l'outil de dot-stash (Vitest, tests unitaires et navigateur) intégré à `npm test` et à
     la CI, ou une alternative sans nouvelle dépendance si elle suffit ; justifier le choix (D-03 : dépendances
     minimales).
  5. Page de démonstration interne (cachée) montrant les composants `ds-*` utilisés par Mire dans les cinq
     palettes.
  6. `docs/adr/0001-dot-stash.md` : livraison, chargement, `@mire/ui`, conventions (préfixe `mire-`, classes et
     modificateurs à la manière de dot-stash, événements `mire*`), tests, mode `watch`.
- **Critères d'acceptation** : `npm start` affiche le composant de démonstration et un `ds-trigger` fonctionnel ;
  CSP inchangée ; `npm run typecheck` couvre `packages/ui` ; ADR relu au point G5.

---

## P4-02 — Habillage du cœur et palettes

- **Dépend de** : P4-01 · **Taille** : M
- **Objectif** : un habillage indépendant des composants, où une palette n'est qu'un fichier de jetons (D-17).
- **À faire**
  - habillage du cœur sur le moteur dot-stash (`packages/ui/src/theme/`) : contrôles (`.ds-button`, `.ds-link`,
    `.ds-control` et leurs modificateurs), composants `ds-*` utilisés et `mire-*` ; échelles agrandies pour la
    lecture à distance ; les réglages du moteur passent par les jetons (`_tokens`), le moteur ne se configure pas
    après son chargement ;
  - un fichier de jetons par palette (`palettes/ecran.css`, `jour.css`, `minuit.css`, `velours.css`,
    `contraste.css`), valeurs reprises de `styles.css` ; métadonnées (nom, couleur de fond de fenêtre, clair ou
    sombre) dans un `palette.json` à côté. Écran éteint et Contraste élevé restent au cœur ; les trois autres
    deviendront des plugins en P5-02 ;
  - chargeur de palette (mode « Automatique » compris), bascule à l'exécution sans rechargement ; le processus
    principal lit la couleur de fond de fenêtre dans les métadonnées (fin de la copie `THEME_BG`) ;
  - liste des jetons qu'une palette peut définir, tenue à jour dans `docs/themes.md`.
- **Critères d'acceptation** : la page de démonstration s'affiche dans les cinq palettes ; changer de palette reste
  immédiat ; contrastes de « Contraste élevé » vérifiés.

---

## P4-03 — Navigation clavier et manette sur les composants

- **Dépend de** : P4-01, P1-24 · **Taille** : L · 🧑
- **Objectif** : garder la navigation spatiale de Mire (flèches, manette, contextes) sur les composants `ds-*` et
  `mire-*`.
- **À faire** : service `focus` qui choisit les candidats avec les aides de dot-stash (`isFocusable`,
  `checkVisibility` : ni masqués ni inertes) et `pickNeighbor` (P1-24) ; cohabitation avec les composants qui
  utilisent déjà les flèches (onglets de `ds-panel-group`, `ds-combo`, `ds-select`, `ds-scroller`) ; navigation
  par colonnes (gauche et droite changent de colonne, haut et bas de ligne) pour l'explorateur ; le bouton A clique
  l'élément focalisé (`ds-trigger` gère lui-même Entrée et Espace : pas de double déclenchement) ; B et Retour ;
  portée limitée à la boîte de dialogue au premier plan (`ds-modal`) ; restauration du focus au retour d'un
  lecteur ; contextes de la manette (liste, colonnes, vidéo, images, site, dialogue) ; défilement au stick droit ;
  règle des éléments désactivés : aujourd'hui `pickNeighbor` n'écarte que ceux dont la propriété `disabled` est
  vraie, un composant désactivé par l'attribut `disabled` ou par `aria-disabled` resterait une destination :
  décider et tester la règle pour les `ds-*` et `mire-*`.
- **Critères d'acceptation** : tests du service (navigateur) ; 🧑 parcours manette complet sur les vues migrées et
  historiques (les deux coexistent).

---

## P4-03b — Navigation : attente du rendu des composants

- **Dépend de** : P4-03 · **Taille** : S · correctif décidé au point d'étape G3 (17/11/2026)
- **Problème** : le test de fumée échouait de temps en temps (« attend le rendu des composants, puis les flèches les
  parcourent… ») : après une flèche pressée avant le rendu des `ds-*`, le focus n'arrivait jamais sur le bon
  composant.
- **Cause** : ouvrir une vue appelle `focusFirst`, qui attend le rendu de ses composants avant de focaliser le premier
  élément. Si d'autres composants arrivent pendant cette attente et qu'une flèche est pressée, les deux attentes se
  terminent ensemble : le premier élément reprend le focus, puis la flèche part de lui au lieu de l'élément où était
  le focus. Reproduit en rejouant le test en boucle (ouverture de la page de démonstration puis flèche) : 10 échecs
  sur 40.
- **Correction** : un focus automatique différé (`focusFirst`, `restoreFocus`) est abandonné si une demande plus
  récente est venue pendant l'attente (une flèche) ou si le focus a été placé ailleurs (règle `deferredFocusStands`
  de `nav/targets.ts`, testée). Les flèches ne sont jamais abandonnées.
- **Critère d'acceptation** : le test passe en boucle (100 passages sans échec) ; test de fumée complet vert.

---

## P4-04 — Contrôleurs, actions et traduction

- **Dépend de** : P4-01, P1-22, P1-23 · **Taille** : M
- **Objectif** : remplacer le `switch` de ~120 actions par des méthodes publiques de contrôleurs, appelées par
  `ds-trigger`, et traduire l'interface.
- **À faire**
  - `mire-app` (écrans, recherche, réglages, notifications) et les contrôleurs des écrans à venir (`mire-home`,
    `mire-page`, `mire-explorer`, `mire-search`, `mire-centre`, `mire-settings`, lecteurs, vue web), branchés sur
    l'état et le client API de P1-22 et la logique de P1-23 ;
  - conventions : noms des méthodes, arguments JSON par clé stable, retour d'erreur (toast), actions asynchrones
    (état « en cours » du `ds-trigger`) ;
  - pont temporaire : les `data-action` des vues historiques appellent les mêmes méthodes, pour que les deux
    interfaces cohabitent ;
  - les modules `nav/` et `players/` (P1-24) reçoivent aujourd'hui les actions de l'interface par des objets de
    rappels fournis par `app.js` : ces rappels deviennent des appels aux méthodes des contrôleurs ;
  - service de traduction de l'interface (`src/renderer/i18n/` ou `@mire/ui`) : catalogues demandés au démarrage
    par `api.i18nGet()`, moteur de `@mire/shared/i18n`, fonction `t()` et langue courante pour les contrôleurs et
    les composants ; suit `api.onLanguageChange` ; tient à jour l'attribut `lang` du document (aujourd'hui
    `<html lang="fr">` en dur). Les vues historiques restent en français jusqu'à leur remplacement ;
  - script de vérification (`npm run check:actions`, en CI) : chaque `action` d'un `ds-trigger` des gabarits désigne
    une méthode existante du contrôleur visé.
- **Critères d'acceptation** : tests des contrôleurs (méthodes appelées avec des clés, erreurs) et du service de
  traduction (catalogues reçus, changement de langue, `lang` du document) ; le script de vérification passe ;
  captures identiques.

---

## P4-05 — Composants d'éléments

- **Dépend de** : P4-02, P4-03, P4-04 · **Taille** : M
- **À faire** : `mire-card` pour toute sorte d'élément (variantes affiche, vignette, ligne ; titre, sous-titre,
  badge, jauge de reprise ; un `ds-trigger` autour d'un `ds-thumb`), `mire-grid` (groupes, « Afficher plus »),
  `mire-row` (rangée défilante avec `ds-scroller`), `mire-focus-info` (infos de l'élément sélectionné),
  `mire-backdrop` (fondu entre deux images), `mire-group-card` (un regroupement : Friends, Saison 1, une console).
- **Critères d'acceptation** : tests ; une grille de 5 000 éléments reste fluide (mesure dans la PR) ; navigation à
  la manette dans une grille et une rangée.

---

## P4-06 — Boîtes de dialogue et formulaires

- **Dépend de** : P4-02, P4-03 · **Taille** : M
- **À faire** : équivalent d'`openForm` sur `ds-modal` et `ds-field` / `ds-select` / `ds-toggle` (champs texte,
  liste, image, zone de texte, actions, résultat par promesse), confirmation, choix de la bonne fiche (image de
  secours), panneau à onglets (`ds-panel-group`) ; pile des fenêtres ouvertes (la dernière reçoit clavier et
  manette) ; la vue web native est masquée pendant qu'une fenêtre est ouverte, puis réaffichée ; notifications par
  `ds-toaster`.
- **Critères d'acceptation** : tests ; les boîtes historiques peuvent appeler ces composants (cohabitation).

---

## P4-07 — Coquille de l'application

- **Dépend de** : P4-05, P4-06, P2-07 · **Taille** : L
- **À faire** : `mire-app` complet ; `mire-rail` : les pages épinglées (`pages.list`) et les écrans du cœur
  (Accueil, Recherche, Explorateur, Centre, Réglages), à gauche, à droite, en haut ou en bas, rétractable, en
  carrousel, sites ouverts, badge des téléchargements ; `mire-header` (titre, outils de l'écran, recherche, rouage,
  horloge) ; `mire-padbar` (aide de la manette) ; routeur par état (écran, page, chemin dans les regroupements) ;
  `mire-legacy-view` qui héberge une vue historique non encore remplacée ; `index.html` ne contient plus que
  `<mire-app>`.
- **Critères d'acceptation** : captures de tous les écrans (identiques ou écarts justifiés) ; menu dans les quatre
  positions ; parcours manette du menu.

---

## P4-08 — Explorateur

- **Dépend de** : P4-07, P2-08, P2-09 · **Taille** : L · 🧑
- **Objectif** : l'écran du cœur qui montre tous les éléments en colonnes, comme le Finder du Mac (D-16).
- **À faire** : `mire-explorer` : première colonne Pages, Listes, Tags, Sources, Dossiers ; colonnes suivantes par
  `catalog.page` (regroupements, puis éléments), chargées par tranches ; colonne d'aperçu (image, infos, tags,
  source, emplacement du fichier ; Lire, Modifier les infos, Tags, Ajouter à une liste) ; navigation par colonnes
  (P4-03), souris et clavier comme dans un explorateur de fichiers ; affichage fixe : habillage du cœur et palette,
  jamais le thème.
- **Critères d'acceptation** : tests du contrôleur ; parcours de 20 000 éléments factices sans ralentissement
  (mesure) ; 🧑 parcours complet à la manette.

---

## P4-09 — Gérer ses fichiers et sélection multiple

- **Dépend de** : P4-08, P2-10 · **Taille** : M
- **À faire** : dans l'explorateur, renommer, déplacer et supprimer (service de P2-10), avec confirmation qui dit
  exactement ce qui sera fait ; actions désactivées hors des dossiers autorisés, avec la raison ; sélection de
  plusieurs éléments (clavier, souris, manette) pour ajouter ou retirer un tag, ranger dans une liste, supprimer.
- **Critères d'acceptation** : tests ; aucune action proposée sur un élément hors des dossiers autorisés.

---

## P4-10 — Mode secours

- **Dépend de** : P4-08, P4-11 · **Taille** : S · 🧑
- **Objectif** : l'explorateur reste toujours accessible, quel que soit le thème (D-16).
- **À faire** : raccourci clavier capté par le processus principal (`before-input-event`) ; combinaison de la
  manette lue par le service de navigation du cœur ; option au démarrage (`--explorateur`, touche maintenue au
  lancement) ; retour automatique à l'explorateur, avec un message, si le thème ne se charge pas, dépasse son délai
  ou plante deux fois de suite ; choix d'un autre thème depuis l'explorateur.
- **Critères d'acceptation** : test avec un thème volontairement cassé ; 🧑 raccourci et combinaison de la manette
  sur une vraie machine.

---

## P4-11 — Moteur de thèmes et vue de page

- **Dépend de** : P4-05, P4-07, P2-07 · **Taille** : L
- **Objectif** : afficher n'importe quelle page avec le thème choisi (D-17).
- **À faire**
  - format `theme.json` et son schéma dans `@mire/shared` : palette, polices, images, sons, mise en page de
    l'accueil et des pages (rangées ou grille, carte, taille, place du menu, fond) ;
  - moteur de thèmes : charge le thème, applique palette et polices, transmet la mise en page aux composants ;
  - `mire-page-view` : une page et ses regroupements, chemin parcouru (Séries › Friends › Saison 1), groupe
    « Autres », chargement par tranches, indication `display` de la page ;
  - le thème Mire en données intégrées (il deviendra un plugin inclus en P5-10) ; un deuxième thème d'essai, très
    différent, pour vérifier que les composants sont assez souples.
- **Critères d'acceptation** : tests ; les sept pages prêtes à l'emploi s'affichent avec les deux thèmes ;
  changement de thème sans redémarrage.

---

## P4-12 — Accueil

- **Dépend de** : P4-11 · **Taille** : M
- **À faire** : `mire-home` : horloge, barres de la mire, « Reprendre », rangées tirées des pages et listes
  choisies, sites épinglés (anciennement « Vos services ») ; réglages de l'accueil (rangées, ordre) ; dessiné par le
  thème.
- **Critères d'acceptation** : capture ; personnalisation conservée après la migration v9 (P2-11).

---

## P4-13 — Recherche

- **Dépend de** : P4-11, P2-09 · **Taille** : M
- **À faire** : `mire-search` : résultats du catalogue groupés par page, résultats des fournisseurs `search`
  (« Où regarder »), recherches récentes, ouverture d'un résultat dans sa page.
- **Critères d'acceptation** : tests ; résultats identiques à la recherche actuelle sur la configuration de
  démonstration (écarts justifiés).

---

## P4-14 — Lecteur vidéo

- **Dépend de** : P4-07 · **Taille** : M · 🧑
- **À faire** : `mire-video-player` : affichage sur la vidéo (`ds-range` pour la position et le volume),
  sous-titres, reprise, son absent, lecteur externe ; les textes du lecteur et de la manette, déplacés tels quels
  dans `players/` et `nav/` par P1-24, passent par les catalogues.
- **Critères d'acceptation** : 🧑 lecture réelle (fichier local, fichier d'un serveur web, sous-titres).

---

## P4-15 — Lecteurs de musique et d'images

- **Dépend de** : P4-14 · **Taille** : M
- **À faire** : `mire-mini-player` (morceau en cours, file d'attente, volume partagé avec la vidéo) ;
  `mire-image-viewer` (plein écran, diaporama, préchargement).
- **Critères d'acceptation** : tests ; parcours à la manette.

---

## P4-16 — Vue web et télévision

- **Dépend de** : P4-11 · **Taille** : M · 🧑
- **À faire** : `mire-webbar`, `mire-web-slot` (position de la vue native, `ResizeObserver`) ; le nom et la couleur
  d'une vue `rom:`, `bm:` ou `tv:` viennent de l'état publié par le processus principal (`web-state`) ; chaînes de
  télévision comme éléments de la page Télévision, portail web ; la variante d'une chaîne (qualité préférée) est
  choisie par le service de télévision du processus principal.
- **Critères d'acceptation** : 🧑 lecture protégée (Widevine) sur Windows ou macOS ; chaînes d'une box réelle.

---

## P4-17 — Jeux : consoles et émulateurs

- **Dépend de** : P4-11, P4-06 · **Taille** : M · 🧑
- **À faire** : écrans propres aux jeux que la vue de page ne couvre pas : consoles créées à la main (dossiers,
  émulateur, arguments) ; **émulateur choisi par console**, et pour un jeu (réglage et lancement, D-21) ; sites de
  jeux d'une console ; marque-pages « à télécharger » ; suppression d'un jeu (contrôle du chemin de P0-06).
- **Critères d'acceptation** : tests ; 🧑 lancement réel d'un jeu avec deux émulateurs différents pour la même
  console.

---

## P4-18 — Centre : téléchargements et apps

- **Dépend de** : P4-07, P4-06 · **Taille** : M
- **À faire** : `mire-centre`, qui réunit Téléchargements et Boutique : liste des téléchargements (mises à jour fines,
  sans redessiner l'écran ; ajout d'un lien ou d'un `.torrent`) ; apps : émulateurs et lecteurs externes installés
  par les installateurs génériques du cœur, choix des consoles de RetroArch, rappels de BIOS, jeux libres, import.
  Les annonces (« jeu ajouté », progression) sont rédigées par les catalogues à partir des données du processus
  principal.
- **Critères d'acceptation** : captures ; parcours à la manette ; une installation d'émulateur suivie jusqu'au bout.

---

## P4-19 — Centre : plugins et dépôts

- **Dépend de** : P4-18, P3-07, P3-08 · **Taille** : M · 🧑
- **À faire** : plugins installés, disponibles et mises à jour ; fiche d'un plugin (ce qu'il apporte, origine,
  niveau, **permissions demandées affichées avant l'installation**, dépendances) ; accord explicite pour un plugin
  tiers de code sensible ; activer, désactiver, désinstaller (garder ou non ses données) ; dépôts : ajouter (adresse,
  clé, empreinte à vérifier), retirer.
- **Critères d'acceptation** : 🧑 installation depuis le dépôt officiel réel et depuis le dépôt tiers de test.

---

## P4-20 — Réglages

- **Dépend de** : P4-07, P3-04, P1-26, DS-06 · **Taille** : M
- **À faire** : page Réglages et panneaux générés depuis le schéma de P1-26 (`ds-field`, `ds-select`, `ds-toggle`,
  `ds-toggle-group`) ; **réglages de chaque plugin** générés depuis son manifeste ; palettes avec aperçu réel, choix
  du thème ; listes ordonnables (`ds-sortable`), dont l'ordre des fournisseurs d'infos ; configuration (import,
  export).
  - **Textes du schéma par les catalogues** : les libellés et aides du schéma sont aujourd'hui du français écrit en
    dur (`SettingsText = string`) ; ils deviennent des clés de catalogue tirées des identifiants
    (`settingsTextKey`, déjà prévu par P1-26), avec leurs textes en français et en anglais, et le type
    `SettingsText` devient une clé ; `docs/settings-schema.md` mis à jour.
  - **Réglages de langue dans le schéma** : `ui.language` (« Automatique », puis les langues disponibles) et
    `search.language` (langue des fiches : vide = comme l'interface), dont P4-26 a besoin.
  - Texte d'état du bloqueur désactivé et jamais chargé : « Les listes se téléchargent quand le bloqueur est
    activé » (aujourd'hui « au premier lancement », inexact depuis P1-13).
- **Changement visible à valider en revue** : tous les champs s'enregistrent dès qu'ils changent ; seul l'éditeur
  JSON « Sites, jeux et consoles » garde son bouton « Enregistrer ».

---

## P4-21 — Administration des tags, des pages et des listes

- **Dépend de** : P4-20, P2-07, P2-08 · **Taille** : M
- **À faire** : tags : renommer, fusionner, supprimer, couleur et icône, règles par type de fichier, quel plugin
  pose quel tag ; pages : créer et modifier (tags requis et exclus, conditions sur les infos, regroupements, tri,
  affichage, place dans le menu), revenir à la page prête à l'emploi d'origine ; listes : créer, renommer, ordonner.
  Des formulaires simples, avec un aperçu du nombre d'éléments de la page.
- **Critères d'acceptation** : tests ; créer « Films des années 90 » sans aide extérieure (parcours décrit dans la
  PR).

---

## P4-22 — Éditeurs

- **Dépend de** : P4-06, P4-11 · **Taille** : M
- **À faire** : modifier les infos, les tags et les images d'un élément (ou d'un regroupement : un album, une
  série) ; recherche en ligne et choix de la fiche ; réinitialisation.

---

## P4-23 — Assistant du premier lancement

- **Dépend de** : P4-19, P4-20 · **Taille** : M · 🧑
- **Objectif** : rendre Mire simple malgré le nombre de plugins (D-14, D-19, D-20).
- **À faire** : langue (celle du système, son pack installé d'office), ce qu'on veut faire (films et séries,
  musique, photos, jeux, télévision, streaming), la box pour la télévision, les services de streaming utilisés ;
  installation des plugins correspondants, avec leurs dépendances ; tout se change ensuite dans le Centre ;
  l'assistant se relance depuis les Réglages. Les choix proposés viennent des catégories de l'index du dépôt :
  tant que la phase 5 n'a pas publié les plugins, il s'éprouve avec le dépôt de test.
- **Critères d'acceptation** : 🧑 premier lancement complet à la manette, puis au clavier.

---

## P4-24 — Retrait de l'interface historique et audits

Découpée (décisions de la session de pilotage) : P4-24a, en deux PR (P4-24a1 puis P4-24a2), puis P4-24b. L'inventaire de
P4-24a a fait naître P4-29 (fonctions manquantes de la nouvelle interface), à faire avant le retrait.

### P4-24a1 — Retrait de l'interface historique : vues, pont, panneau, boîtes, styles

- **Dépend de** : P4-08 à P4-23, P4-29 · **Taille** : M · 🧑
- **À faire** : inventaire d'abord (`docs/plan/inventaire-p4-24a.md` : chaque écran, panneau, boîte, raccourci et
  action de l'interface historique, avec son remplaçant ; un manque arrête la tâche) ; puis retrait des sections
  historiques et de leur « Ancienne vue », de `styles.css` monolithique (ce qu'un composant ou un thème utilise encore
  va à sa place), de `mire-legacy-view` et `legacy-markup.ts`, du panneau « Réglages de la page » (le rouage de
  l'en-tête ouvre les Réglages sur la partie de la page affichée), des boîtes historiques (rebranchées sur `ds-modal`
  et `ds-toaster`) et du pont `data-action` (`check:actions` ne vérifie plus que les `ds-trigger`) ; test de fumée
  par la nouvelle interface seulement.
- **Fonctions retirées sans remplaçant sur place** (décision de la session de pilotage) : filtres et tri des
  sections (remplacés par les pages, P4-21, et la Recherche, P4-13) ; récupération des infos d'un seul type et « tout
  reprendre » (reste « tout récupérer ») ; recherche en cours sur un site de jeux d'une console.
- **Critères d'acceptation** : l'application démarre et tous les parcours du test de fumée passent sans les vues
  historiques ; `npm run check:actions` vert ; plus aucun `innerHTML` construit à partir de données dans les
  composants et les vues ; tailles de `dist/` avant et après dans la PR ; 🧑 tour complet à la manette et au clavier.

### P4-24a2 — Retrait de l'interface historique : racine de composition, méthodes IPC, `domain/`

- **Dépend de** : P4-24a1 · **Taille** : M · 🧑
- **À faire** : `app.js` remplacé par une racine de composition en TypeScript (création des écrans, chargement,
  lecteurs, opérations que les contrôleurs demandent) ; retrait des méthodes IPC que le catalogue remplace (contrat,
  préchargement, gestionnaires, tests) et des fonctions de `src/renderer/domain/` qui ne servent plus.
- **Critères d'acceptation** : plus de `app.js` ; plus aucun `innerHTML` construit à partir de données dans
  `src/renderer/` et `packages/ui/` ; tailles de `dist/` avant et après ; 🧑 tour complet à la manette et au clavier.

### P4-24b — Audits

- **Dépend de** : P4-24a2 · **Taille** : M
- **À faire** : audit accessibilité (lecteur d'écran sur les parcours principaux, contrastes) ; performance
  (catalogue factice de 20 000 éléments : temps d'affichage, mémoire) ; comparaison visuelle automatique des
  captures (seuil de tolérance) ajoutée au test de bout en bout.
- **Critères d'acceptation** : mesures dans la PR.

---

## P4-25 — Guide « Créer un thème »

- **Dépend de** : P4-11, P4-24a2 · **Taille** : S
- **À faire** : `docs/themes.md` complet (palettes et leurs jetons, `theme.json`, exemples) ; un thème d'exemple
  sans code, prêt à devenir un plugin ; captures.

---

## P4-26 — Sélecteur de langue et finitions de la localisation

- **Dépend de** : P4-20, P4-24a2, P1-28, P1-29 · **Taille** : S
- **À faire** : choix de la langue dans Réglages (« Automatique », anglais, puis les packs installés) avec bascule
  immédiate, et de la langue des fiches (`search.language`) ; attribut `lang` du document vérifié pour les pluriels
  des composants dot-stash ; menu de macOS : libellés des rôles Electron (`appMenu`, `editMenu`, `windowMenu`) pris
  dans les catalogues ; vérification des mises en page avec les textes anglais ; captures de référence en anglais
  ajoutées au test de bout en bout ; `npm run i18n:check` vert.
- **Critères d'acceptation** : toute l'application est utilisable en anglais sans redémarrage ; aucun texte français
  ne reste visible avec l'anglais choisi.

---

## P4-27 — Thèmes avec leur propre code : cadre et API

- **Dépend de** : P4-11, P4-24a2, P3-04 · **Taille** : L · 🧑
- **Objectif** : permettre un thème qui n'a rien à voir avec le thème Mire, en visuels comme en agencement, et qui
  accède à tous les contenus de la bibliothèque (D-23).
- **À faire**
  - cadre plein fenêtre : `iframe` sandboxée (`allow-scripts`, origine opaque, `allow="gamepad; autoplay;
    fullscreen"`), chargée par `mire-theme://<id>/…` en lecture seule ; CSP propre au cadre (scripts du thème,
    Internet seulement vers les hôtes déclarés, images et aperçus par des adresses délivrées par le cœur) ; la CSP de
    la fenêtre gagne seulement `frame-src mire-theme:`, `script-src 'self'` ne change pas ;
  - API des thèmes, versionnée, par `MessagePort`, avec un client JavaScript publié dans `@mire/plugin-sdk` :
    - lecture : tout le catalogue (éléments, tags, infos, images, pages, regroupements, listes, recherche,
      « Reprendre », historique, sites, chaînes, jeux, téléchargements en cours), événements de changement ;
    - actions : ouvrir, lire ou lancer un élément ; piloter la lecture et suivre son état ; ouvrir une page ou un écran
      du cœur (explorateur, Centre, Réglages, éditeur d'infos) ; chercher ; modifier tags, infos, listes, favoris et
      positions de reprise ; relancer l'analyse des sources ;
    - entrées : clavier, souris et manette en direct, et les actions de navigation du cœur ;
    - ressources : ses fichiers (images, polices, sons, vidéos, bibliothèques JavaScript embarquées), son stockage, ses
      réglages déclarés dans le manifeste (présentés dans les Réglages) ;
  - ce qui reste refusé : Node et accès direct aux fichiers, réglages de Mire et des autres plugins, secrets,
    suppression ou déplacement de fichiers, installation de plugins, accès aux sites ouverts dans les vues web,
    blocage du mode secours ;
  - les écrans du cœur (explorateur, Centre, Réglages, lecteurs, vues web, confirmations) s'ouvrent par-dessus le
    thème ; le mode secours (P4-10) reste capté par le processus principal ;
  - niveau « code limité » : hôtes Internet déclarés et affichés avant l'installation.
- **Critères d'acceptation** : tests de l'API (chaque méthode, versions, refus) ; un thème d'essai qui dessine son
  propre menu et sa propre page d'accueil lit tout le catalogue et lance une lecture ; il ne peut ni lire un fichier,
  ni joindre un hôte non déclaré, ni bloquer le mode secours (tests) ; 🧑 thème d'essai à la manette.

---

## P4-28 — Thème d'exemple avec code et guide

- **Dépend de** : P4-27, P4-25 · **Taille** : M
- **À faire** : un thème d'exemple avec code, prêt à devenir un plugin, qui ne ressemble pas au thème Mire (agencement
  et visuels propres) ; `docs/themes.md` complété : API des thèmes, cycle de vie, entrées, bonnes pratiques
  (performances, navigation à la manette, textes par les catalogues) ; modèle de départ utilisable avec ou sans
  bibliothèque d'interface.
- **Critères d'acceptation** : le thème d'exemple parcourt toute la bibliothèque et lit un film, une musique, un jeu.
