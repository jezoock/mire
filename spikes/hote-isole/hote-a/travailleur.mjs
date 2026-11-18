// Worker des plugins de l'hôte A : reçoit le port une fois, puis le runtime répond par lui. La page n'écoute pas
// les messages du Worker.
import { demarrerHote } from './runtime.mjs';

self.onmessage = (e) => {
  if (e.data !== 'mire-hote:port' || !e.ports[0]) return;
  self.onmessage = null;
  demarrerHote(e.ports[0], 'A');
};
