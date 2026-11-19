/**
 * Lecteurs, boîtes et messages de l'interface historique (P4-07) : repris tels quels de l'ancien `index.html`, ils
 * sont placés dans leur hôte (`mire-legacy-view`) avant le démarrage de `app.js`, qui les trouve par leurs
 * identifiants. En français, comme les autres vues historiques, jusqu'à leur remplacement (lecteurs P4-15, retrait
 * P4-24) ; le lecteur vidéo est devenu `mire-video-player` (P4-14). Les icônes (`data-icon`) sont dessinées au démarrage par `app.js`.
 */
export const LEGACY_LAYERS = `
<!-- Mini-lecteur de musique -->
<div class="mini" id="mini" hidden>
  <div class="mini-meta">
    <img class="mini-cover" id="mini-cover" alt="">
    <div class="mini-txt">
      <div class="mini-title" id="mini-title"></div>
      <div class="mini-sub" id="mini-sub"></div>
    </div>
  </div>
  <div class="mini-ctrl">
    <button class="icon-btn focusable" id="mini-prev" data-icon="prev" aria-label="Morceau précédent"></button>
    <button class="icon-btn big focusable" id="mini-play" data-icon="pause" aria-label="Lecture ou pause"></button>
    <button class="icon-btn focusable" id="mini-next" data-icon="next" aria-label="Morceau suivant"></button>
  </div>
  <div class="mini-seek">
    <span id="mini-cur">0:00</span>
    <input class="range" id="mini-range" type="range" min="0" max="1000" value="0" aria-label="Position dans le morceau">
    <span id="mini-dur">0:00</span>
  </div>
  <div class="mini-vol">
    <span class="vol-ico" data-icon="volume"></span>
    <input class="range" id="mini-vol" type="range" min="0" max="1" step="0.05" aria-label="Volume">
  </div>
  <button class="icon-btn focusable" id="mini-close" data-icon="close" aria-label="Arrêter la musique"></button>
</div>

<!-- Visionneuse d'images -->
<div class="layer image-layer" id="image-layer" tabindex="-1" hidden>
  <img class="iv-img" id="iv-img" alt="">
  <div class="vp-ui">
    <div class="vp-top">
      <button class="icon-btn" data-act="close" data-icon="close" aria-label="Fermer la visionneuse"></button>
      <div class="vp-heading">
        <div class="vp-title" id="iv-title"></div>
        <div class="vp-sub" id="iv-count"></div>
      </div>
      <button class="text-btn" data-act="slideshow" id="iv-slide"><span data-icon="play"></span><span id="iv-slide-lbl">Diaporama</span></button>
    </div>
    <button class="iv-nav iv-prev" data-act="prev" data-icon="chevL" aria-label="Image précédente"></button>
    <button class="iv-nav iv-next" data-act="next" data-icon="chevR" aria-label="Image suivante"></button>
  </div>
</div>

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
