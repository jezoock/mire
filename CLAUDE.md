# Mire — consignes pour les sessions de travail

Mire est une application Electron (castLabs Electron for Content Security, Widevine) : lecteur multimédia,
frontend de streaming, télévision et jeux, pilotable au clavier, à la souris et à la manette.

## Où en est le projet

Le projet est en cours de refonte, en trois phases : refacto modulaire, frontend StencilJS, extraction d'addons.

- Analyse du code existant : `docs/analyse/ANALYSE.md`
- Mode d'emploi du plan (phases, points d'étape, lancer une tâche) : `docs/plan/README.md`
- Tableau de suivi de toutes les tâches : `docs/plan/BACKLOG.md`
- Fiches des tâches : `docs/plan/phase-0.md` à `docs/plan/phase-3.md`

Quand on te demande de « réaliser la tâche Px-yy », lis d'abord `docs/plan/README.md`, puis la fiche de la tâche,
et reste strictement dans son périmètre. Une tâche dont une dépendance n'est pas « faite » dans `BACKLOG.md`
ne se commence pas : signale-le.

## Conventions

- Langue : interface, messages d'erreur, commentaires et documentation en français. Les messages destinés à
  l'utilisateur restent simples, sans jargon (voir le ton des messages existants).
- Style : 2 espaces, guillemets simples, points-virgules, fonctions courtes. Commentaires seulement pour le « pourquoi ».
- Pas de changement de comportement dans une tâche de refacto, sauf si la fiche le demande explicitement.
- Toute logique déplacée ou dédoublonnée est couverte par un test (voir la fiche pour le runner).
- Une tâche = une branche = une pull request vers `main`. Le titre de la PR commence par l'identifiant (`P1-05 — …`).
- Mettre à jour le statut de la tâche dans `docs/plan/BACKLOG.md` dans la même PR.

## Commandes

- `npm install` puis `npm start` : lancer l'application (télécharge le moteur Electron au premier lancement).
- `npm run lint` : ESLint ; `npm run format:check` : vérifie le formatage Prettier (`npm run format` le corrige).
- `npm test` : tests unitaires (`node:test`). Utiliser Node 24 : sous Node 22, un test de décodage Windows-1252 est sauté.
- La CI (`.github/workflows/ci.yml`) lance ces trois commandes à chaque push et à chaque PR (tests sous Node 22 et 24).

## Points sensibles

- Sécurité de la fenêtre principale : `contextIsolation`, `sandbox`, CSP `script-src 'self'`, protocole `media://`
  limité aux dossiers autorisés. Ne jamais affaiblir ces protections.
- Le dossier `vendor/` et la section `overrides` de `package.json` remplacent des dépendances de WebTorrent :
  ne pas les modifier sans lire la section correspondante du README.
- Widevine et la signature VMP (`scripts/drm.js`) ne se testent que sur une vraie machine Windows ou macOS.
