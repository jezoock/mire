// Point d'entrée de l'interface, assemblé par esbuild (scripts/build.mjs) en un seul script chargé par index.html.
// Les fondations (core/, ui/, state/, api/), la logique sans DOM (domain/), la navigation (nav/) et les lecteurs
// (players/) sont importés par l'interface historique, app.js.
import './app.js';
