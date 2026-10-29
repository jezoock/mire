# Plan de refonte de Mire — mode d'emploi

Ce dossier découpe la refonte en tâches courtes, chacune revue séparément (une PR par tâche) et exécutable
dans une conversation indépendante. L'analyse qui justifie ce plan est dans `docs/analyse/ANALYSE.md`.

## Les phases

| Phase | Objectif | Fiches |
| --- | --- | --- |
| 0 — Filet de sécurité | Outillage, tests de caractérisation, test de fumée, CI, correctifs urgents. Aucun changement d'architecture. | `phase-0.md` |
| 1 — Refacto modulaire | Découper `main.js` et `app.js` par domaine, séparer données et code, poser les interfaces qui serviront aux addons. Comportement identique. | `phase-1.md` |
| 2 — Frontend StencilJS | Remplacer l'interface, vue par vue, par des composants ; thèmes par jetons. Approche à définir au point G2 (toolkit et set de composants existants). | `phase-2.md` (provisoire) |
| 3 — Addons | Hôte d'addons, SDK, dépôt `mire-addons`, extraction des catalogues et fournisseurs en addons. | `phase-3.md` |

## Les points d'étape

On ne commence pas une phase sans avoir fait le point. Chaque point d'étape est une revue avec toi.

| Point | Quand | Ce qu'on valide |
| --- | --- | --- |
| **G0** | ✅ 29/10/2026 | L'analyse, les décisions D-01 à D-10 (`ANALYSE.md` § 10), le découpage en tâches |
| **G1** | Fin de la phase 0 | CI verte, tests de caractérisation et captures de référence en place, correctifs livrés → feu vert phase 1 |
| **G2** | Fin de la phase 1 | Bilan de la refacto (arborescence, contrats) ; décision D-05 (approche frontend avec ton toolkit et ton set de composants) et réécriture de la phase 2 |
| **G2b** | Après le prototype de la phase 2 | Revue de l'ADR frontend et de la navigation au focus avant de migrer les vues |
| **G3** | Fin de la phase 2 | ADR des addons (P3-01) et création du dépôt `mire-addons` |

Les fiches des phases 2 et 3 sont volontairement un peu moins détaillées que celles des phases 0 et 1 : elles
seront affinées au point d'étape qui les précède, avec ce que la phase précédente aura appris.

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

## Règles communes à toutes les tâches

- **Périmètre strict** : ce qui n'est pas dans la fiche n'est pas fait. Une amélioration repérée en chemin est
  notée dans la PR (section « Pistes »), pas réalisée.
- **Pas de changement de comportement** dans les phases 0 et 1, sauf correctif explicitement prévu par la fiche.
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
