/**
 * Page de l'hôte isolé (`mire-plugin://host/index.html`, ADR 0002) : ne fait tourner aucun code de plugin. Elle
 * reçoit du processus principal un port de contrôle, puis, pour chaque plugin, un port à lui : elle crée un Worker
 * par plugin (un contexte JavaScript à lui) et lui transmet ce port. Le processus principal reconnaît le plugin par
 * ce port, jamais par un champ des messages.
 *
 * Contrôle (processus principal → page) : `{ t: 'start', key }` avec le port du plugin, `{ t: 'stop', key }`.
 * Page → processus principal : `{ t: 'ready' }`, `{ t: 'worker-error', key, message }`.
 */

const workers = new Map<string, Worker>();
let control: MessagePort | null = null;

function onControl(e: MessageEvent): void {
  const m = e.data as { t?: unknown; key?: unknown } | null;
  if (!m || typeof m.key !== 'string') return;
  const key = m.key;
  if (m.t === 'start' && e.ports[0] && !workers.has(key)) {
    const w = new Worker('./worker.js', { type: 'module', name: key });
    // Exception non rattrapée du plugin (hors d'une requête), ou module illisible : le processus principal décide.
    w.onerror = (ev) => {
      ev.preventDefault();
      control?.postMessage({ t: 'worker-error', key, message: ev.message || 'Erreur du Worker.' });
    };
    w.postMessage('mire-host:port', [e.ports[0]]);
    workers.set(key, w);
  } else if (m.t === 'stop') {
    workers.get(key)?.terminate();
    workers.delete(key);
  }
}

window.addEventListener('message', function receive(e: MessageEvent) {
  if (e.source !== window || e.data !== 'mire-host:port' || !e.ports[0]) return;
  window.removeEventListener('message', receive);
  control = e.ports[0];
  control.onmessage = onControl;
  control.postMessage({ t: 'ready' });
});
