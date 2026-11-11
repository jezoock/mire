'use strict';
/**
 * Script chargé au tout début des pages des sites ouverts dans Mire (avant leur propre code).
 * Il exécute le script d'avant-page que lui donne le processus principal : celui des extensions des vues web
 * (scripts correcteurs du bloqueur de publicités, identité de la connexion Google ; src/main/web/extensions.ts).
 * Sur la plupart des pages, ce script est vide et rien n'est fait. Rien n'est exposé aux pages.
 */
const { ipcRenderer, webFrame } = require('electron');

// Les scripts correcteurs du bloqueur doivent passer avant ceux du site, comme dans uBlock Origin ; ce script de
// page s'exécute avant tout code du site. Electron ne l'exécute que dans le cadre principal de chaque page.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  const code = ipcRenderer.sendSync('mire:before-page', location.href);
  if (code) webFrame.executeJavaScript(code).catch(() => {});
}
