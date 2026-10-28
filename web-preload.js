'use strict';
/**
 * Script chargé au tout début des pages des sites ouverts dans Mire (avant leur propre code).
 * Il exécute les scripts correcteurs du bloqueur de publicités, et, sur la page de connexion Google uniquement, navigator.userAgent est aligné sur l'identité
 * envoyée dans les requêtes (celle d'Electron) : Google refuse la connexion si les deux diffèrent.
 * Partout ailleurs, ce script ne fait rien.
 */
const { ipcRenderer, contextBridge, webFrame } = require('electron');

// Bloqueur de publicités : ses scripts correcteurs (ceux d'uBlock Origin) doivent passer avant ceux
// du site, comme dans uBlock Origin. Ce script de page s'exécute avant tout code du site.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  const code = ipcRenderer.sendSync('mire:scriptlets', location.href);
  if (code) webFrame.executeJavaScript(code).catch(() => {});
}

// Electron n'exécute ce script que dans le cadre principal de chaque page (pas dans les iframes) ;
// les requêtes des cadres de la page de connexion reçoivent déjà la bonne identité côté réseau.
if (location.hostname === 'accounts.google.com') {
  const ua = ipcRenderer.sendSync('mire:signin-ua');
  if (ua) {
    const apply = (value) => {
      const appVersion = value.replace(/^Mozilla\//, '');
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => value, configurable: true });
      Object.defineProperty(Navigator.prototype, 'appVersion', { get: () => appVersion, configurable: true });
    };
    if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({ func: apply, args: [ua] });
    else webFrame.executeJavaScript(`(${apply.toString()})(${JSON.stringify(ua)})`);
  }
}
