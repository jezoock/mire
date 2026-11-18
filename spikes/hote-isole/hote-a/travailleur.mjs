// Worker des plugins de l'hôte A : reçoit le port une fois, puis le runtime répond par lui. La page n'écoute pas
// les messages du Worker.
import { demarrerHote } from './runtime.mjs';

// Retirés avant tout code de plugin : WebTransport (QUIC), que ni webRequest, ni le proxy, ni disableBlinkFeatures,
// ni --disable-quic n'arrêtent (constaté), et Worker, qui ouvrirait un contexte neuf où il reviendrait. Un Worker n'a
// pas d'autre moyen de créer un contexte (ni iframe, ni fenêtre).
for (const nom of ['WebTransport', 'Worker']) delete self[nom];

self.onmessage = (e) => {
  if (e.data !== 'mire-hote:port' || !e.ports[0]) return;
  self.onmessage = null;
  demarrerHote(e.ports[0], 'A');
};
