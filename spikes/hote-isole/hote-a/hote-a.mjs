// Prototype A : page cachée, servie par mire-plugin://hote/. Le port arrive par le preload (seul à recevoir l'IPC),
// une seule fois. Le code des plugins tourne dans un Worker de la page (sans DOM : ni <link rel="dns-prefetch">, ni
// WebRTC, ni fenêtre, ni navigation) ; `?travailleur=0` le fait tourner dans la page elle-même, pour comparer.
import { demarrerHote } from './runtime.mjs';

const dansLaPage = new URLSearchParams(location.search).get('travailleur') === '0';

window.addEventListener('message', function recevoir(e) {
  if (e.source !== window || e.data !== 'mire-hote:port' || !e.ports[0]) return;
  window.removeEventListener('message', recevoir);
  if (dansLaPage) demarrerHote(e.ports[0], 'A');
  else new Worker('./travailleur.mjs', { type: 'module', name: 'plugins' }).postMessage('mire-hote:port', [e.ports[0]]);
});
