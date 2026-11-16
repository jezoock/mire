# Plan de refonte de Mire — mode d'emploi

Ce dossier découpe la refonte en tâches courtes, chacune revue séparément (une PR par tâche) et exécutable
dans une conversation indépendante. L'analyse qui justifie ce plan est dans `docs/analyse/ANALYSE.md`.

## Les phases

| Phase | Objectif | Fiches |
| --- | --- | --- |
| 0 — Filet de sécurité | Outillage, tests de caractérisation, test de fumée, CI, correctifs urgents. Aucun changement d'architecture. | `phase-0.md` |
| 1 — Refacto modulaire | Découper `main.js` et `app.js` par domaine, séparer données et code, poser les interfaces qui serviront aux plugins. Comportement identique. | `phase-1.md` |
| 2 — Éléments, tags et pages | Le catalogue d'éléments, les tags et les infos, les pages, les regroupements et les listes, dans le processus principal (D-15). L'interface ne change pas encore. | `phase-2.md` |
| 3 — Socle des plugins | SDK et manifeste, hôte isolé, hôte de plugins et permissions, plugins inclus et dépendances, dépôt `mire-addons`, client des dépôts, dépôts tiers (D-14, D-18, D-19). | `phase-3.md` |
| 4 — Interface | dot-stash (D-05), coquille, explorateur et mode secours, moteur de thèmes et thème Mire, vue de page, Centre, réglages, assistant du premier lancement, thèmes avec leur propre code (D-16, D-17, D-23). | `phase-4.md` |
| 5 — Extraction en plugins | Tout ce que l'inventaire classe « inclus » ou « à installer » quitte le cœur (D-14). | `phase-5.md` |
| 6 — Nouveaux plugins | Services, radios et podcasts, jeux dans le cloud, serveurs multimédias, infos en ligne, émulateurs, thèmes. | `phase-6.md` |

L'architecture visée est décrite dans `docs/architecture-cible.md`, et le tri de tous les éléments de Mire dans
`inventaire-plugins.md`. Les phases 2 et 3 d'origine (« Frontend avec dot-stash » et « Addons ») ont été remplacées
au point G2c ; leurs fiches restent dans l'historique git, et la correspondance est donnée plus bas.

Les phases 2 et 4 peuvent avancer en parallèle : P4-01 à P4-04 ne dépendent pas des phases 2 et 3. Les tâches de la
phase 6 peuvent commencer dès que leurs dépendances sont faites, sans attendre la fin de la phase 5.

## Les points d'étape

On ne commence pas une phase sans avoir fait le point. Chaque point d'étape est une revue avec toi.

| Point | Quand | Ce qu'on valide |
| --- | --- | --- |
| **G0** | ✅ 29/10/2026 | L'analyse, les décisions D-01 à D-10 (`ANALYSE.md` § 10), le découpage en tâches |
| **G1** | ✅ Fin de la phase 0 | CI verte, tests de caractérisation et captures de référence en place, correctifs livrés → feu vert phase 1 |
| **G2** | ✅ 12/11/2026 | Bilan de la refacto (arborescence, contrats), décisions D-12 et D-13 |
| **G2c** | ✅ 16/11/2026 | Nouvelle architecture (`docs/architecture-cible.md`, décisions D-14 à D-23) et nouveau plan |
| **G3** | Fin de la phase 2 | Modèle d'éléments, tags et pages : types, contrat IPC, mesures sur 20 000 éléments |
| **G4** | Fin de la phase 3 | Prototype de l'hôte isolé (mesures, choix), SDK, chaîne de publication de `mire-addons` |
| **G5** | Après P4-01 à P4-04 | Intégration de dot-stash (ADR), palettes, navigation et contrôleurs, avant de construire les écrans |
| **G6** | Fin de la phase 4 | Interface complète, interface historique retirée, thèmes avec code |
| **G7** | Fin de la phase 5 | Bilan du cœur : il ne contient plus que les éléments « Cœur » de l'inventaire |

Les fiches des phases 2 à 6 sont volontairement un peu moins détaillées que celles des phases 0 et 1 : elles
seront affinées au point d'étape qui les précède, avec ce que la phase précédente aura appris.

### Correspondance avec l'ancien plan

| Ancienne tâche | Devenue |
| --- | --- |
| P2-01 à P2-07 (dot-stash, thèmes, navigation, contrôleurs, composants, dialogues, coquille) | P4-01 à P4-07 (les thèmes de P2-02 deviennent des palettes) |
| P2-08 à P2-12, P2-15 à P2-18 (migration section par section) | Remplacées par la vue de page générique (P4-11) et les écrans P4-12, P4-13, P4-16 à P4-19 |
| P2-13 (lecteur vidéo), P2-14 (vue web) | P4-14, P4-16 |
| P2-19 (réglages), P2-20 (éditeurs), P2-21 (retrait), P2-22 (guide des thèmes), P2-23 (langue) | P4-20, P4-22, P4-24, P4-25, P4-26 |
| P3-01 (ADR des addons) | `docs/architecture-cible.md` (G2c) |
| P3-02, P3-03, P3-05, P3-06, P3-08 | P3-01, P3-03 et P3-04, P3-06, P3-07, P3-08 |
| P3-04 (contributions d'interface) | Réglages des plugins (P4-20), thèmes (P4-11, P4-27) |
| P3-07 (continuité) | P5-01 |
| P3-10 à P3-28 (extractions) | P5-02 à P5-20 |
| P3-29 (packs de langue) | P5-08 |

## Réaliser une tâche dans une conversation indépendante

1. Vérifier dans `BACKLOG.md` que toutes ses dépendances sont « faite ».
2. Ouvrir une nouvelle session Claude Code sur le dépôt et donner ce message (en remplaçant l'identifiant) :

   ```text
   Réalise la tâche P1-05 du plan de refonte.
   Lis CLAUDE.md, docs/plan/README.md, puis la fiche P1-05 dans docs/plan/phase-1.md.
   Reste strictement dans le périmètre de la fiche, ajoute les tests demandés, vérifie chaque critère
   d'acceptation, passe la tâche à « en revue » dans docs/plan/BACKLOG.md, pousse et ouvre une PR vers main.
   Dans la description de la PR : ce qui a été fait, ce qui reste à vérifier à la main, et les écarts
   éventuels par rapport à la fiche.
   ```

3. Relire la PR (diff + checklist), faire les vérifications manuelles indiquées, fusionner.
4. Passer la tâche à « faite » dans `BACKLOG.md` (ou laisser la PR suivante le faire).

Je peux aussi lancer moi-même ces sessions (une par tâche) et suivre leurs PR, si tu préfères piloter depuis
une seule conversation.

Une tâche de la phase 5 ou 6 qui publie un plugin se réalise aussi dans `jezoock/mire-addons` : une PR dans ce
dépôt, plus une PR dans Mire quand le cœur change (la fiche le dit).

## Règles communes à toutes les tâches

- **Périmètre strict** : ce qui n'est pas dans la fiche n'est pas fait. Une amélioration repérée en chemin est
  notée dans la PR (section « Pistes »), pas réalisée.
- **Pas de changement de comportement** dans les phases 0 et 1, sauf correctif explicitement prévu par la fiche.
  À partir de la phase 2, les changements visibles sont ceux que la fiche décrit, et rien d'autre.
- **Tests** : toute logique déplacée, fusionnée ou corrigée est couverte. `npm test` et `npm run lint` passent
  (dès que la phase 0 les a créés).
- **Vérification manuelle** : quand la fiche porte la mention 🧑, la PR contient une checklist à cocher par une
  personne sur une vraie machine (Widevine, Windows/macOS, manette, box sur le réseau…).
- **Conflits** : plusieurs tâches de la phase 1 découpent le même fichier (`main.js`, `app.js`). Elles peuvent
  être menées en parallèle, mais se fusionnent une à une ; la suivante se rebase sur `main` avant revue.
- **Taille** : S ≈ moins d'une demi-journée, M ≈ une journée, L ≈ deux jours ou plus (indicatif). Une tâche L qui
  déborde se scinde : proposer le découpage dans la PR plutôt que de livrer un diff énorme.

## Statuts utilisés dans `BACKLOG.md`

`à faire` → `en cours` → `en revue` → `faite` ; ou `bloquée` (avec la raison) / `abandonnée`.

## Format d'une fiche

Chaque fiche contient : dépendances, taille, objectif, constat (avec références `fichier:ligne` au commit
`1330fc2`), travail à faire, hors périmètre, critères d'acceptation, vérification. Les numéros de ligne
dérivent au fil des tâches : se fier aux noms de fonctions.
