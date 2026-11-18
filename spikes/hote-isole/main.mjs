// Prototype de l'hôte isolé (P3-02) : processus principal. Crée des hôtes A (WebContents cachée) et B
// (utilityProcess), y charge le plugin d'essai tel quel, mesure, puis vérifie l'isolement avec le plugin sonde.
// Hors de Mire : rien ici n'est construit dans dist/ ni enregistré dans l'application.
//
//   xvfb-run -a npx electron spikes/hote-isole/main.mjs [--repetitions=10] [--elements=20000] [--lot=500]
//            [--seulement=mesures|verifications] [--sortie=resultats.json]
// (ajouter --no-sandbox seulement si l'on est root, ce qui désactive la sandbox du système : voir l'ADR)

import { app, BrowserWindow, MessageChannelMain, protocol, session, utilityProcess } from 'electron';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { creerCanal } from './canal.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const OPTIONS = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => a.slice(2).split('='))
    .map(([k, v]) => [k, v]),
);
const REPETITIONS = Number(OPTIONS.repetitions ?? 10);
const ELEMENTS = Number(OPTIONS.elements ?? 20000);
const LOT = Number(OPTIONS.lot ?? 500);
const MARQUEUR = 'SECRET-HORS-DU-PLUGIN';

protocol.registerSchemesAsPrivileged([{ scheme: 'mire-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// ---------------------------------------------------------------------------------------------------------------
// Outils

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const maintenant = () => performance.now();
const mediane = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Mémoire d'un processus, en Mo : RSS et PSS (part des pages partagées) sous Linux, sinon l'ensemble de travail. */
function memoire(pid) {
  try {
    const t = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const ko = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(t)?.[1] ?? NaN);
    return { rss: ko('Rss') / 1024, pss: ko('Pss') / 1024 };
  } catch {
    const m = app.getAppMetrics().find((x) => x.pid === pid);
    return { rss: m ? m.memory.workingSetSize / 1024 : NaN, pss: NaN };
  }
}

/** Mémoire de tous les processus de l'application (PSS, Mo). */
const memoireApp = () => app.getAppMetrics().reduce((s, m) => s + (memoire(m.pid).pss || 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// Plugins : copiés dans un dossier temporaire, comme userData/plugins/<id>/ (avec un fichier secret à côté et un lien
// symbolique vers lui dans la sonde, créés ici pour ne pas versionner de lien).

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-hote-'));
const PLUGINS_DIR = path.join(TMP, 'plugins');
const SECRET = path.join(TMP, 'hors', 'secret.txt');
const SECRET_MODULE = path.join(TMP, 'hors', 'secret.mjs');

function preparerPlugins() {
  fs.mkdirSync(path.dirname(SECRET), { recursive: true });
  fs.writeFileSync(SECRET, MARQUEUR);
  fs.writeFileSync(SECRET_MODULE, `export default '${MARQUEUR}';\n`);
  const manifeste = JSON.parse(fs.readFileSync(path.join(ICI, 'plugins', 'essai', 'mire-plugin.json'), 'utf8'));
  const essai = {
    id: manifeste.id,
    version: manifeste.version,
    source: 'essai',
    contributions: Object.entries(manifeste.contributes).flatMap(([kind, liste]) => liste.map((c) => ({ kind, id: c.id, main: c.main }))),
  };
  const fautif = (nom) => ({ id: `org.exemple.${nom}`, version: '0.0.0', source: nom, contributions: [{ kind: 'taggers', id: nom, main: `${nom}.mjs` }] });
  const plugins = { essai, sonde: fautif('sonde'), boucle: fautif('boucle'), memoire: fautif('memoire') };
  for (const p of Object.values(plugins)) {
    p.dossier = path.join(PLUGINS_DIR, p.id);
    fs.cpSync(path.join(ICI, 'plugins', p.source), p.dossier, { recursive: true });
  }
  fs.symlinkSync(SECRET, path.join(plugins.sonde.dossier, 'lien-secret.txt'));
  return plugins;
}

// ---------------------------------------------------------------------------------------------------------------
// Contexte relayé : ce que le processus principal répond aux appels `ctx` des plugins (factice ici, P3-04 ensuite).

async function traiterContexte(cible, methode, args) {
  if (!cible.startsWith('ctx:')) throw Object.assign(new Error(`${cible} : inconnu`), { code: 'not-found' });
  if (methode === 'http.getJson') {
    const q = new URL(args[0]).searchParams.get('q') ?? '';
    return { titre: q.replace(/\.[a-z0-9]+$/i, ''), annee: '2019', resume: 'Fiche inventée par le prototype (aucune connexion).' };
  }
  throw Object.assign(new Error(`${methode} : hors du prototype`), { code: 'not-found' });
}

// ---------------------------------------------------------------------------------------------------------------
// Prototype A : WebContents cachée

const HOTE_FICHIERS = {
  '/index.html': 'hote-a/index.html',
  '/hote-a.mjs': 'hote-a/hote-a.mjs',
  '/travailleur.mjs': 'hote-a/travailleur.mjs',
  '/runtime.mjs': 'runtime.mjs',
  '/canal.mjs': 'canal.mjs',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain' };
// Le CSP ne restreint que les scripts : les essais réseau éprouvent ainsi la session seule (voir l'ADR).
const CSP = "script-src mire-plugin:; object-src 'none'; base-uri 'none'";

/** Gestionnaire de mire-plugin:// d'un hôte : ses seuls plugins, en lecture, dans leur dossier. */
function servir(dossiers) {
  return async (req) => {
    const refus = (status) => new Response(null, { status });
    if (req.method !== 'GET') return refus(405);
    const url = new URL(req.url);
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return refus(400);
    }
    if (rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return refus(403);
    let fichier;
    if (url.hostname === 'hote') {
      if (!HOTE_FICHIERS[rel]) return refus(404);
      fichier = path.join(ICI, HOTE_FICHIERS[rel]);
    } else {
      const racine = dossiers.get(url.hostname);
      if (!racine) return refus(404);
      try {
        fichier = fs.realpathSync(path.join(racine, rel));
      } catch {
        return refus(404);
      }
      // Le chemin réel (liens symboliques résolus) doit rester dans le dossier du plugin.
      if (!fichier.startsWith(racine + path.sep)) return refus(403);
    }
    const contenu = await fs.promises.readFile(fichier).catch(() => null);
    if (!contenu) return refus(404);
    const entetes = {
      'content-type': MIME[path.extname(fichier)] ?? 'application/octet-stream',
      'access-control-allow-origin': 'mire-plugin://hote',
      'x-content-type-options': 'nosniff',
    };
    if (rel === '/index.html') entetes['content-security-policy'] = CSP;
    return new Response(contenu, { headers: entetes });
  };
}

let numero = 0;

async function creerHoteA(plugins, { journalReseau = null, parades = true, travailleur = true } = {}) {
  const dossiers = new Map(plugins.map((p) => [p.id, fs.realpathSync(p.dossier)]));
  // Partition sans « persist: » : en mémoire, propre à cet hôte.
  const ses = session.fromPartition(`mire-hote-a-${++numero}`);
  const observe = { refusees: [], fenetres: 0, navigations: 0 };
  ses.webRequest.onBeforeRequest((d, cb) => {
    const permis = d.url.startsWith('mire-plugin:');
    if (!permis) observe.refusees.push(d.url);
    cb({ cancel: !permis });
  });
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // Parades pour ce que webRequest ne voit pas (constaté par les vérifications) : la résolution de noms anticipée
  // (dns-prefetch) et l'UDP de WebRTC. Un proxy SOCKS5 injoignable laisse la résolution au proxy ; la politique
  // WebRTC interdit l'UDP qui ne passe pas par lui.
  if (parades) await ses.setProxy({ mode: 'fixed_servers', proxyRules: process.env.MIRE_PROXY ?? 'socks5://127.0.0.1:9' });
  ses.protocol.handle('mire-plugin', servir(dossiers));
  if (journalReseau) await ses.netLog.startLogging(journalReseau);

  const fenetre = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(ICI, 'hote-a', 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const wc = fenetre.webContents;
  if (parades) wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.setWindowOpenHandler(() => {
    observe.fenetres++;
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => {
    observe.navigations++;
    e.preventDefault();
  });
  await wc.loadURL(`mire-plugin://hote/index.html${travailleur ? '' : '?travailleur=0'}`);

  const { port1, port2 } = new MessageChannelMain();
  let pret;
  const enAttente = new Promise((r) => (pret = r));
  const canal = creerCanal(port1, { traiter: traiterContexte, surEvenement: (nom) => nom === 'pret' && pret() });
  wc.postMessage('mire-hote:port', null, [port2]);
  await enAttente;
  const pid = wc.getOSProcessId();

  return {
    canal,
    pid,
    observe,
    surFin(f) {
      wc.on('render-process-gone', (_e, d) => {
        canal.rompre(`Hôte arrêté (${d.reason}).`);
        f(d.reason);
      });
    },
    tuer: () => wc.forcefullyCrashRenderer(),
    async fermer() {
      canal.rompre('Hôte fermé.');
      if (journalReseau) await ses.netLog.stopLogging();
      if (!fenetre.isDestroyed()) fenetre.destroy();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Prototype B : utilityProcess, avec le modèle de permissions de Node (lecture limitée, ni programme, ni worker, ni
// module natif). Electron ignore --permission dans execArgv : il passe par NODE_OPTIONS dans l'environnement de
// l'enfant, environnement réduit à cela.

async function creerHoteB(plugins, { permissions = true } = {}) {
  const lecture = [ICI, ...plugins.map((p) => fs.realpathSync(p.dossier))];
  const env = { NODE_OPTIONS: permissions ? ['--permission', ...lecture.map((d) => `--allow-fs-read=${d}`)].join(' ') : '' };
  const enfant = utilityProcess.fork(path.join(ICI, 'hote-b.mjs'), [], { serviceName: `mire-hote-b-${++numero}`, stdio: 'pipe', env });
  const sortie = [];
  enfant.stdout.on('data', (d) => sortie.push(String(d)));
  enfant.stderr.on('data', (d) => sortie.push(String(d)));
  const observe = { messages: 0, sortie };
  await new Promise((r, j) => {
    enfant.once('spawn', r);
    enfant.once('exit', (c) => j(new Error(`hôte B sorti (${c}) : ${sortie.join('')}`)));
  });

  const { port1, port2 } = new MessageChannelMain();
  let pret;
  const enAttente = new Promise((r) => (pret = r));
  const canal = creerCanal(port1, { traiter: traiterContexte, surEvenement: (nom) => nom === 'pret' && pret() });
  enfant.postMessage('port', [port2]);
  enfant.on('message', () => observe.messages++);
  await enAttente;

  return {
    canal,
    pid: enfant.pid,
    observe,
    surFin(f) {
      enfant.on('exit', (code) => {
        canal.rompre(`Hôte arrêté (${code}).`);
        f(`exit ${code}`);
      });
    },
    tuer: () => enfant.kill(),
    async fermer() {
      canal.rompre('Hôte fermé.');
      enfant.kill();
    },
  };
}

const CREER = { A: creerHoteA, B: creerHoteB };

/** Base des adresses d'un plugin, telle que chaque hôte la voit. */
const base = (env, p) => (env === 'A' ? `mire-plugin://${p.id}/` : pathToFileURL(fs.realpathSync(p.dossier) + path.sep).href);
const charger = (hote, env, p) =>
  hote.canal.demander('hote', 'charger', [{ id: p.id, version: p.version, base: base(env, p), contributions: p.contributions }]);

// ---------------------------------------------------------------------------------------------------------------
// Mesures

function elementsFactices(n) {
  const qualites = ['720p', '1080p', 'DVDRip', '2160p', ''];
  return Array.from({ length: n }, (_, i) => ({
    key: `local:essai:${i}`,
    source: { plugin: 'src-local', instance: 'essai' },
    name: `Film numéro ${i} (${1950 + (i % 75)}) ${qualites[i % qualites.length]}.mkv`,
    open: { kind: 'file', path: `/films/film-${i}.mkv` },
    tags: ['video', 'file'],
    infos: { ext: 'mkv', size: 1e9 + i },
    images: {},
    added: 1_700_000_000_000 + i,
  }));
}

async function mesurerUneFois(env, plugins, elements) {
  const r = {};
  const cle = `${plugins.essai.id}:taggers/essai-tags`;
  let t = maintenant();
  const hote = await CREER[env]([plugins.essai]);
  r.demarrage = maintenant() - t;
  await attendre(1000);
  r.memVide = memoire(hote.pid);

  t = maintenant();
  await charger(hote, env, plugins.essai);
  r.chargement = maintenant() - t;
  await attendre(1000);
  r.memPlugin = memoire(hote.pid);

  // 20 000 éléments par lots de LOT (une requête par lot), aller et retour compris.
  t = maintenant();
  const lots = [];
  for (let i = 0; i < elements.length; i += LOT) lots.push(hote.canal.demander('hote', 'calculerLot', [cle, elements.slice(i, i + LOT)], { delai: 60000 }));
  const parLots = (await Promise.all(lots)).flat();
  r.lots = maintenant() - t;

  // Les mêmes, une requête par élément (toutes envoyées d'un coup).
  t = maintenant();
  const unitaires = await Promise.all(elements.map((e) => hote.canal.demander(cle, 'compute', [e], { delai: 60000 })));
  r.unitaires = maintenant() - t;
  if (parLots.length !== elements.length || unitaires.length !== elements.length || !parLots[1].tags.includes('essai')) throw new Error('résultats incomplets');
  await attendre(1000);
  r.memApres = memoire(hote.pid);

  // Infos en ligne factices : 50 appels successifs (plugin → ctx.http relayé au principal → plugin).
  const duree = [];
  const infos = `${plugins.essai.id}:metadata/essai-infos`;
  for (let i = 0; i < 50; i++) {
    t = maintenant();
    const fiche = await hote.canal.demander(infos, 'scrape', [elements[i], undefined]);
    duree.push(maintenant() - t);
    if (!fiche?.title) throw new Error('fiche absente');
  }
  r.infos = mediane(duree);
  await hote.fermer();
  return r;
}

async function mesurerPlusieurs(env, plugins, n) {
  await attendre(1500);
  const avant = memoireApp();
  const t = maintenant();
  const hotes = await Promise.all(
    Array.from({ length: n }, async () => {
      const h = await CREER[env]([plugins.essai]);
      await charger(h, env, plugins.essai);
      return h;
    }),
  );
  const demarrage = maintenant() - t;
  await attendre(1500);
  const hotesPss = hotes.reduce((s, h) => s + memoire(h.pid).pss, 0);
  const app = memoireApp() - avant;
  await Promise.all(hotes.map((h) => h.fermer()));
  return { n, demarrage, hotesPss, app };
}

async function mesures(plugins) {
  const elements = elementsFactices(ELEMENTS);
  const brut = { A: [], B: [] };
  const plusieurs = { A: {}, B: {} };
  for (let i = 0; i < REPETITIONS; i++) {
    // Ordre alterné d'une répétition à l'autre.
    for (const env of i % 2 ? ['B', 'A'] : ['A', 'B']) {
      brut[env].push(await mesurerUneFois(env, plugins, elements));
      process.stdout.write(`mesure ${env} ${i + 1}/${REPETITIONS}\n`);
    }
  }
  for (const n of [1, 3, 6]) {
    for (const env of ['A', 'B']) {
      const rs = [];
      for (let i = 0; i < Math.min(REPETITIONS, 5); i++) rs.push(await mesurerPlusieurs(env, plugins, n));
      plusieurs[env][n] = { demarrage: mediane(rs.map((r) => r.demarrage)), hotesPss: mediane(rs.map((r) => r.hotesPss)), app: mediane(rs.map((r) => r.app)) };
      process.stdout.write(`plusieurs hôtes ${env} ×${n}\n`);
    }
  }
  const resume = {};
  for (const env of ['A', 'B']) {
    const m = (f) => mediane(brut[env].map(f));
    resume[env] = {
      demarrage: m((r) => r.demarrage),
      chargement: m((r) => r.chargement),
      memVide: { rss: m((r) => r.memVide.rss), pss: m((r) => r.memVide.pss) },
      memPlugin: { rss: m((r) => r.memPlugin.rss), pss: m((r) => r.memPlugin.pss) },
      memApres: { rss: m((r) => r.memApres.rss), pss: m((r) => r.memApres.pss) },
      lots: m((r) => r.lots),
      unitaires: m((r) => r.unitaires),
      infos: m((r) => r.infos),
    };
  }
  return { resume, plusieurs, brut };
}

// ---------------------------------------------------------------------------------------------------------------
// Vérifications d'isolement

async function serveurs() {
  const touches = [];
  const serveur = http.createServer((req, res) => {
    touches.push(req.url);
    res.setHeader('access-control-allow-origin', '*');
    res.end('ouvert');
  });
  serveur.on('upgrade', (req, socket) => {
    touches.push(req.url);
    socket.destroy();
  });
  serveur.on('connection', (s) => s.on('data', (d) => String(d).startsWith('net') && touches.push('/net')));
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const udp = dgram.createSocket('udp4');
  let paquets = 0;
  udp.on('message', () => paquets++);
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  // Second port UDP pour WebTransport (QUIC), compté à part.
  const quic = dgram.createSocket('udp4');
  let paquetsQuic = 0;
  quic.on('message', () => paquetsQuic++);
  await new Promise((r) => quic.bind(0, '127.0.0.1', r));
  return {
    port: serveur.address().port,
    udp: udp.address().port,
    quic: quic.address().port,
    touches,
    paquets: () => paquets,
    paquetsQuic: () => paquetsQuic,
    fermer: () => {
      serveur.close();
      udp.close();
      quic.close();
    },
  };
}

/** Résolutions de noms tentées, d'après le journal réseau de la session (événements HOST_RESOLVER et DNS). */
function nomsResolus(fichier, noms) {
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch {
    return null;
  }
  const types = new Set(
    Object.entries(journal.constants.logEventTypes)
      .filter(([nom]) => /HOST_RESOLVER|DNS/.test(nom))
      .map(([, v]) => v),
  );
  const textes = journal.events.filter((e) => types.has(e.type)).map((e) => JSON.stringify(e.params ?? {}));
  if (process.env.DEBUG_JOURNAL) {
    const nomType = Object.fromEntries(Object.entries(journal.constants.logEventTypes).map(([k, v]) => [v, k]));
    for (const e of journal.events)
      if (noms.some((n) => JSON.stringify(e).includes(n))) process.stdout.write(`${nomType[e.type]} ${JSON.stringify(e.params)}\n`);
  }
  return noms.filter((n) => textes.some((t) => t.includes(n)));
}

/** Un essai réseau aboutit s'il le dit ou si le principal a observé son passage (serveur, UDP, résolution de nom). */
function juger(env, resultats, obs) {
  const chemin = {
    fetch: '/fetch',
    XMLHttpRequest: '/xhr',
    WebSocket: '/ws',
    image: '/img',
    EventSource: '/sse',
    sendBeacon: '/beacon',
    'net.connect': '/net',
  };
  return resultats.map((r) => {
    let isole;
    let preuve = r.detail;
    if (r.categorie === 'fichier') isole = !r.abouti && !String(r.detail).includes(MARQUEUR);
    else if (r.categorie === 'reseau') {
      const mot = Object.keys(chemin).find((k) => r.nom.startsWith(k));
      const vu = mot && obs.touches.includes(chemin[mot]);
      if (r.nom.startsWith('WebTransport')) isole = obs.paquetsQuic === 0 && !r.abouti;
      else if (r.nom.startsWith('WebRTC') || r.nom.startsWith('UDP')) isole = obs.paquets === 0 && !(r.nom.startsWith('UDP') && r.abouti);
      else if (r.nom.startsWith('résolution')) isole = env === 'A' ? obs.resolus?.length === 0 : !r.abouti;
      else if (r.nom.startsWith('sendBeacon')) isole = !vu;
      else if (r.nom.startsWith('fetch https')) isole = !r.abouti && !obs.resolus?.includes(obs.dns.https);
      else isole = !r.abouti && !vu;
      if (r.nom.startsWith('WebTransport')) preuve += ` ; paquets QUIC reçus : ${obs.paquetsQuic}`;
      if (r.nom.startsWith('WebRTC') || r.nom.startsWith('UDP')) preuve += ` ; paquets UDP reçus : ${obs.paquets}`;
      if (r.nom.startsWith('résolution') && env === 'A') preuve += ` ; noms résolus (journal réseau) : ${obs.resolus?.join(', ') || 'aucun'}`;
      if (vu) preuve += ' ; reçu par le serveur';
    } else {
      isole = !r.abouti;
      if (r.nom.startsWith('process.parentPort')) {
        isole = obs.messages === 0;
        preuve += ` ; messages reçus par le principal : ${obs.messages}`;
      }
      if (r.nom.startsWith('window.open')) preuve += ` ; ouvertures refusées : ${obs.fenetres}`;
      if (r.nom.startsWith('navigation')) preuve += ` ; navigations annulées : ${obs.navigations}`;
    }
    return { ...r, isole, preuve };
  });
}

async function verifierIsolement(env, plugins, options = {}) {
  const srv = await serveurs();
  const jeton = Math.random().toString(36).slice(2, 10);
  const dns = {
    https: `sonde-https-${jeton}.example.com`,
    prefetch: `sonde-prefetch-${jeton}.example.com`,
    preconnect: `sonde-preconnect-${jeton}.example.com`,
  };
  const journal = env === 'A' ? path.join(TMP, `journal-reseau-${jeton}.json`) : null;
  const hote = await CREER[env]([plugins.sonde], { ...options, journalReseau: journal });
  await charger(hote, env, plugins.sonde);
  const cfg = {
    http: `http://127.0.0.1:${srv.port}/sonde`,
    ws: `ws://127.0.0.1:${srv.port}/sonde`,
    port: srv.port,
    udp: srv.udp,
    quic: srv.quic,
    secret: SECRET,
    secretModule: SECRET_MODULE,
    autreId: plugins.essai.id,
    dns,
  };
  const resultats = await hote.canal.demander(`${plugins.sonde.id}:taggers/sonde`, 'sonder', [cfg], { delai: 60000 });
  await attendre(1000);
  const observe = { ...hote.observe };
  await hote.fermer();
  srv.fermer();
  const touches = srv.touches.map((u) => u.replace(/^\/sonde/, ''));
  const resolus = journal ? nomsResolus(journal, Object.values(dns)) : null;
  return juger(env, resultats, { ...observe, touches, paquets: srv.paquets(), paquetsQuic: srv.paquetsQuic(), resolus, dns });
}

/** Retard maximal de la boucle d'événements du principal pendant `f`. */
async function avecRetard(f) {
  let max = 0;
  let prevu = maintenant() + 10;
  const minuterie = setInterval(() => {
    max = Math.max(max, maintenant() - prevu);
    prevu = maintenant() + 10;
  }, 10);
  try {
    return { ...(await f()), retardPrincipal: max };
  } finally {
    clearInterval(minuterie);
  }
}

/**
 * Plugin fautif : `boucle` (boucle sans fin) ou `memoire` (épuise la mémoire). Un chien de garde envoie un ping
 * toutes les 250 ms (délai 500 ms) ; au premier ping sans réponse, l'hôte est arrêté. Un autre hôte, sain, doit
 * continuer de répondre pendant ce temps.
 */
async function verifierFautif(env, plugins, nom) {
  const sain = await CREER[env]([plugins.essai]);
  await charger(sain, env, plugins.essai);
  const hote = await CREER[env]([plugins[nom]]);
  await charger(hote, env, plugins[nom]);
  return avecRetard(async () => {
    let fin;
    const termine = new Promise((r) => (fin = r));
    let raison = null;
    hote.surFin((r) => {
      raison = r;
      fin(maintenant());
    });
    const t0 = maintenant();
    hote.canal.demander(`${plugins[nom].id}:taggers/${nom}`, 'compute', [{ name: 'x' }], { delai: 0 }).catch(() => {});
    let detecte = null;
    let pingsSains = 0;
    let pingsSainsRates = 0;
    const garde = setInterval(() => {
      hote.canal.demander('hote', 'ping', [], { delai: 500 }).catch((e) => {
        if (detecte === null && e.code === 'timeout') {
          detecte = maintenant();
          hote.tuer();
        }
      });
      sain.canal.demander('hote', 'ping', [], { delai: 500 }).then(
        () => pingsSains++,
        () => pingsSainsRates++,
      );
    }, 250);
    const arrete = await Promise.race([termine, attendre(60000).then(() => null)]);
    clearInterval(garde);
    const sainRepond = await sain.canal.demander('hote', 'ping', [], { delai: 1000 }).then(
      () => true,
      () => false,
    );
    await sain.fermer();
    await hote.fermer();
    return {
      raison,
      detection: detecte === null ? null : detecte - t0,
      arret: arrete === null ? null : arrete - (detecte ?? t0),
      total: arrete === null ? null : arrete - t0,
      chienDeGarde: detecte !== null,
      pingsSains,
      pingsSainsRates,
      sainRepond,
    };
  });
}

async function verifications(plugins) {
  const sortie = {};
  // Chaque prototype avec ses parades, puis sans (pour montrer ce que chacune apporte).
  const configurations = [
    ['A', 'A', {}],
    ['B', 'B', {}],
    ['A, plugins dans la page', 'A', { travailleur: false }],
    ['A, plugins dans la page, sans parades', 'A', { travailleur: false, parades: false }],
    ['B sans permissions de Node', 'B', { permissions: false }],
  ];
  for (const [nom, env, options] of configurations) {
    sortie[nom] = { isolement: await verifierIsolement(env, plugins, options) };
    if (nom === env) {
      sortie[nom].boucle = await verifierFautif(env, plugins, 'boucle');
      sortie[nom].memoire = await verifierFautif(env, plugins, 'memoire');
    }
    process.stdout.write(`vérifications ${nom} faites\n`);
  }
  return sortie;
}

// ---------------------------------------------------------------------------------------------------------------
// Rapport

const mo = (x) => (Number.isFinite(x) ? `${x.toFixed(1)} Mo` : '—');
const ms = (x) => (Number.isFinite(x) ? `${x < 10 ? x.toFixed(2) : Math.round(x)} ms` : '—');

function rapport(res) {
  const l = [];
  const machine = res.machine;
  l.push(
    `Machine : ${machine.cpu} (${machine.coeurs} cœurs), ${machine.memoire} Go, ${machine.systeme} ; Electron ${machine.electron}, Chromium ${machine.chrome}, Node ${machine.node} ; sandbox du système : ${machine.sandbox}.`,
  );
  if (res.mesures) {
    const { resume: r, plusieurs } = res.mesures;
    l.push(
      '',
      `Médianes de ${REPETITIONS} répétitions (${ELEMENTS} éléments, lots de ${LOT}).`,
      '',
      '| Mesure | A (WebContents) | B (utilityProcess) |',
      '| --- | --- | --- |',
    );
    const ligne = (nom, f) => l.push(`| ${nom} | ${f(r.A)} | ${f(r.B)} |`);
    ligne('Démarrage d’un hôte vide (jusqu’au premier message)', (x) => ms(x.demarrage));
    ligne('Chargement du plugin d’essai', (x) => ms(x.chargement));
    ligne('Mémoire, hôte vide (PSS / RSS)', (x) => `${mo(x.memVide.pss)} / ${mo(x.memVide.rss)}`);
    ligne('Mémoire, plugin chargé (PSS / RSS)', (x) => `${mo(x.memPlugin.pss)} / ${mo(x.memPlugin.rss)}`);
    ligne(`Mémoire, après ${ELEMENTS} éléments (PSS / RSS)`, (x) => `${mo(x.memApres.pss)} / ${mo(x.memApres.rss)}`);
    ligne(`${ELEMENTS} éléments, lots de ${LOT} (aller et retour)`, (x) => ms(x.lots));
    ligne(`${ELEMENTS} éléments, une requête chacun`, (x) => ms(x.unitaires));
    ligne('Infos en ligne factices (un appel, relais ctx.http compris)', (x) => ms(x.infos));
    for (const n of Object.keys(plusieurs.A)) {
      const [a, b] = [plusieurs.A[n], plusieurs.B[n]];
      l.push(
        `| ${n} hôte(s) avec le plugin : PSS des hôtes / hausse de l\u2019application | ${mo(a.hotesPss)} / ${mo(a.app)} | ${mo(b.hotesPss)} / ${mo(b.app)} |`,
      );
      l.push(`| ${n} hôte(s) : démarrage et chargement en parallèle | ${ms(a.demarrage)} | ${ms(b.demarrage)} |`);
    }
  }
  if (res.verifications) {
    for (const env of Object.keys(res.verifications)) {
      const v = res.verifications[env];
      l.push('', `Vérifications ${env} :`, '', '| Essai | Isolé | Détail |', '| --- | --- | --- |');
      for (const e of v.isolement) l.push(`| ${e.nom} | ${e.isole ? 'oui' : '**non**'} | ${String(e.preuve).replace(/\|/g, '/')} |`);
      for (const nom of ['boucle', 'memoire'].filter((n) => v[n])) {
        const f = v[nom];
        l.push(
          `| plugin ${nom === 'boucle' ? 'qui boucle' : 'qui épuise la mémoire'} | ${f.total !== null && f.sainRepond ? 'oui' : '**non**'} | ` +
            `${f.chienDeGarde ? `détecté par le chien de garde en ${ms(f.detection)}, arrêté en ${ms(f.arret)}` : `hôte tombé seul (${f.raison}) en ${ms(f.total)}`} ; ` +
            `autre hôte : ${f.pingsSains} pings, ${f.pingsSainsRates} sans réponse ; retard max. du principal ${ms(f.retardPrincipal)} |`,
        );
      }
    }
  }
  return l.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let code = 0;
  try {
    const plugins = preparerPlugins();
    const res = {
      machine: {
        cpu: os.cpus()[0]?.model ?? '?',
        coeurs: os.cpus().length,
        memoire: Math.round(os.totalmem() / 2 ** 30),
        systeme: `${os.type()} ${os.release()}`,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        sandbox: app.commandLine.hasSwitch('no-sandbox') ? 'désactivée (--no-sandbox)' : 'active',
      },
      options: { repetitions: REPETITIONS, elements: ELEMENTS, lot: LOT },
    };
    if (OPTIONS.seulement !== 'verifications') res.mesures = await mesures(plugins);
    if (OPTIONS.seulement !== 'mesures') res.verifications = await verifications(plugins);
    if (OPTIONS.sortie) fs.writeFileSync(path.resolve(OPTIONS.sortie), JSON.stringify(res, null, 2));
    process.stdout.write(`\n${rapport(res)}\n`);
    // Code de sortie : 1 si le prototype retenu (A, avec ses parades) laisse passer un essai.
    code = res.verifications?.A.isolement.some((e) => !e.isole) ? 1 : 0;
  } catch (err) {
    process.stderr.write(`${err.stack ?? err}\n`);
    code = 2;
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    app.exit(code);
  }
});
