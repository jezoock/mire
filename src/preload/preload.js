'use strict';
// Seul point de contact entre l'interface et le système : chaque fonction appelle le processus principal.
// Les méthodes et les abonnements viennent du contrat IPC (@mire/shared/ipc) ; rien d'autre n'est exposé.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { createApi } = require('@mire/shared/ipc');

contextBridge.exposeInMainWorld('api', {
  ...createApi(ipcRenderer),
  // Chemin d'un fichier glissé-déposé : résolu dans le preload, sans passer par le processus principal.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
