// Preload de l'hôte A (sandbox, monde isolé) : n'expose rien, transmet seulement le port du processus principal à la
// page, une seule fois. Aucun autre message IPC n'est reçu ni envoyé.
const { ipcRenderer } = require('electron');

ipcRenderer.once('mire-hote:port', (e) => window.postMessage('mire-hote:port', '*', e.ports));
