'use strict';
/**
 * Chargé dans le processus principal d'Electron par le test de fumée (option -r d'Electron) :
 * note chaque requête sortante de Node (fetch, http, https, sockets) dans le fichier MIRE_E2E_NETLOG.
 * Les requêtes de Chromium (pages, vues web, composants) passent, elles, par le proxy du test.
 */
const dc = require('node:diagnostics_channel');
const fs = require('node:fs');

const file = process.env.MIRE_E2E_NETLOG;
const LOOPBACK = /^(127\.|::1$|::ffff:127\.|localhost$)/;

function note(kind, target) {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${JSON.stringify({ kind, target })}\n`);
  } catch {
    /* journal indisponible : le test le verra */
  }
}

note('pret', String(process.pid));
dc.subscribe('undici:request:create', ({ request }) => note('fetch', `${request.origin}${request.path}`));
dc.subscribe('http.client.request.start', ({ request }) => note('http', `${request.protocol}//${request.host}${request.path}`));
dc.subscribe('net.client.socket', ({ socket }) => {
  socket.once('connectionAttempt', (ip, port) => {
    if (!LOOPBACK.test(ip)) note('socket', `${ip}:${port}`);
  });
});
