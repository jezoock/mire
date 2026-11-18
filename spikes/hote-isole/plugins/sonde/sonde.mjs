// Plugin sonde : essaie, depuis le code d'un plugin, tout ce qu'un plugin ne doit pas pouvoir faire. Chaque essai
// rend un détail s'il a abouti, ou lève une erreur s'il a été refusé. Le processus principal juge le résultat avec ce
// qu'il observe lui-même (connexions reçues par ses serveurs, résolutions de noms du journal réseau, messages reçus).

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const extrait = (s) => String(s).slice(0, 120);

async function lire(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return extrait(await r.text());
}

/** Essais dans une page web ou son Worker (prototype A). */
function essaisPage(cfg) {
  const base = new URL('.', import.meta.url).href;
  const autre = `mire-plugin://${cfg.autreId}/mire-plugin.json`;
  const evenement = (creer, ok, ko) =>
    new Promise((resoudre, rejeter) => {
      const o = creer();
      o[ok] = () => resoudre('ouvert');
      o[ko] = () => rejeter(new Error('erreur'));
      setTimeout(() => rejeter(new Error('sans réponse en 3 s')), 3000);
    });
  return [
    ['fichier', 'fetch file:// hors du plugin', () => lire(`file://${cfg.secret}`)],
    ['fichier', 'import() file://', async () => (await import(`file://${cfg.secretModule}`)).default],
    ['fichier', 'mire-plugin:// avec ../', () => lire(`${base}../../hors/secret.txt`)],
    ['fichier', 'mire-plugin:// avec %2e%2e', () => lire(`${base}%2e%2e/%2e%2e/hors/secret.txt`)],
    ['fichier', 'mire-plugin:// avec ..%2f', () => lire(`${base}..%2f..%2fhors%2fsecret.txt`)],
    ['fichier', 'mire-plugin:// lien symbolique', () => lire(`${base}lien-secret.txt`)],
    ['fichier', 'mire-plugin:// autre identifiant', () => lire(autre)],
    ['reseau', 'fetch http://127.0.0.1', () => lire(`${cfg.http}/fetch`)],
    [
      'reseau',
      'XMLHttpRequest',
      () =>
        evenement(
          () => {
            const x = new XMLHttpRequest();
            x.open('GET', `${cfg.http}/xhr`);
            x.send();
            return x;
          },
          'onload',
          'onerror',
        ),
    ],
    ['reseau', 'WebSocket ws://127.0.0.1', () => evenement(() => new WebSocket(`${cfg.ws}/ws`), 'onopen', 'onerror')],
    [
      'reseau',
      'image http://',
      () =>
        evenement(
          () => {
            const i = new Image();
            i.src = `${cfg.http}/img`;
            return i;
          },
          'onload',
          'onerror',
        ),
    ],
    ['reseau', 'EventSource', () => evenement(() => new EventSource(`${cfg.http}/sse`), 'onopen', 'onerror')],
    ['reseau', 'sendBeacon', async () => (navigator.sendBeacon(`${cfg.http}/beacon`, 'x') ? 'mis en file' : Promise.reject(new Error('refusé')))],
    ['reseau', 'fetch https:// (nom de domaine)', () => lire(`https://${cfg.dns.https}/`)],
    [
      'reseau',
      'résolution de nom (dns-prefetch, preconnect)',
      async () => {
        for (const [rel, hote] of [
          ['dns-prefetch', cfg.dns.prefetch],
          ['preconnect', cfg.dns.preconnect],
        ]) {
          const l = document.createElement('link');
          l.rel = rel;
          l.href = `https://${hote}/`;
          document.head.append(l);
        }
        await attendre(1500);
        return 'liens ajoutés';
      },
    ],
    [
      'reseau',
      'WebTransport (QUIC vers 127.0.0.1)',
      async () => {
        const wt = new WebTransport(`https://127.0.0.1:${cfg.quic}/wt`);
        await Promise.race([wt.ready, attendre(3000).then(() => Promise.reject(new Error('sans réponse en 3 s')))]);
        return 'ouvert';
      },
    ],
    [
      'reseau',
      'WebRTC (STUN vers 127.0.0.1)',
      async () => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${cfg.udp}` }] });
        const candidats = [];
        pc.onicecandidate = (e) => e.candidate && candidats.push(e.candidate.type);
        pc.createDataChannel('x');
        await pc.setLocalDescription(await pc.createOffer());
        await attendre(2000);
        pc.close();
        return `candidats : ${candidats.join(', ') || 'aucun'}`;
      },
    ],
    [
      'processus',
      'contexte neuf (Worker imbriqué, où WebTransport reviendrait)',
      async () => {
        if (typeof Worker !== 'function') throw new Error('Worker absent');
        return 'Worker disponible';
      },
    ],
    [
      'processus',
      'Node (require, process, Buffer, module)',
      async () => {
        const g = /** @type {Record<string, unknown>} */ (globalThis);
        const presents = ['require', 'process', 'Buffer', 'module', 'global'].filter((n) => g[n] !== undefined);
        if (!presents.length) throw new Error('absents');
        return presents.join(', ');
      },
    ],
    [
      'processus',
      'API de la fenêtre et IPC (window.api, ipcRenderer, electron)',
      async () => {
        const g = /** @type {Record<string, unknown>} */ (globalThis);
        const presents = ['api', 'ipcRenderer', 'electron', 'mire'].filter((n) => g[n] !== undefined);
        if (!presents.length) throw new Error('absents');
        return presents.join(', ');
      },
    ],
    ['processus', 'window.open', async () => (window.open('mire-plugin://hote/index.html') ? 'fenêtre ouverte' : Promise.reject(new Error('refusé')))],
    [
      'processus',
      'navigation de l’hôte',
      async () => {
        location.href = `${cfg.http}/nav`;
        await attendre(1000);
        if (location.href.startsWith('mire-plugin:')) throw new Error('navigation annulée');
        return location.href;
      },
    ],
  ];
}

/** Essais dans un processus Node (prototype B). */
function essaisNode(cfg) {
  const dossier = new URL('.', import.meta.url).pathname;
  const fs = () => import('node:fs');
  const connecter = async (port) => {
    const net = await import('node:net');
    return new Promise((resoudre, rejeter) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.end('net');
        resoudre('connecté');
      });
      s.on('error', rejeter);
    });
  };
  return [
    ['fichier', 'fs.readFile hors du plugin', async () => extrait((await fs()).readFileSync(cfg.secret, 'utf8'))],
    ['fichier', 'import() file://', async () => (await import(`file://${cfg.secretModule}`)).default],
    ['fichier', 'fs.readFile avec ../', async () => extrait((await fs()).readFileSync(`${dossier}../../hors/secret.txt`, 'utf8'))],
    ['fichier', 'fs.readFile lien symbolique', async () => extrait((await fs()).readFileSync(`${dossier}lien-secret.txt`, 'utf8'))],
    ['fichier', 'fs.readFile autre plugin', async () => extrait((await fs()).readFileSync(`${dossier}../${cfg.autreId}/mire-plugin.json`, 'utf8'))],
    ['reseau', 'fetch http://127.0.0.1', () => lire(`${cfg.http}/fetch`)],
    ['reseau', 'net.connect 127.0.0.1', () => connecter(cfg.port)],
    [
      'reseau',
      'WebSocket ws://127.0.0.1',
      () =>
        new Promise((resoudre, rejeter) => {
          const w = new WebSocket(`${cfg.ws}/ws`);
          w.onopen = () => resoudre('ouvert');
          w.onerror = () => rejeter(new Error('erreur'));
        }),
    ],
    [
      'reseau',
      'UDP (dgram)',
      async () => {
        const dgram = await import('node:dgram');
        const s = dgram.createSocket('udp4');
        await new Promise((r, j) => s.send('udp', cfg.udp, '127.0.0.1', (e) => (e ? j(e) : r())));
        s.close();
        return 'envoyé';
      },
    ],
    [
      'reseau',
      'résolution de nom (dns.lookup)',
      async () => {
        const dns = await import('node:dns');
        const local = await dns.promises.lookup('localhost');
        const externe = await dns.promises.lookup(cfg.dns.https).then(
          (r) => r.address,
          (e) => e.code,
        );
        return `localhost → ${local.address} ; ${cfg.dns.https} → ${externe}`;
      },
    ],
    [
      'reseau',
      'module net d’Electron',
      async () => {
        const { net } = /** @type {any} */ (await import('electron'));
        const r = await net.fetch(`${cfg.http}/electron-net`);
        return `HTTP ${r.status}`;
      },
    ],
    [
      'processus',
      'process.parentPort (canal vers le processus principal)',
      async () => {
        const g = /** @type {any} */ (globalThis);
        g.process.parentPort.postMessage({ intrusion: true });
        return 'message envoyé';
      },
    ],
    [
      'processus',
      'lancer un programme (child_process)',
      async () => {
        const cp = await import('node:child_process');
        return extrait(cp.execFileSync('/bin/echo', ['lancé'], { encoding: 'utf8' }));
      },
    ],
    [
      'processus',
      'signal au processus principal (process.kill(ppid, 0))',
      async () => {
        const g = /** @type {any} */ (globalThis);
        return String(g.process.kill(g.process.ppid, 0));
      },
    ],
    [
      'processus',
      'variables d’environnement',
      async () => {
        const g = /** @type {any} */ (globalThis);
        const cles = Object.keys(g.process.env);
        if (!cles.length) throw new Error('vides');
        return cles.join(', ');
      },
    ],
  ];
}

export default function creer() {
  return {
    id: 'sonde',
    compute: () => null,
    async sonder(cfg) {
      const node = /** @type {any} */ (globalThis).process?.versions?.node;
      const essais = node ? essaisNode(cfg) : essaisPage(cfg);
      const resultats = [];
      for (const [categorie, nom, essai] of essais) {
        try {
          resultats.push({ categorie, nom, abouti: true, detail: extrait(await essai()) });
        } catch (err) {
          resultats.push({ categorie, nom, abouti: false, detail: extrait(err?.code ?? err?.message ?? err) });
        }
      }
      return resultats;
    },
  };
}
