'use strict';
/**
 * Gestionnaire de téléchargements de Mire.
 *
 * - HTTP : ce qui est téléchargé depuis les navigateurs intégrés, les jeux des sources web
 *   (« Télécharger sur cet ordinateur ») et les liens collés dans Téléchargements.
 *   Le téléchargement est confié à Chromium (pause et reprise comprises).
 * - Torrents : client intégré (WebTorrent, connexions TCP et DHT comme les clients de bureau),
 *   ou bien lien magnet / fichier .torrent confié au logiciel de torrent installé.
 *
 * Pour une console, les fichiers vont dans son dossier principal ; une archive que son
 * émulateur ne sait pas lire est décompressée. Un programme d'installation trouvé dans
 * un téléchargement terminé est signalé (bouton « Lancer l'installation »).
 */
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const disc = require('./discfiles.js');

const ACTIVE = new Set(['waiting', 'downloading', 'extracting']);
const PENDING = 'pending'; // bookmark de téléchargement : en attente, ne démarre qu'à la demande
const ARCHIVES = new Set(['.zip', '.7z']);

// Programmes d'installation, selon le système.
const INSTALLER = {
  win32: (n) => /^(setup|install|installer|installation)[^\\/]*\.exe$/i.test(n) || /\.msi$/i.test(n),
  darwin: (n) => /\.(pkg|dmg)$/i.test(n),
  linux: (n) => /\.appimage$/i.test(n) || /^(setup|install|installer)[^/]*\.(sh|run)$/i.test(n),
};

const safeName = (s) => String(s || 'fichier').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 200) || 'fichier';
const newId = () => crypto.randomBytes(6).toString('hex');

function createDownloads({ dataDir, getConfig, getSession, extract, shell, defaultDir, onChange, onFinished }) {
  const listFile = path.join(dataDir, 'telechargements.json');
  const torrentDir = path.join(dataDir, 'torrents');
  const items = new Map(); // id → fiche affichée (enregistrée sur le disque)
  const live = new Map(); // id → { dl: DownloadItem } ou { torrent }
  const pendingUrls = new Map(); // adresse → contexte d'un téléchargement demandé par Mire
  let client = null;
  let clientLoading = null;
  let saveTimer = 0;

  const settings = () => ({ dir: '', torrentClient: 'mire', seed: false, ...(getConfig().downloads || {}) });
  const baseDir = () => settings().dir || defaultDir;

  function load() {
    try {
      for (const it of JSON.parse(fs.readFileSync(listFile, 'utf8')).items || []) {
        // Après un redémarrage : les HTTP inachevés sont à relancer ; les torrents reprennent tout seuls.
        if (it.state !== PENDING && it.kind === 'http' && (ACTIVE.has(it.state) || it.state === 'paused')) Object.assign(it, { state: 'interrupted', speed: 0 });
        if (it.kind === 'torrent' && it.state === 'extracting') it.state = 'done';
        items.set(it.id, it);
      }
    } catch { /* première fois */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(dataDir, { recursive: true });
      const list = [...items.values()].map(({ installers, ...rest }) => ({ ...rest, installers: installers || [] }));
      fs.writeFileSync(listFile, JSON.stringify({ items: list }, null, 1));
    }, 300);
  }
  function update(it, patch = {}) {
    Object.assign(it, patch);
    save();
    onChange(it);
  }

  // Dossier de destination : celui de la console, sinon le dossier des téléchargements.
  function destFor(ctx) {
    const emu = ctx?.console != null ? getConfig().emulators[ctx.console] : null;
    if (emu?.romsDir) return { dir: emu.romsDir, console: ctx.console, consoleName: emu.name, extensions: emu.extensions || [] };
    return { dir: baseDir(), console: null, consoleName: '', extensions: [] };
  }

  /* ---------- HTTP ---------- */

  // Téléchargement demandé par Mire (jeu d'une source web, lien collé).
  function addUrl(url, ctx = {}) {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Adresse invalide : elle doit commencer par http:// ou https://.' };
    pendingUrls.set(url, ctx);
    getSession().downloadURL(url);
    return { ok: true };
  }

  // Tout téléchargement HTTP passe par ici (navigateurs intégrés compris).
  function handleWebDownload(dl, ctxFromView) {
    const url = dl.getURL();
    const chain = dl.getURLChain ? dl.getURLChain() : [url];
    const key = chain.find((u) => pendingUrls.has(u));
    const ctx = key ? pendingUrls.get(key) : ctxFromView || {};
    if (key) pendingUrls.delete(key);
    const filename = safeName(dl.getFilename());

    // Un fichier .torrent devient un téléchargement torrent.
    if (/\.torrent$/i.test(filename) || dl.getMimeType() === 'application/x-bittorrent') {
      fs.mkdirSync(path.join(torrentDir, 'recus'), { recursive: true });
      const tmp = path.join(torrentDir, 'recus', `${Date.now()}-${filename}`);
      dl.setSavePath(tmp);
      dl.once('done', (_e, state) => { if (state === 'completed') addTorrent(tmp, ctx); });
      return;
    }

    const dest = destFor(ctx);
    let file;
    if (ctx.saveAs) {
      // Fichier d'un jeu sur disque : il doit porter exactement le nom cité par l'index.
      file = ctx.saveAs;
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } else {
      fs.mkdirSync(dest.dir, { recursive: true });
      const ext = path.extname(filename);
      file = path.join(dest.dir, filename);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dest.dir, `${path.basename(filename, ext)} (${n})${ext}`);
    }
    dl.setSavePath(file);

    const retry = ctx.retryOf ? items.get(ctx.retryOf) : null;
    const it = retry || { id: newId(), kind: 'http', createdAt: Date.now() };
    Object.assign(it, {
      name: path.basename(file), source: chain[0] || url, file, dir: path.dirname(file), console: dest.console, consoleName: dest.consoleName,
      state: 'downloading', received: 0, total: dl.getTotalBytes(), speed: 0, error: '', installers: [], extracted: false,
      group: ctx.group || it.group || '', companionsQueued: !!(ctx.companionsQueued || it.companionsQueued),
      gameBookmark: ctx.gameBookmark || it.gameBookmark || null,
    });
    items.set(it.id, it);
    live.set(it.id, { dl });
    update(it);

    let lastBytes = 0;
    let lastTime = Date.now();
    let lastSent = 0;
    dl.on('updated', (_e, state) => {
      const now = Date.now();
      if (state === 'interrupted') { update(it, { state: 'downloading', speed: 0 }); return; }
      if (dl.isPaused()) { if (it.state !== 'paused') update(it, { state: 'paused', speed: 0 }); return; }
      if (now - lastSent < 500) return;
      const received = dl.getReceivedBytes();
      const speed = Math.max(0, ((received - lastBytes) * 1000) / Math.max(1, now - lastTime));
      lastBytes = received;
      lastTime = now;
      lastSent = now;
      update(it, { state: 'downloading', received, total: dl.getTotalBytes(), speed });
    });
    dl.once('done', async (_e, state) => {
      live.delete(it.id);
      if (state === 'cancelled') { update(it, { state: 'cancelled', speed: 0 }); return; }
      if (state !== 'completed') { update(it, { state: 'error', speed: 0, error: 'Le téléchargement a été interrompu (connexion perdue ou fichier indisponible).' }); return; }
      update(it, { received: dl.getReceivedBytes(), total: dl.getReceivedBytes(), speed: 0 });
      await finish(it, [file]);
    });
  }

  // Texte d'un petit fichier distant (index de jeu sur disque), par la session des pages.
  async function fetchText(url) {
    const res = await getSession().fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`code ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) throw new Error('fichier trop gros pour un index');
    return disc.decode(buf);
  }

  /* ---------- Torrents ---------- */

  async function getClient() {
    if (client) return client;
    if (!clientLoading) {
      clientLoading = (async () => {
        // uTP (module natif facultatif) n'est pas installé : on tait l'avertissement de WebTorrent.
        const warn = console.warn;
        console.warn = () => {};
        let WebTorrent;
        try { ({ default: WebTorrent } = await import('webtorrent')); } finally { console.warn = warn; }
        client = new WebTorrent({ utp: false });
        client.on('error', (err) => console.error('Torrents :', err.message));
        return client;
      })();
    }
    return clientLoading;
  }

  // source : lien magnet, ou chemin d'un fichier .torrent.
  async function addTorrent(source, ctx = {}, existing = null) {
    const isMagnet = /^magnet:\?/i.test(source);
    if (!isMagnet && !fs.existsSync(source)) return { ok: false, error: 'Fichier .torrent introuvable.' };

    // Logiciel installé : Mire lui confie le lien ou le fichier, sans suivre la progression.
    if (settings().torrentClient === 'system' && !existing) {
      try {
        if (isMagnet) await shell.openExternal(source);
        else { const err = await shell.openPath(source); if (err) throw new Error(err); }
      } catch (err) {
        return { ok: false, error: `Aucun logiciel de torrent ne s'est ouvert (${err.message}). Installez-en un (qBittorrent, Transmission…) ou choisissez le client intégré dans les réglages de Téléchargements.` };
      }
      const it = { id: newId(), kind: 'torrent', createdAt: Date.now(), name: torrentLabel(source), source, dir: '', console: null, consoleName: '', state: 'external', received: 0, total: 0, speed: 0, peers: 0, error: '', installers: [] };
      items.set(it.id, it);
      update(it);
      return { ok: true, id: it.id, external: true };
    }

    let c;
    try { c = await getClient(); } catch (err) { return { ok: false, error: `Le client torrent intégré n'a pas pu démarrer (${err.message}).` }; }

    // Même torrent (même empreinte) : on reprend sa fiche au lieu d'en créer une seconde.
    const hash = await infoHashOf(source, isMagnet);
    if (hash && !existing) {
      const same = [...items.values()].find((x) => x.kind === 'torrent' && x.infoHash === hash);
      if (same && live.has(same.id)) return { ok: true, id: same.id, duplicate: true };
      if (same) {
        existing = same;
        const d = destFor(ctx);
        Object.assign(existing, { dir: d.dir, console: d.console, consoleName: d.consoleName, received: 0 });
      }
    }
    if (hash) {
      const stale = await c.get(hash);
      if (stale) await new Promise((resolve) => { stale.destroy({ destroyStore: false }, () => resolve()); });
    }
    const dest = existing ? { dir: existing.dir, console: existing.console, consoleName: existing.consoleName } : destFor(ctx);
    fs.mkdirSync(dest.dir, { recursive: true });
    const it = existing || { id: newId(), kind: 'torrent', createdAt: Date.now() };
    Object.assign(it, {
      name: it.name || torrentLabel(source), source, dir: dest.dir, console: dest.console, consoleName: dest.consoleName,
      state: 'waiting', speed: 0, peers: 0, error: '', installers: it.installers || [], infoHash: hash || it.infoHash,
    });
    items.set(it.id, it);
    update(it);

    let torrent;
    try {
      // Un lien magnet garde ses traqueurs et adresses de pairs : on repart toujours de lui. Un fichier
      // .torrent disparu (fichier reçu temporaire) est remplacé par la copie gardée par Mire.
      const addSource = isMagnet || fs.existsSync(source) ? source : it.torrentFile && fs.existsSync(it.torrentFile) ? it.torrentFile : source;
      torrent = c.add(addSource, { path: dest.dir });
    } catch (err) {
      update(it, { state: 'error', error: `Torrent illisible (${err.message}).` });
      return { ok: false, error: it.error };
    }
    live.set(it.id, { torrent });
    torrent.on('error', (err) => { live.delete(it.id); update(it, { state: 'error', speed: 0, error: `Erreur du torrent : ${err.message}` }); });
    torrent.on('metadata', async () => {
      // Le fichier .torrent est gardé : la reprise n'a plus besoin de retrouver les métadonnées.
      try {
        fs.mkdirSync(torrentDir, { recursive: true });
        const tf = path.join(torrentDir, `${torrent.infoHash}.torrent`);
        await fsp.writeFile(tf, torrent.torrentFile);
        it.torrentFile = tf;
      } catch { /* sans copie locale */ }
      update(it, { name: torrent.name, total: torrent.length, infoHash: torrent.infoHash, files: torrent.files.length, state: 'downloading' });
    });
    let lastSent = 0;
    torrent.on('download', () => {
      if (Date.now() - lastSent < 600) return;
      lastSent = Date.now();
      update(it, { state: 'downloading', received: torrent.downloaded, total: torrent.length, speed: torrent.downloadSpeed, peers: torrent.numPeers, eta: torrent.timeRemaining });
    });
    torrent.on('done', async () => {
      const files = torrent.files.map((f) => path.join(dest.dir, f.path));
      update(it, { received: torrent.length, total: torrent.length, speed: 0, peers: torrent.numPeers });
      if (!settings().seed) {
        live.delete(it.id);
        torrent.destroy({ destroyStore: false });
      }
      await finish(it, files);
    });
    return { ok: true, id: it.id };
  }

  async function infoHashOf(source, isMagnet) {
    try {
      const { default: parseTorrent } = await import('parse-torrent');
      const parsed = await parseTorrent(isMagnet ? source : await fsp.readFile(source));
      return parsed?.infoHash || null;
    } catch { return null; }
  }

  function torrentLabel(source) {
    if (/^magnet:\?/i.test(source)) {
      try { return new URLSearchParams(source.slice(8)).get('dn') || 'Torrent'; } catch { return 'Torrent'; }
    }
    return path.basename(source).replace(/^\d+-/, '').replace(/\.torrent$/i, '');
  }

  /* ---------- Fin d'un téléchargement : décompression, programme d'installation ---------- */

  async function finish(it, files) {
    const readable = new Set((destFor({ console: it.console }).extensions || []).map((x) => String(x).toLowerCase()));
    const out = [];
    if (it.console != null) {
      // Archive que l'émulateur ne lit pas : décompressée dans un dossier à son nom.
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!ARCHIVES.has(ext) || readable.has(ext) || !fs.existsSync(f)) { out.push(f); continue; }
        update(it, { state: 'extracting' });
        const folder = f.slice(0, -ext.length);
        try {
          await extract(f, folder);
          await fsp.unlink(f);
          it.extracted = true;
          out.push(folder);
        } catch (err) {
          update(it, { state: 'error', error: `Téléchargement terminé, mais l'archive n'a pas pu être décompressée (${err.message}).` });
          return;
        }
      }
    } else out.push(...files);

    const installers = await findInstallers(out);
    update(it, { state: 'done', doneAt: Date.now(), speed: 0, installers });
    if (it.kind === 'http' && it.console != null && !it.companionsQueued) queueCompanions(it);
    onFinished(it);
  }

  // Index de jeu sur disque (.cue, .m3u…) téléchargé seul depuis une page : on va chercher, à côté de
  // lui sur le même site, les fichiers qu'il cite et qui manquent (pistes .bin, autres disques).
  function queueCompanions(it) {
    if (!it.file || !disc.isDescriptor(it.file) || !/^https?:\/\//i.test(it.source || '')) return;
    const missing = disc.missingLocal(it.file);
    if (!missing.length) return;
    const origin = new URL(it.source).origin;
    let n = 0;
    for (const rel of missing) {
      let url;
      try { url = disc.refUrl(rel, it.source); } catch { continue; }
      if (new URL(url).origin !== origin) continue;
      // Un index cité (disque d'une liste .m3u) sera lu à son tour une fois téléchargé.
      addUrl(url, { console: it.console, saveAs: path.join(path.dirname(it.file), ...rel.split('/')), group: it.group || path.basename(it.name, path.extname(it.name)), companionsQueued: !disc.isDescriptor(rel) });
      n++;
    }
    if (n) update(it, { companions: n });
  }

  async function findInstallers(paths) {
    const test = INSTALLER[process.platform] || (() => false);
    const found = [];
    async function walk(p, depth) {
      if (found.length >= 5 || depth > 3) return;
      let st;
      try { st = await fsp.stat(p); } catch { return; }
      if (st.isFile()) { if (test(path.basename(p))) found.push(p); return; }
      if (!st.isDirectory()) return;
      let entries = [];
      try { entries = await fsp.readdir(p); } catch { return; }
      for (const e of entries) await walk(path.join(p, e), depth + 1);
    }
    for (const p of paths) await walk(p, 0);
    // Le programme le plus proche de la racine d'abord (setup.exe plutôt qu'un sous-composant).
    return found.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);
  }

  /* ---------- Commandes ---------- */

  async function pause(id) {
    const it = items.get(id);
    const l = live.get(id);
    if (!it || !l) return list();
    if (l.dl && !l.dl.isPaused()) { l.dl.pause(); update(it, { state: 'paused', speed: 0 }); }
    if (l.torrent) {
      live.delete(id);
      l.torrent.destroy({ destroyStore: false });
      update(it, { state: 'paused', speed: 0, peers: 0 });
    }
    return list();
  }

  // Bookmark de téléchargement : enregistre une entrée « en attente » sans rien télécharger.
  // source : lien http direct, lien magnet, ou chemin d'un fichier .torrent.
  function addPending(source, ctx = {}) {
    const src = String(source || '');
    const isMagnet = /^magnet:\?/i.test(src);
    const isTorrentFile = !isMagnet && /\.torrent$/i.test(src);
    const kind = isMagnet || isTorrentFile ? 'torrent' : 'http';
    const name = ctx.name || (isMagnet ? torrentLabel(src) : (() => { try { return decodeURIComponent(path.basename(new URL(src).pathname)) || src; } catch { return path.basename(src) || src; } })());
    const dest = destFor(ctx);
    const it = {
      id: newId(), kind, createdAt: Date.now(), name, source: src,
      dir: dest.dir, console: dest.console, consoleName: dest.consoleName,
      state: PENDING, received: 0, total: 0, speed: 0, error: '', installers: [],
      torrentFile: isTorrentFile ? src : null, gameBookmark: ctx.gameBookmark || null,
    };
    items.set(it.id, it);
    update(it);
    return { ok: true, id: it.id };
  }

  // Lance un téléchargement en attente.
  function startPending(id) {
    const it = items.get(id);
    if (!it || it.state !== PENDING) return list();
    if (it.kind === 'torrent') { addTorrent(it.source, { console: it.console }, it); return list(); }
    update(it, { state: 'waiting', received: 0, speed: 0, error: '' });
    pendingUrls.set(it.source, { console: it.console, retryOf: it.id });
    getSession().downloadURL(it.source);
    return list();
  }

  async function resume(id) {
    const it = items.get(id);
    if (!it) return list();
    const l = live.get(id);
    if (l?.dl) {
      if (l.dl.canResume()) { l.dl.resume(); update(it, { state: 'downloading' }); } else retry(id);
      return list();
    }
    if (it.kind === 'torrent' && ['paused', 'error'].includes(it.state)) await addTorrent(it.source, {}, it);
    if (it.kind === 'http' && ['interrupted', 'error', 'cancelled'].includes(it.state)) retry(id);
    if (it.state === PENDING) return startPending(id);
    return list();
  }

  function retry(id) {
    const it = items.get(id);
    if (!it) return;
    if (it.kind === 'torrent') { addTorrent(it.source, {}, it); return; }
    if (it.file) fsp.unlink(it.file).catch(() => {});
    update(it, { state: 'waiting', received: 0, speed: 0, error: '' });
    pendingUrls.set(it.source, { console: it.console, retryOf: it.id });
    getSession().downloadURL(it.source);
  }

  async function cancel(id, removeFiles = true) {
    const it = items.get(id);
    if (!it) return list();
    const l = live.get(id);
    live.delete(id);
    if (l?.dl) l.dl.cancel();
    if (l?.torrent) {
      await new Promise((resolve) => { l.torrent.destroy({ destroyStore: removeFiles }, () => resolve()); });
    } else if (removeFiles && it.kind === 'torrent' && it.state !== 'done' && it.name && it.dir) {
      await fsp.rm(path.join(it.dir, it.name), { recursive: true, force: true }).catch(() => {});
    }
    update(it, { state: 'cancelled', speed: 0, peers: 0 });
    return list();
  }

  function remove(id) {
    const it = items.get(id);
    if (!it || live.has(id)) return list();
    items.delete(id);
    save();
    onChange({ id, removed: true });
    return list();
  }

  function clearFinished() {
    for (const [id, it] of items) if (!live.has(id) && ['done', 'cancelled', 'error', 'external', 'interrupted'].includes(it.state)) items.delete(id);
    save();
    return list();
  }

  // Ouvrir le dossier, ou lancer le programme d'installation trouvé.
  async function reveal(id) {
    const it = items.get(id);
    if (!it) return { ok: false };
    const target = it.kind === 'http' && it.file && fs.existsSync(it.file) ? it.file : it.name && it.dir ? path.join(it.dir, it.name) : it.dir;
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    else if (it.dir) await shell.openPath(it.dir);
    return { ok: true };
  }
  async function runInstaller(id, file) {
    const it = items.get(id);
    if (!it || !(it.installers || []).includes(file)) return { ok: false, error: 'Programme d’installation introuvable.' };
    const err = await shell.openPath(file);
    return err ? { ok: false, error: err } : { ok: true };
  }

  function list() {
    return [...items.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  // Au démarrage : les torrents qui étaient en cours reprennent.
  async function start() {
    load();
    for (const it of items.values()) {
      if (it.kind === 'torrent' && it.state !== PENDING && ACTIVE.has(it.state)) addTorrent(it.source, {}, it).catch(() => {});
    }
  }

  async function stop() {
    for (const [, l] of live) { if (l.dl) l.dl.pause(); }
    if (client) await new Promise((resolve) => { client.destroy(() => resolve()); setTimeout(resolve, 3000); });
  }

  return { start, stop, addUrl, addTorrent, addPending, startPending, fetchText, handleWebDownload, pause, resume, cancel, remove, clearFinished, reveal, runInstaller, list, settings };
}

module.exports = { createDownloads };
