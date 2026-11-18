// Point d'entrée de l'interface, assemblé par esbuild (scripts/build.mjs) en un seul script chargé par index.html.
// Les fondations (core/, ui/, state/, api/), la logique sans DOM (domain/), la navigation (nav/) et les lecteurs
// (players/) sont importés par l'interface historique, app.js. Les composants mire-* (@mire/ui) sont définis ici ;
// les composants ds-* le sont par le chargeur de dot-stash, chargé à part par index.html (docs/adr/0001-dot-stash.md).
// La coquille (<mire-app>, P4-07) est rendue d'abord : app.js trouve alors le menu, l'en-tête et les vues historiques.
import { defineCustomElements } from '@mire/ui';
import { mountShell } from './shell/index.ts';

defineCustomElements();
mountShell().then(() => import('./app.js'));
