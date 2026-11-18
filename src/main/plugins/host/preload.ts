/**
 * Preload de l'hôte isolé (sandbox, monde isolé) : n'expose rien. Il transmet seulement à la page, une seule fois,
 * le port de contrôle envoyé par le processus principal. Aucun autre message IPC n'est reçu ni envoyé.
 */
import { ipcRenderer } from 'electron';

ipcRenderer.once('mire-host:port', (e) => window.postMessage('mire-host:port', '*', e.ports as unknown as Transferable[]));
