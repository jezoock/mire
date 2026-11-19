/**
 * Boîtes et messages de l'interface historique (P4-07) : repris tels quels de l'ancien `index.html`, ils sont placés
 * dans leur hôte (`mire-legacy-view`) avant le démarrage de `app.js`, qui les trouve par leurs identifiants. En
 * français, comme les autres vues historiques, jusqu'à leur retrait (P4-24). Les lecteurs sont devenus des composants :
 * `mire-video-player` (P4-14), `mire-mini-player` et `mire-image-viewer` (P4-15). Les icônes (`data-icon`) sont
 * dessinées au démarrage par `app.js`.
 */
export const LEGACY_LAYERS = `
<dialog class="panel" id="panel" aria-labelledby="panel-title">
  <div class="panel-head">
    <h2 class="panel-title" id="panel-title"></h2>
    <button class="icon-btn focusable" data-panel-close data-icon="close" aria-label="Fermer"></button>
  </div>
  <div class="panel-tabs" id="panel-tabs" role="tablist"></div>
  <div class="panel-body" id="panel-body"></div>
</dialog>

<dialog class="dlg wide pick" id="pick" aria-labelledby="pick-title">
  <h2 class="dlg-title" id="pick-title">Choisir la bonne fiche</h2>
  <p class="dlg-help" id="pick-help"></p>
  <div class="pick-grid" id="pick-grid"></div>
  <div class="dlg-actions"><button class="btn btn-ghost focusable" data-pick-cancel>Annuler</button></div>
</dialog>

<dialog class="dlg" id="dlg">
  <form method="dialog" id="dlg-form">
    <h2 class="dlg-title" id="dlg-title"></h2>
    <p class="dlg-help" id="dlg-help"></p>
    <div class="dlg-fields" id="dlg-fields"></div>
    <div class="dlg-actions" id="dlg-actions"></div>
  </form>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="drop" id="drop" hidden><span>Déposez vos fichiers pour les lire</span></div>
`;
