'use strict';
/**
 * Mire : lecteur multimédia et frontend de jeux.
 * Processus principal : fenêtres, accès au disque, Freebox TV, lancement des programmes.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, shell, session, Menu, nativeTheme, webContents } = require('electron');
// API propre à castLabs Electron (Widevine). Absente d'Electron standard : on la teste avant usage.
const { components } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createScraper } = require('./scraper.js');
const { createStore, download } = require('./store.js');
const { createAdblock } = require('./adblock.js');
const { defaultRomSites, GAME_FILE_RE } = require('./romsites.js');
const { createDownloads } = require('./downloads.js');
const disc = require('./discfiles.js');
const { guessSystem, parseVideo } = require('./scraper.js');
const { EXT, KIND, NATIVE, MIME, COVER_RE, ART_RE, FANART_RE, MEDIA_KINDS } = require('./lib/formats.js');
const { THEME_BG, DEFAULT_CONFIG, slug, newId, mergeConfig, normalizeConfig, migrateConfig } = require('./lib/config.js');
const { parseM3U, groupChannels } = require('./lib/m3u.js');
const { resolveLocation } = require('./lib/location.js');
const { substitute, isUrlTarget } = require('./lib/args.js');
const { decodeText, srtToVtt, foldText, providerMatches, episodeNumbers, cleanRomName, similarity } = require('./lib/text.js');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/**
 * Identité unique pour toute l'application, fixée avant la création de la moindre page.
 * Un réglage par session ne s'applique pas aux cadres d'un autre site (processus séparés) :
 * la case « Vérifiez que vous êtes humain » de Cloudflare, servie par challenges.cloudflare.com,
 * annonçait alors « Electron » pendant que la page annonçait « Chrome », et Cloudflare refusait
 * la vérification. On retire aussi le détail de version, comme le fait Chrome (Chrome/152.0.0.0).
 */
function chromeLikeUserAgent(ua) {
  const name = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua
    .replace(/\s*Electron\/\S+/i, '')
    .replace(new RegExp(`\\s*${name}\\/\\S+`, 'i'), '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}
/**
 * Exception : la page de connexion Google (accounts.google.com). Google y refuse un navigateur
 * intégré qui se présente comme Chrome (« Ce navigateur ou cette application ne sont peut-être
 * pas sécurisés ») et accepte celui qui donne sa vraie identité Electron. Sur cette seule page,
 * et pour ce qu'elle charge, Mire envoie donc l'identité d'origine d'Electron (sans le nom de Mire).
 */
function nativeUserAgent(ua) {
  const name = app.getName();
  if (/^electron$/i.test(name)) return ua;
  return ua.replace(new RegExp(`\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/\\S+`, 'i'), '');
}
const NATIVE_UA = nativeUserAgent(app.userAgentFallback);
const SIGNIN_HOSTS = new Set(['accounts.google.com']);
const isSigninPage = (u) => { try { return SIGNIN_HOSTS.has(new URL(u).hostname); } catch { return false; } };

app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback);

// Le schéma media:// sert les fichiers locaux à l'interface, avec gestion des plages (avance rapide).
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

let config = structuredClone(DEFAULT_CONFIG);
let mainWindow = null;
let pendingFiles = [];
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function saveConfig(next) {
  config = normalizeConfig(next);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) { saveConfig(DEFAULT_CONFIG); return; }
  try {
    const { raw, changed } = migrateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    config = normalizeConfig(raw);
    if (changed) saveConfig(config);
  } catch (err) {
    // Fichier abîmé : on le garde de côté au lieu de l'écraser.
    try { fs.copyFileSync(file, `${file}.illisible-${Date.now()}`); } catch { /* rien */ }
    console.error('config.json illisible :', err.message);
    saveConfig(DEFAULT_CONFIG);
  }
}

/* ------------------------------------------------------------------ */
/* Fichiers autorisés                                                  */
/* ------------------------------------------------------------------ */

// L'interface ne peut lire que les dossiers de la bibliothèque, les dossiers de ROMs
// et les fichiers ouverts explicitement (boîte de dialogue, glisser-déposer).
const openedFiles = new Set();
const pathKey = (p) => { const r = path.resolve(String(p)); return IS_WIN ? r.toLowerCase() : r; };

let scraper = null;
let store = null;
let adblock = null;
let downloads = null;
let adblockReady = Promise.resolve(false);

const metaDir = () => path.join(app.getPath('userData'), 'meta');
const romCacheDir = () => path.join(app.getPath('userData'), 'cache', 'roms');

function allowedRoots() {
  const roots = [];
  const addLoc = (loc) => { const r = resolveLocation(loc); if (r.type === 'path' && r.path) roots.push(r.path); };
  for (const src of config.library.sources) addLoc(src.location);
  for (const src of config.gameSources) addLoc(src.location);
  for (const e of config.emulators) {
    if (e.romsDir) roots.push(e.romsDir);
    if (e.imagesDir) roots.push(e.imagesDir);
    for (const x of e.sources || []) addLoc(x);
  }
  if (scraper) roots.push(scraper.imgDir);
  roots.push(path.join(metaDir(), 'img'), romCacheDir());
  return roots.map(pathKey);
}

function locationError(loc, r) {
  if (r.network) return `Partage réseau inaccessible : ${loc}. Vérifiez que l’ordinateur du partage est allumé et que vous y êtes connecté.`;
  return `Dossier introuvable : ${loc}`;
}

function isAllowed(p) {
  if (!p || typeof p !== 'string') return false;
  const k = pathKey(p);
  if (openedFiles.has(k)) return true;
  if (config.games.some((g) => g.image && pathKey(g.image) === k)) return true;
  if (config.emulators.some((e) => e.banner && pathKey(e.banner) === k)) return true;
  return allowedRoots().some((r) => k === r || k.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
}

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    let file;
    try { file = new URL(request.url).searchParams.get('p'); } catch { return new Response('Requête invalide', { status: 400 }); }
    if (!isAllowed(file)) return new Response('Accès refusé', { status: 403 });

    let stat;
    try {
      stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('pas un fichier');
    } catch {
      return new Response('Introuvable', { status: 404 });
    }

    const size = stat.size;
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('range');

    if (range && size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start;
        let end;
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, size - Number(m[2]));
          end = size - 1;
        } else {
          start = Number(m[1] || 0);
          end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        }
        if (start > end || start >= size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Bibliothèque locale                                                 */
/* ------------------------------------------------------------------ */

const MAX_ITEMS = 150000;

async function walkLibrary(dir, out, seen, depth, kinds = new Set(MEDIA_KINDS)) {
  if (depth > 16 || out.length >= MAX_ITEMS) return;
  const k = pathKey(dir);
  if (seen.has(k)) return;
  seen.add(k);

  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
  const extOf = (name) => path.extname(name).toLowerCase();
  const baseOf = (name) => path.basename(name, path.extname(name)).toLowerCase();

  const coverEntry = files.find((e) => COVER_RE.test(e.name));
  const folderCover = coverEntry ? path.join(dir, coverEntry.name) : null;
  const fanartEntry = files.find((e) => FANART_RE.test(e.name));
  const folderFanart = fanartEntry ? path.join(dir, fanartEntry.name) : null;

  // Images portant le nom d'une vidéo (film.jpg, film-poster.jpg) : ce sont des affiches.
  const imagesByBase = new Map();
  const videoBases = new Set();
  for (const e of files) {
    const kind = KIND[extOf(e.name)];
    if (kind === 'image') imagesByBase.set(baseOf(e.name), path.join(dir, e.name));
    if (kind === 'video') videoBases.add(baseOf(e.name));
  }
  const isPosterOfVideo = (b) => videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb|landscape)$/, ''));

  for (const e of files) {
    const ext = extOf(e.name);
    const kind = KIND[ext];
    if (!kind || !kinds.has(kind)) continue;
    const name = path.basename(e.name, path.extname(e.name));
    const b = name.toLowerCase();
    if (kind === 'image' && (ART_RE.test(e.name) || isPosterOfVideo(b))) continue;

    const item = { path: path.join(dir, e.name), name, ext, kind, folder: path.basename(dir), dir, native: NATIVE.has(ext), cover: null, fanart: null };
    if (kind === 'video') { const p = parseVideo({ name, dir }); if (p.type === 'tv') { item.seriesTitle = p.title; Object.assign(item, episodeNumbers(name)); } }
    if (kind === 'video') {
      item.cover = imagesByBase.get(b) || imagesByBase.get(`${b}-poster`) || folderCover;
      item.fanart = imagesByBase.get(`${b}-fanart`) || folderFanart;
    }
    if (kind === 'audio') { item.cover = folderCover; item.fanart = folderFanart; }
    out.push(item);
    if (out.length >= MAX_ITEMS) return;
  }

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$')) continue;
    await walkLibrary(path.join(dir, e.name), out, seen, depth + 1, kinds);
  }
}

/* ---------- Sources web : page d'index d'un serveur, ou liste M3U ---------- */

const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
const urlSubs = new Map(); // vidéo en ligne → sous-titres trouvés à côté

// Parcourt les pages d'index (Apache, nginx, NAS…) sans sortir du dossier de départ.
async function crawlHttp(startUrl, onDir, maxDirs = 400) {
  const base = new URL(startUrl.endsWith('/') ? startUrl : `${startUrl}/`);
  const queue = [base.href];
  const seen = new Set();
  let first = true;
  while (queue.length && seen.size < maxDirs) {
    const dirUrl = queue.shift();
    if (seen.has(dirUrl)) continue;
    seen.add(dirUrl);
    let html;
    try {
      const res = await fetch(dirUrl, { headers: { 'user-agent': 'Mire/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`le serveur a répondu avec le code ${res.status}`);
      html = await res.text();
    } catch (err) {
      if (first) throw new Error(`Adresse inaccessible (${err.name === 'TimeoutError' ? 'délai dépassé' : err.message.replace(/^fetch failed$/, 'serveur injoignable')}).`);
      continue;
    }
    first = false;
    const files = [];
    const dirPath = new URL(dirUrl).pathname;
    for (const m of html.matchAll(/href\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)')/gi)) {
      let u;
      try { u = new URL(m[1] || m[2], dirUrl); } catch { continue; }
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
      if (u.pathname.endsWith('/')) { if (u.pathname.length > dirPath.length) queue.push(u.href); continue; }
      files.push(u);
    }
    const parts = dirPath.split('/').filter(Boolean);
    await onDir(dirUrl, safeDecode(parts[parts.length - 1] || base.hostname), files);
  }
}

async function crawlLibraryUrl(url, kinds, out) {
  if (/\.m3u8?$/i.test(new URL(url).pathname)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res || !res.ok) throw new Error('Liste de lecture inaccessible.');
    const listName = safeDecode(new URL(url).pathname.split('/').pop()).replace(/\.m3u8?$/i, '');
    const fallbackKind = kinds.has('video') ? 'video' : kinds.has('audio') ? 'audio' : 'image';
    for (const e of parseM3U(await res.text())) {
      let u;
      try { u = new URL(e.url, url).href; } catch { continue; }
      const ext = path.extname(new URL(u).pathname).toLowerCase();
      const kind = KIND[ext] || fallbackKind;
      if (!kinds.has(kind)) continue;
      out.push({ path: u, name: e.title || safeDecode(path.basename(new URL(u).pathname, ext)) || u, ext, kind, folder: listName, dir: url, native: !ext || NATIVE.has(ext) || ext === '.m3u8', cover: e.logo || null, fanart: null, remote: true });
    }
    return;
  }
  await crawlHttp(url, async (dirUrl, dirName, files) => {
    const byName = files.map((u) => ({ u, name: safeDecode(u.pathname.split('/').pop()) }));
    const extOf = (n) => path.extname(n).toLowerCase();
    const baseOf = (n) => path.basename(n, path.extname(n)).toLowerCase();
    const folderCover = byName.find((f) => COVER_RE.test(f.name))?.u.href || null;
    const folderFanart = byName.find((f) => FANART_RE.test(f.name))?.u.href || null;
    const images = new Map(byName.filter((f) => KIND[extOf(f.name)] === 'image').map((f) => [baseOf(f.name), f.u.href]));
    const videoBases = new Set(byName.filter((f) => KIND[extOf(f.name)] === 'video').map((f) => baseOf(f.name)));
    const subs = byName.filter((f) => ['.srt', '.vtt'].includes(extOf(f.name)));
    for (const f of byName) {
      const ext = extOf(f.name);
      const kind = KIND[ext];
      if (!kind || !kinds.has(kind) || out.length >= MAX_ITEMS) continue;
      const b = baseOf(f.name);
      if (kind === 'image' && (ART_RE.test(f.name) || videoBases.has(b) || videoBases.has(b.replace(/-(poster|fanart|thumb)$/, '')))) continue;
      const item = { path: f.u.href, name: path.basename(f.name, path.extname(f.name)), ext, kind, folder: dirName, dir: dirUrl, native: NATIVE.has(ext), cover: null, fanart: null, remote: true };
      if (kind === 'video') { const p = parseVideo({ name: item.name, dir: dirUrl }); if (p.type === 'tv') { item.seriesTitle = p.title; Object.assign(item, episodeNumbers(item.name)); } }
      if (kind === 'video') {
        item.cover = images.get(b) || images.get(`${b}-poster`) || folderCover;
        item.fanart = images.get(`${b}-fanart`) || folderFanart;
        const mine = subs.filter((x) => baseOf(x.name).startsWith(b));
        if (mine.length) urlSubs.set(item.path, mine.map((x) => ({ url: x.u.href, name: x.name, base: b })));
      }
      if (kind === 'audio') { item.cover = folderCover; item.fanart = folderFanart; }
      out.push(item);
    }
  });
}

// Analyse de toutes les sources ; renvoie aussi l'état de chacune (nombre d'éléments, erreur).

async function scanLibrary() {
  const items = [];
  const status = {};
  urlSubs.clear();
  const groups = new Map(); // une même source déclarée pour plusieurs types n'est parcourue qu'une fois
  for (const src of config.library.sources) {
    const loc = resolveLocation(src.location);
    const k = loc.type === 'url' ? loc.url : pathKey(loc.path);
    if (!groups.has(k)) groups.set(k, { loc, location: src.location, kinds: new Set(), sources: [] });
    groups.get(k).kinds.add(src.kind);
    groups.get(k).sources.push(src);
  }
  for (const g of groups.values()) {
    const start = items.length;
    let error = null;
    try {
      if (g.loc.type === 'url') await crawlLibraryUrl(g.loc.url, g.kinds, items);
      else {
        try { await fsp.access(g.loc.path); } catch { throw new Error(locationError(g.location, g.loc)); }
        await walkLibrary(g.loc.path, items, new Set(), 0, g.kinds);
      }
    } catch (err) { error = err.message; }
    for (const src of g.sources) {
      const count = items.slice(start).filter((it) => it.kind === src.kind).length;
      status[src.id] = { ok: !error, error, count };
    }
  }
  // Marque-pages de streaming : ajoutés comme des vidéos qui rouvrent la page du site.
  for (const b of config.bookmarks || []) {
    items.push({
      path: b.url,
      name: b.title || b.url,
      ext: '',
      kind: 'video',
      folder: b.site || 'Streaming',
      dir: b.site || 'Streaming',
      native: false,
      cover: null,
      fanart: null,
      bookmark: true,
      bookmarkId: b.id,
      series: b.type === 'tv',
      seriesTitle: b.type === 'tv' ? (b.title || '') : undefined,
      season: b.type === 'tv' ? (b.season || null) : null,
      episode: b.type === 'tv' ? (b.episode || null) : null,
      bookmarkType: b.type,
    });
  }
  return { items, status };
}

async function itemFromPath(p) {
  if (typeof p !== 'string') return null;
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return null;
  } catch { return null; }
  const ext = path.extname(p).toLowerCase();
  const kind = KIND[ext];
  if (!kind) return null;
  openedFiles.add(pathKey(p));

  const dir = path.dirname(p);
  const name = path.basename(p, path.extname(p));
  let cover = null;
  if (kind !== 'image') {
    try {
      const names = await fsp.readdir(dir);
      const base = name.toLowerCase();
      const found = names.find((n) => KIND[path.extname(n).toLowerCase()] === 'image'
        && (path.basename(n, path.extname(n)).toLowerCase() === base || COVER_RE.test(n)));
      if (found) { cover = path.join(dir, found); openedFiles.add(pathKey(cover)); }
    } catch { /* pas de pochette */ }
  }
  return { path: p, name, ext, kind, folder: path.basename(dir), dir, native: NATIVE.has(ext), cover };
}

/* ---------- Sous-titres .srt / .vtt à côté de la vidéo ---------- */

async function findSubtitles(videoPath) {
  if (/^https?:\/\//i.test(videoPath)) {
    const out = [];
    for (const sub of urlSubs.get(videoPath) || []) {
      try {
        const res = await fetch(sub.url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        let text = decodeText(Buffer.from(await res.arrayBuffer()));
        if (sub.name.toLowerCase().endsWith('.srt')) text = srtToVtt(text);
        const rest = path.basename(sub.name, path.extname(sub.name)).slice(sub.base.length).replace(/^[._\-\s]+/, '');
        const lang = (rest.split(/[._\s-]/)[0] || '').toLowerCase();
        out.push({ label: rest || 'Sous-titres', lang: /^[a-z]{2,3}$/.test(lang) ? lang : '', vtt: text });
      } catch { /* sous-titre inaccessible */ }
    }
    return out;
  }
  if (!isAllowed(videoPath)) return [];
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }

  const subs = [];
  for (const n of names) {
    const ext = path.extname(n).toLowerCase();
    if (ext !== '.srt' && ext !== '.vtt') continue;
    const b = path.basename(n, path.extname(n));
    if (!b.toLowerCase().startsWith(base)) continue;
    const rest = b.slice(base.length).replace(/^[._\-\s]+/, '');
    try {
      let text = decodeText(await fsp.readFile(path.join(dir, n)));
      if (ext === '.srt') text = srtToVtt(text);
      const lang = (rest.split(/[._\s-]/)[0] || '').toLowerCase();
      subs.push({ label: rest || 'Sous-titres', lang: /^[a-z]{2,3}$/.test(lang) ? lang : '', vtt: text });
    } catch { /* fichier illisible */ }
  }
  return subs;
}

/* ------------------------------------------------------------------ */
/* Freebox TV (playlist M3U)                                           */
/* ------------------------------------------------------------------ */

// Repère le service de télé en place en joignant brièvement chaque box sur le réseau local.
async function detectTvService() {
  for (const svc of config.tv.services) {
    if (!svc.detect) continue;
    try {
      await fetch(svc.detect, { signal: AbortSignal.timeout(1500) });
      return svc.id; // la box a répondu : ce service est disponible
    } catch { /* box absente, on essaie la suivante */ }
  }
  return '';
}

async function detectTvOnce() {
  if (config.tv.detected) return;
  const found = await detectTvService();
  config = saveConfig({ ...config, tv: { ...config.tv, active: found || config.tv.active, detected: true } });
  if (found) toUi('tv-detected', { id: found, name: config.tv.services.find((t) => t.id === found)?.name || '' });
}

function activeTvService() {
  const { services, active } = config.tv;
  return services.find((t) => t.id === active) || null;
}

async function fetchChannels() {
  const svc = activeTvService();
  if (!svc) return { ok: false, error: 'Aucun service de télévision choisi. Choisissez-en un dans les réglages de la page Télévision.' };
  if (svc.kind === 'web') return { ok: true, web: { url: svc.url, name: svc.name } };
  const src = (svc.url || '').trim();
  if (!src) return { ok: false, error: `Aucune adresse de playlist pour ${svc.name}.` };
  let text;
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: `${svc.name} a répondu avec le code ${res.status}. Vérifiez l’adresse de la playlist dans les réglages de la page.` };
      text = await res.text();
    } catch {
      return { ok: false, error: `${svc.name} ne répond pas. La télévision par playlist fonctionne seulement quand l’ordinateur est sur le réseau de la box (Wi-Fi ou câble).` };
    }
  } else {
    try { text = await fsp.readFile(src, 'utf8'); } catch { return { ok: false, error: `Fichier de playlist introuvable : ${src}` }; }
  }
  const channels = groupChannels(parseM3U(text));
  if (!channels.length) return { ok: false, error: 'La playlist ne contient aucune chaîne.' };
  return { ok: true, channels };
}

/* ------------------------------------------------------------------ */
/* Lancement de programmes (jeux, émulateurs, lecteur externe)         */
/* ------------------------------------------------------------------ */

function launchProcess(cmd, args = [], { cwd, hideWhileRunning = false } = {}) {
  return new Promise((resolve) => {
    let command = cmd;
    let argv = args;
    if (IS_MAC && /\.app\/?$/i.test(command)) { argv = ['-W', '-a', command, '--args', ...args]; command = 'open'; }
    let child;
    try {
      child = spawn(command, argv, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, detached: true, stdio: 'ignore' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    child.once('error', (err) => {
      resolve({ ok: false, error: err.code === 'ENOENT' ? `Programme introuvable : ${cmd}` : err.message });
    });
    child.once('spawn', () => {
      if (hideWhileRunning && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
        child.once('exit', () => {
          if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.restore(); mainWindow.focus(); }
        });
      }
      child.unref();
      resolve({ ok: true });
    });
  });
}

async function openTarget(target, args, opts) {
  if (isUrlTarget(target)) { await shell.openExternal(target); return { ok: true }; }
  const ext = path.extname(target).toLowerCase();
  if (['.lnk', '.url', '.bat', '.cmd'].includes(ext)) {
    const err = await shell.openPath(target);
    return err ? { ok: false, error: err } : { ok: true };
  }
  return launchProcess(target, args, opts);
}

const firstExisting = (list) => list.filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
const under = (base, ...rest) => (base ? path.join(base, ...rest) : null);

function detectPlayer() {
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  if (IS_WIN) {
    return firstExisting([
      under(pf, 'mpv', 'mpv.exe'), under(local, 'Programs', 'mpv', 'mpv.exe'), 'C:\\mpv\\mpv.exe',
      under(pf, 'VideoLAN', 'VLC', 'vlc.exe'), under(pf86, 'VideoLAN', 'VLC', 'vlc.exe'),
    ]);
  }
  if (IS_MAC) {
    return firstExisting([
      '/Applications/mpv.app/Contents/MacOS/mpv', '/opt/homebrew/bin/mpv', '/usr/local/bin/mpv',
      '/Applications/VLC.app/Contents/MacOS/VLC',
    ]);
  }
  return firstExisting(['/usr/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/vlc', '/snap/bin/vlc']);
}

function resolvePlayer() {
  const p = config.externalPlayer;
  const cmd = (p.path || '').trim() || detectPlayer() || 'mpv';
  const isVlc = /vlc/i.test(path.basename(cmd));
  const args = Array.isArray(p.args) && p.args.length ? p.args
    : isVlc ? ['--fullscreen', '--meta-title={title}', '--start-time={start}', '{url}']
      : ['--fs', '--force-media-title={title}', '--start={start}', '{url}'];
  return { cmd, args };
}

async function playExternal(target, title = '', start = 0) {
  if (typeof target !== 'string' || !target) return { ok: false, error: 'Rien à lire.' };
  if (!isUrlTarget(target) && !isAllowed(target)) return { ok: false, error: 'Ce fichier ne fait pas partie de la bibliothèque.' };
  const { cmd, args } = resolvePlayer();
  const s = Math.floor(Number(start) || 0);
  const r = await launchProcess(cmd, substitute(args, { url: target, title, start: s > 0 ? s : '' }));
  if (!r.ok && r.error.startsWith('Programme introuvable')) {
    r.error = 'Aucun lecteur externe trouvé. Installez VLC ou mpv, ou indiquez son emplacement dans Réglages.';
  }
  return r;
}

function detectBrowser() {
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  if (IS_WIN) {
    // Edge en premier : c'est lui qui obtient la meilleure qualité sur Netflix sous Windows.
    return firstExisting([
      under(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), under(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      under(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), under(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      under(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }
  if (IS_MAC) {
    return firstExisting([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]);
  }
  return firstExisting(['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']);
}

async function openInBrowser(url) {
  const b = config.browser;
  const cmd = (b.path || '').trim() || detectBrowser();
  if (!cmd) { await shell.openExternal(url); return { ok: true }; }
  const args = Array.isArray(b.args) && b.args.length ? b.args : ['--app={url}'];
  return launchProcess(cmd, substitute(args, { url }));
}

/* ---------- Vue web intégrée ---------- */

// Widevine (lecture protégée de Netflix, Prime Video…) : fourni par castLabs Electron.
let cdmReady = Promise.resolve(false);
function startWidevine() {
  if (!components) return;
  cdmReady = Promise.race([
    components.whenReady().then(() => true).catch((err) => { console.error('Widevine :', err?.message || err); return false; }),
    new Promise((resolve) => { setTimeout(() => resolve(false), 15000); }),
  ]);
}

function drmStatus() {
  if (!components) return { ecs: false, platform: process.platform };
  let st = {};
  try { st = components.status(); } catch { /* pas encore prêt */ }
  const w = st[components.WIDEVINE_CDM_ID];
  return { ecs: true, platform: process.platform, widevine: w ? { status: w.status, version: w.version } : null };
}

// Une vue par site ouvert : on peut passer de Netflix à Mire et revenir sans tout recharger.
const webViews = new Map();
const web = { activeId: null, visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 }, immersive: false, html: false, setFs: false };

const toUi = (channel, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); };

function webSessions() {
  return [...webViews.values()].map(({ entry }) => ({ id: entry.id, name: entry.name, color: entry.color }));
}

function webStateOf(id) {
  const w = webViews.get(id);
  if (!w) return null;
  const wc = w.view.webContents;
  return {
    id,
    name: w.entry.name,
    color: w.entry.color,
    title: wc.getTitle(),
    url: wc.getURL(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
    immersive: web.immersive || web.html,
    hasSearch: !!w.entry.search,
    blocked: adblock ? adblock.countFor(wc.id) : 0,
    bookmarkUrl: String(w.entry.id).startsWith('bm:') ? null : (w.entry.romConsole == null ? w.view.webContents.getURL() : null),
    rom: w.entry.romConsole != null ? {
      console: w.entry.romConsole,
      consoleName: w.entry.romConsole === 'pc' ? 'Jeux PC' : (config.emulators[w.entry.romConsole]?.name || ''),
      site: w.entry.romSite,
      pc: w.entry.romConsole === 'pc',
      sites: consoleSites(w.entry.romConsole).map((x) => ({ name: x.name, url: x.url, search: x.search || '' })),
    } : null,
    adOn: !!adblock && adblock.status().enabled && !adblock.pageAllowed(wc.getURL()),
  };
}
function pushWebState(id) { const st = webStateOf(id); if (st) toUi('web-state', st); }

function fullBounds() {
  const [width, height] = mainWindow.getContentSize();
  return { x: 0, y: 0, width, height };
}

function applyWeb() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const [id, w] of webViews) {
    const show = web.visible && id === web.activeId;
    w.view.setVisible(show);
    if (show) w.view.setBounds(web.immersive || web.html ? fullBounds() : web.bounds);
  }
}

// Met en pause les vidéos d'un site qu'on quitte (sauf la musique, qui continue en fond).
function pauseVideos(w) {
  if (!w || w.entry.background) return;
  try {
    for (const f of w.view.webContents.mainFrame.framesInSubtree) {
      f.executeJavaScript("document.querySelectorAll('video').forEach((v) => v.pause())").catch(() => {});
    }
  } catch { /* page en cours de chargement */ }
}

const siteOf = (u) => { try { return new URL(u).hostname.split('.').slice(-2).join('.'); } catch { return ''; } };

function setImmersive(on) {
  if (!mainWindow) return;
  web.immersive = on;
  if (on && !mainWindow.isFullScreen()) { web.setFs = true; mainWindow.setFullScreen(true); }
  else if (!on && web.setFs && !web.html) { web.setFs = false; mainWindow.setFullScreen(false); }
  applyWeb();
  if (web.activeId) pushWebState(web.activeId);
}

function focusMire() {
  if (!mainWindow) return;
  if (web.immersive) setImmersive(false);
  mainWindow.webContents.focus();
  toUi('web-focus', false);
  toUi('web-mire-focus');
}

function handleWebShortcut(id, input) {
  const w = webViews.get(id);
  if (!w) return false;
  const nav = w.view.webContents.navigationHistory;
  const key = input.key;
  const ctrl = input.control || input.meta;
  if (key === 'F11') { setImmersive(!web.immersive); return true; }
  if (key === 'Escape' && web.immersive && !web.html) { setImmersive(false); return true; }
  if (key === 'F9') { focusMire(); return true; }
  if (key === 'F5' || (ctrl && key.toLowerCase() === 'r')) { w.view.webContents.reload(); return true; }
  if (ctrl && key.toLowerCase() === 'w') { webClose(id); return true; }
  if (input.alt && key === 'ArrowLeft') { if (nav.canGoBack()) nav.goBack(); return true; }
  if (input.alt && key === 'ArrowRight') { if (nav.canGoForward()) nav.goForward(); return true; }
  return false;
}

function createWebView(entry) {
  const view = new WebContentsView({
    webPreferences: { partition: 'persist:web', contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  view.setBackgroundColor('#000000');
  view.setVisible(false);
  const wc = view.webContents;
  const w = { view, entry };

  // Fenêtres surgissantes bloquées ; un lien vers le même site s'ouvre dans la vue.
  wc.setWindowOpenHandler(({ url }) => {
    if (takeMagnet(url, wc)) return { action: 'deny' };
    if (!/^https?:/i.test(url)) return { action: 'deny' };
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* adresse illisible */ }
    if (w.entry.romConsole != null && (w.entry.romConsole === 'pc' || GAME_FILE_RE.test(pathname))) wc.downloadURL(url);
    else if (siteOf(url) === siteOf(wc.getURL())) wc.loadURL(url);
    return { action: 'deny' };
  });
  const push = () => pushWebState(entry.id);
  for (const ev of ['page-title-updated', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) wc.on(ev, push);
  wc.on('did-navigate', () => { adblock?.resetCount(wc.id); push(); });
  // « Clic sur la vidéo → page de pub » : la navigation vers une régie publicitaire est annulée.
  const guard = (event, legacyUrl) => {
    const url = event.url || legacyUrl;
    if (/^magnet:\?/i.test(url)) { event.preventDefault(); takeMagnet(url, wc); return; }
    if (event.isMainFrame === false) return;
    if (adblock?.blocksNavigation(url, wc.getURL())) {
      event.preventDefault();
      toUi('web-adblocked', { id: entry.id, host: (() => { try { return new URL(url).hostname; } catch { return ''; } })() });
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) toUi('web-error', { id: entry.id, message: `${entry.name} ne répond pas (${desc}). Vérifiez la connexion ou l’adresse du site.` });
  });
  wc.on('render-process-gone', () => toUi('web-error', { id: entry.id, message: `${entry.name} s’est arrêté. Rechargez la page.` }));
  wc.on('focus', () => toUi('web-focus', true));
  wc.on('blur', () => toUi('web-focus', false));
  // Plein écran demandé par le lecteur vidéo du site.
  wc.on('enter-html-full-screen', () => {
    web.html = true;
    if (!mainWindow.isFullScreen()) { web.setFs = true; mainWindow.setFullScreen(true); }
    applyWeb();
    push();
  });
  wc.on('leave-html-full-screen', () => {
    web.html = false;
    if (web.setFs && !web.immersive) { web.setFs = false; mainWindow.setFullScreen(false); }
    applyWeb();
    push();
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && handleWebShortcut(entry.id, input)) event.preventDefault();
  });

  mainWindow.contentView.addChildView(view);
  webViews.set(entry.id, w);
  return w;
}

/* ---------- « Ajouter des jeux » : navigateur intégré propre à chaque console ---------- */

// Sites de la console : sa liste à elle, ou celle proposée pour son système.
function consoleSites(i) {
  if (i === 'pc') return (config.pcSites || []).filter((x) => x && x.url);
  const emu = config.emulators[i];
  if (!emu) return [];
  if (Array.isArray(emu.romSites)) return emu.romSites.filter((x) => x && x.url);
  return defaultRomSites(guessSystem(emu));
}

function romEntry(i, siteIndex = 0) {
  const sites = consoleSites(i);
  if (!sites.length) return null;
  const name = i === 'pc' ? 'Jeux PC' : config.emulators[i]?.name;
  if (name == null) return null;
  const si = Math.max(0, Math.min(Number(siteIndex) || 0, sites.length - 1));
  return { id: `rom:${i}`, name: `Jeux : ${name}`, url: sites[si].url, search: sites[si].search || '', color: '#6E88F7', mode: 'integrated', romConsole: i, romSite: si };
}

async function webOpen(id, url, opts = {}) {
  let entry;
  if (String(id).startsWith('rom:')) {
    const raw = String(id).slice(4);
    const i = raw === 'pc' ? 'pc' : Number(raw);
    const current = webViews.get(id)?.entry.romSite;
    entry = romEntry(i, opts.site != null ? opts.site : current || 0);
    if (!entry) return { ok: false, error: 'Aucun site configuré pour cette console. Ajoutez-en dans « Modifier la console ».' };
  } else if (String(id).startsWith('bm:')) {
    const bm = (config.bookmarks || []).find((b) => `bm:${b.id}` === id);
    if (!bm) return { ok: false, error: 'Marque-page introuvable.' };
    entry = { id, name: bm.title || bm.site, url: bm.url, mode: 'integrated', color: '#9B6CF7', search: '' };
  } else {
    entry = config.web.find((w) => w.id === id);
  }
  if (!entry) return { ok: false, error: 'Ce site n’existe plus dans la configuration.' };
  const target = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : entry.url;
  if (entry.mode === 'browser') {
    const r = await openInBrowser(target);
    return { ...r, integrated: false };
  }
  await cdmReady;
  await adblockReady;
  let w = webViews.get(id);
  if (!w) {
    w = createWebView(entry);
    w.view.webContents.loadURL(target);
  } else {
    w.entry = entry;
    if (url || opts.site != null) w.view.webContents.loadURL(target);
  }
  toUi('web-sessions', webSessions());
  return { ok: true, integrated: true, state: webStateOf(id) };
}

function webShow(id, bounds, focus = true) {
  const w = webViews.get(id);
  if (!w) return { ok: false };
  if (web.activeId && web.activeId !== id) pauseVideos(webViews.get(web.activeId));
  web.activeId = id;
  web.visible = true;
  if (bounds) web.bounds = roundRect(bounds);
  applyWeb();
  if (focus) w.view.webContents.focus();
  return { ok: true, state: webStateOf(id) };
}

function webHide() {
  if (web.visible && web.activeId) pauseVideos(webViews.get(web.activeId));
  web.visible = false;
  if (web.immersive) setImmersive(false);
  applyWeb();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  return true;
}

const roundRect = (r) => ({
  x: Math.max(0, Math.round(r.x || 0)),
  y: Math.max(0, Math.round(r.y || 0)),
  width: Math.max(0, Math.round(r.width || 0)),
  height: Math.max(0, Math.round(r.height || 0)),
});

function webBounds(bounds) {
  web.bounds = roundRect(bounds);
  applyWeb();
  return true;
}

function webNav(action) {
  const w = webViews.get(web.activeId);
  if (!w) return false;
  const wc = w.view.webContents;
  const nav = wc.navigationHistory;
  if (action === 'back' && nav.canGoBack()) nav.goBack();
  else if (action === 'forward' && nav.canGoForward()) nav.goForward();
  else if (action === 'reload') wc.reload();
  else if (action === 'stop') wc.stop();
  else if (action === 'home') wc.loadURL(w.entry.url);
  else if (action === 'immersive') setImmersive(!web.immersive);
  else if (action === 'mire') focusMire();
  else if (action === 'browser') openInBrowser(wc.getURL());
  return true;
}

function webClose(id) {
  const w = webViews.get(id || web.activeId);
  if (!w) return false;
  const closedId = w.entry.id;
  try { mainWindow.contentView.removeChildView(w.view); } catch { /* déjà retirée */ }
  try { w.view.webContents.close(); } catch { /* déjà fermée */ }
  webViews.delete(closedId);
  if (web.activeId === closedId) {
    web.activeId = null;
    web.visible = false;
    if (web.immersive) setImmersive(false);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  }
  toUi('web-sessions', webSessions());
  toUi('web-closed', { id: closedId });
  return true;
}

function webFocus() {
  const w = webViews.get(web.activeId);
  if (w && web.visible) w.view.webContents.focus();
  return true;
}

// Touches envoyées à la page depuis la manette.
const PAD_KEYS = {
  Up: [{ keyCode: 'Up' }], Down: [{ keyCode: 'Down' }], Left: [{ keyCode: 'Left' }], Right: [{ keyCode: 'Right' }],
  Enter: [{ keyCode: 'Return', char: '\r' }], Space: [{ keyCode: 'Space', char: ' ' }], Escape: [{ keyCode: 'Escape' }],
  Tab: [{ keyCode: 'Tab' }], ShiftTab: [{ keyCode: 'Tab', modifiers: ['shift'] }],
};
function webKey(name) {
  const w = webViews.get(web.activeId);
  if (!w || !web.visible) return false;
  if (name === 'Back') { const nav = w.view.webContents.navigationHistory; if (nav.canGoBack()) nav.goBack(); return true; }
  const wc = w.view.webContents;
  for (const k of PAD_KEYS[name] || []) {
    const modifiers = k.modifiers || [];
    wc.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, modifiers });
    if (k.char) wc.sendInputEvent({ type: 'char', keyCode: k.char, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, modifiers });
  }
  return true;
}

// « Mémoriser la recherche » : l'utilisateur cherche le mot « mire » sur le site,
// Mire relève l'adresse obtenue et remplace « mire » par {q}.
function webLearnSearch(id) {
  const w = webViews.get(id || web.activeId);
  if (!w) return { ok: false, error: 'Aucun site ouvert.' };
  const url = w.view.webContents.getURL();
  let origin = '';
  try { origin = new URL(url).origin; } catch { return { ok: false, error: 'Adresse de page illisible.' }; }
  const rest = url.slice(origin.length);
  const idx = rest.toLowerCase().indexOf('mire');
  if (idx < 0) {
    return { ok: false, error: 'Cherchez d’abord le mot « mire » avec le moteur de recherche du site, puis appuyez de nouveau sur ce bouton.' };
  }
  const template = origin + rest.slice(0, idx) + '{q}' + rest.slice(idx + 4);
  if (w.entry.romConsole != null) {
    const i = w.entry.romConsole;
    const sites = consoleSites(i).map((x, n) => (n === w.entry.romSite ? { ...x, search: template } : x));
    if (i === 'pc') config = saveConfig({ ...config, pcSites: sites });
    else config = saveConfig({ ...config, emulators: config.emulators.map((e, n) => (n === i ? { ...e, romSites: sites } : e)) });
    w.entry = romEntry(i, w.entry.romSite) || w.entry;
    pushWebState(w.entry.id);
    return { ok: true, template, config };
  }
  const web2 = config.web.map((e) => (e.id === w.entry.id ? { ...e, search: template } : e));
  saveConfig({ ...config, web: web2 });
  w.entry = config.web.find((e) => e.id === w.entry.id) || w.entry;
  pushWebState(w.entry.id);
  return { ok: true, template, config };
}

// Tout téléchargement des pages passe par le gestionnaire. Depuis « Ajouter des jeux », il va dans le
// dossier de la console ; depuis un autre site, dans le dossier des téléchargements.
function viewOfContents(wc) {
  return wc ? [...webViews.values()].find((x) => !x.view.webContents.isDestroyed() && x.view.webContents === wc) : null;
}
function onWebDownload(_event, item, wc) {
  if (!downloads) return;
  const w = viewOfContents(wc);
  const rc = w?.entry.romConsole;
  downloads.handleWebDownload(item, rc != null && rc !== 'pc' ? { console: rc } : {});
}
// Lien magnet ouvert par une page : il part dans le gestionnaire au lieu du système.
function takeMagnet(url, wc) {
  if (!downloads || !/^magnet:\?/i.test(url)) return false;
  const w = viewOfContents(wc);
  const rc2 = w?.entry.romConsole;
  downloads.addTorrent(url, rc2 != null && rc2 !== 'pc' ? { console: rc2 } : {}).then((r) => {
    toUi('download-added', r?.ok ? { ok: true, external: !!r.external } : { ok: false, error: r?.error });
  });
  return true;
}

const countTimers = new Map();
function onAdCount(wcId) {
  if (countTimers.has(wcId)) return;
  countTimers.set(wcId, setTimeout(() => {
    countTimers.delete(wcId);
    for (const w of webViews.values()) {
      if (!w.view.webContents.isDestroyed() && w.view.webContents.id === wcId) toUi('web-blocked', { id: w.entry.id, count: adblock.countFor(wcId) });
    }
  }, 250));
}

function setupWebSession() {
  const ses = session.fromPartition('persist:web');
  // Pas de setUserAgent ici : l'identité vient de app.userAgentFallback, la même pour tous les cadres.
  // L'accès au stockage est accordé, comme dans Chrome, aux cadres de vérification qui le demandent.
  ses.on('will-download', onWebDownload);
  const allowed = ['fullscreen', 'clipboard-sanitized-write', 'mediaKeySystem', 'protected-media-identifier', 'storage-access', 'top-level-storage-access'];
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'openExternal' && takeMagnet(details?.externalURL || '', wc)) { callback(false); return; }
    callback(allowed.includes(permission));
  });

  // Connexion Google : identité Electron d'origine pour la page de connexion et tout ce qu'elle charge.
  // (Le bloqueur de pubs utilise onBeforeRequest et onHeadersReceived ; cet événement-ci reste libre.)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const page = details.resourceType === 'mainFrame' ? details.url : (() => {
      const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null;
      return wc && !wc.isDestroyed() ? wc.getURL() : '';
    })();
    if (isSigninPage(page)) details.requestHeaders['User-Agent'] = NATIVE_UA;
    callback({ requestHeaders: details.requestHeaders });
  });
  // Et la même identité pour ce que voit la page en JavaScript (navigator.userAgent).
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'web-preload.js') });
  // Scripts correcteurs du bloqueur, demandés par web-preload.js au tout début de chaque page.
  ipcMain.on('mire:scriptlets', (event, url) => { event.returnValue = adblock ? adblock.scriptletsFor(String(url || '')) : ''; });
  ipcMain.on('mire:signin-ua', (event) => {
    const page = event.sender && !event.sender.isDestroyed() ? event.sender.getURL() : '';
    event.returnValue = isSigninPage(page) ? NATIVE_UA : '';
  });
}

/* ---------- Recherche dans les catalogues de streaming (TMDB + JustWatch) ---------- */

async function tmdbFetch(pathname, params = {}) {
  const token = String(config.search.tmdbToken || '').trim();
  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  // Jeton d'accès en lecture (long) ou ancienne clé API v3 (32 caractères).
  if (token.length > 60) headers.authorization = `Bearer ${token}`;
  else url.searchParams.set('api_key', token);
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(9000) }); }
  catch { throw new Error('Le catalogue TMDB est injoignable. Vérifiez la connexion Internet.'); }
  if (res.status === 401) throw new Error('Clé TMDB refusée. Vérifiez-la dans Réglages.');
  if (!res.ok) throw new Error(`TMDB a répondu avec le code ${res.status}.`);
  return res.json();
}

function sourceForProvider(providerName) {
  const p = foldText(providerName);
  return config.web.find((w) => {
    const names = [w.name, ...(Array.isArray(w.providers) ? w.providers : [])].map(foldText).filter(Boolean);
    return names.some((n) => providerMatches(p, n));
  }) || null;
}

async function searchStreaming(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: true, results: [] };
  if (!String(config.search.tmdbToken || '').trim()) return { ok: false, reason: 'nokey' };
  const language = config.search.language || 'fr-FR';
  const region = String(config.search.region || 'FR').toUpperCase();
  const data = await tmdbFetch('/search/multi', { query: q, language, include_adult: 'false', page: '1' });
  const items = (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 12);

  const results = await Promise.all(items.map(async (r) => {
    let offers = null;
    try { offers = (await tmdbFetch(`/${r.media_type}/${r.id}/watch/providers`)).results?.[region] || null; } catch { /* sans info */ }
    const seen = new Set();
    const providers = [];
    for (const o of [...(offers?.flatrate || []), ...(offers?.free || []), ...(offers?.ads || [])]) {
      if (seen.has(o.provider_id)) continue;
      seen.add(o.provider_id);
      const src = sourceForProvider(o.provider_name);
      providers.push({ name: o.provider_name, webId: src ? src.id : null });
    }
    providers.sort((a, b) => Number(!!b.webId) - Number(!!a.webId));
    const date = r.release_date || r.first_air_date || '';
    return {
      key: `${r.media_type}-${r.id}`,
      title: r.title || r.name || '',
      year: date.slice(0, 4),
      type: r.media_type,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : null,
      providers,
    };
  }));
  return { ok: true, results };
}

/* ---------- Jeux et émulateurs ---------- */

async function launchGame(i) {
  const g = config.games[i];
  if (!g) return { ok: false, error: 'Ce jeu n’existe plus dans la configuration.' };
  const target = String(g.path);
  if (!isUrlTarget(target) && !fs.existsSync(target)) return { ok: false, error: `Fichier introuvable : ${target}` };
  return openTarget(target, g.args || [], {
    cwd: g.cwd || (isUrlTarget(target) ? undefined : path.dirname(target)),
    hideWhileRunning: true,
  });
}

// Dossiers de jeux PC : un jeu par raccourci ou exécutable, ou par sous-dossier (on y choisit le bon .exe).
const JUNK_EXE = /unins|setup|install|crash|report|redist|vcredist|vc_redist|dxsetup|directx|dotnet|update|patch|helper|prereq|easyanticheat|battleye|cleanup|config|launcherhelper|cefprocess|webhelper|unitycrash/i;
const GAME_FILES = IS_WIN ? ['.exe', '.lnk', '.url', '.bat'] : IS_MAC ? ['.app'] : ['.desktop', '.sh', '.appimage', '.x86_64'];

async function bestExecutable(dir, folderName, depth = 0) {
  const found = [];
  async function walk(d, level) {
    if (level > 2) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const ext = path.extname(e.name).toLowerCase();
      if (e.isDirectory()) { if (!/^(redist|_commonredist|directx|support|tools|engine)$/i.test(e.name)) await walk(full, level + 1); continue; }
      if (!GAME_FILES.includes(ext) || ['.lnk', '.url', '.desktop'].includes(ext) || JUNK_EXE.test(e.name)) continue;
      let size = 0;
      try { size = (await fsp.stat(full)).size; } catch { /* rien */ }
      found.push({ full, score: similarity(path.basename(e.name, ext), folderName) * 1e12 + size - level * 1e6 });
    }
  }
  await walk(dir, depth);
  found.sort((a, b) => b.score - a.score);
  return found[0]?.full || null;
}

async function scanGameSources() {
  const games = [];
  const status = {};
  for (const src of config.gameSources) {
    const loc = resolveLocation(src.location);
    if (loc.type === 'url') { status[src.id] = { ok: false, error: 'Les jeux PC doivent se trouver sur un disque ou un partage réseau.', count: 0 }; continue; }
    let entries;
    try { entries = await fsp.readdir(loc.path, { withFileTypes: true }); } catch { status[src.id] = { ok: false, error: locationError(src.location, loc), count: 0 }; continue; }
    const start = games.length;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(loc.path, e.name);
      const ext = path.extname(e.name).toLowerCase();
      if (IS_MAC && ext === '.app') { games.push({ name: path.basename(e.name, ext), path: full, source: src.id }); continue; }
      if (e.isFile() && GAME_FILES.includes(ext) && !JUNK_EXE.test(e.name)) {
        games.push({ name: path.basename(e.name, ext).replace(/[._]+/g, ' ').trim(), path: full, source: src.id });
      } else if (e.isDirectory()) {
        const exe = await bestExecutable(full, e.name);
        if (exe) games.push({ name: e.name, path: exe, source: src.id });
      }
    }
    status[src.id] = { ok: true, error: null, count: games.length - start };
  }
  games.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  return { games, status };
}

async function launchGamePath(target) {
  if (typeof target !== 'string' || !isAllowed(target)) return { ok: false, error: 'Ce jeu ne fait pas partie de vos dossiers de jeux.' };
  if (!fs.existsSync(target)) return { ok: false, error: `Fichier introuvable : ${target}` };
  return openTarget(target, [], { cwd: path.dirname(target), hideWhileRunning: true });
}

// Les emplacements d'une console : local (dossier principal) et distants (sources web ou réseau).
function consoleLocations(emu) {
  const main = emu.romsDir ? [{ location: emu.romsDir, remote: false }] : [];
  const extra = (emu.sources || []).map((loc) => ({ location: loc, remote: /^https?:\/\//i.test(loc) }));
  return [...main, ...extra];
}

// opts.online : inclure les sources distantes. opts.only : n'analyser qu'un emplacement précis.
async function listRoms(i, opts = {}) {
  const emu = config.emulators[i];
  if (!emu) return { ok: false, error: 'Cette console n’existe plus dans la configuration.' };
  let places = consoleLocations(emu);
  if (opts.only) places = places.filter((p) => p.location === opts.only);
  else if (!opts.online) places = places.filter((p) => !p.remote);
  const locations = places.map((p) => p.location);
  if (!locations.length) {
    if (!opts.online && consoleLocations(emu).some((p) => p.remote)) return { ok: true, roms: [], errors: [], noLocal: true };
    return { ok: false, error: `Aucun dossier de jeux indiqué pour ${emu.name}.` };
  }

  const exts = new Set((emu.extensions || []).map((e) => (String(e).startsWith('.') ? e : `.${e}`).toLowerCase()));
  const roms = [];
  const errors = [];
  const add = (p, fileName, dir, remote = false) => {
    const name = path.basename(fileName, path.extname(fileName));
    roms.push({ path: p, name, displayName: cleanRomName(name), dir, image: null, remote });
  };
  async function walk(dir, depth) {
    if (depth > 4 || roms.length > 20000) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (exts.size && !exts.has(ext)) continue;
      add(full, e.name, dir);
    }
  }
  for (const location of locations) {
    const loc = resolveLocation(location);
    try {
      if (loc.type === 'url') {
        await crawlHttp(loc.url, async (dirUrl, _dirName, files) => {
          for (const u of files) {
            const fileName = safeDecode(u.pathname.split('/').pop());
            if (exts.size && !exts.has(path.extname(fileName).toLowerCase())) continue;
            add(u.href, fileName, dirUrl, true);
          }
        });
      } else {
        try { await fsp.access(loc.path); } catch { throw new Error(locationError(location, loc)); }
        await walk(loc.path, 0);
      }
    } catch (err) { errors.push(err.message); }
  }
  if (!roms.length && errors.length === locations.length) return { ok: false, error: errors.join(' ') };

  // Jeux à plusieurs disques : la liste .m3u représente le jeu ; ses disques ne sont pas listés à part.
  const m3us = roms.filter((r) => /\.m3u$/i.test(String(r.path).split('?')[0]));
  if (m3us.length) {
    const keyOf = (p) => (/^https?:\/\//i.test(p) ? safeDecode(new URL(p).pathname) : path.resolve(p));
    const hidden = new Set();
    await Promise.all(m3us.map(async (r) => {
      let text = '';
      try { text = r.remote ? await downloads.fetchText(r.path) : disc.decode(await fsp.readFile(r.path)); } catch { return; }
      for (const ref of disc.parseRefs(r.path, text)) {
        hidden.add(keyOf(r.remote ? disc.refUrl(ref, r.path) : path.join(path.dirname(r.path), ...ref.split('/'))));
      }
    }));
    if (hidden.size) {
      const kept = roms.filter((r) => !hidden.has(keyOf(r.path)));
      roms.length = 0;
      roms.push(...kept);
    }
  }

  if (emu.imagesDir) {
    try {
      const images = new Map();
      for (const n of await fsp.readdir(emu.imagesDir)) {
        if (KIND[path.extname(n).toLowerCase()] === 'image') images.set(path.basename(n, path.extname(n)).toLowerCase(), path.join(emu.imagesDir, n));
      }
      for (const r of roms) r.image = images.get(r.name.toLowerCase()) || images.get(r.displayName.toLowerCase()) || null;
    } catch { /* pas de jaquettes */ }
  }
  roms.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { numeric: true, sensitivity: 'base' }));
  return { ok: true, roms, errors };
}

// Un jeu d'une source web est téléchargé une fois dans le cache de Mire, puis lancé.
async function launchRom(i, romPath) {
  const emu = config.emulators[i];
  if (!emu) return { ok: false, error: 'Cette console n’existe plus dans la configuration.' };
  let target = romPath;
  if (/^https?:\/\//i.test(romPath)) {
    const fromSource = (emu.sources || []).some((x) => /^https?:\/\//i.test(x) && romPath.startsWith(x.endsWith('/') ? x : `${x}/`));
    if (!fromSource) return { ok: false, error: 'Ce jeu ne provient pas d’une source de cette console.' };
    const fileName = safeDecode(new URL(romPath).pathname.split('/').pop()).replace(/[<>:"/\\|?*]/g, '_');
    target = path.join(romCacheDir(), slug(emu.name) || 'console', fileName);
    if (disc.isDescriptor(fileName)) {
      // Jeu sur disque : l'index et ses pistes (ou ses disques) vont ensemble dans un dossier du cache.
      let files;
      try { files = await disc.resolveRemote(romPath, (x) => downloads.fetchText(x)); } catch (err) { return { ok: false, error: `Index du jeu illisible (${err.message}).` }; }
      const folder = path.join(romCacheDir(), slug(emu.name) || 'console', path.basename(fileName, path.extname(fileName)));
      const todo = files.filter((f) => !fs.existsSync(path.join(folder, ...f.rel.split('/'))));
      for (const [n, f] of todo.entries()) {
        const dest = path.join(folder, ...f.rel.split('/'));
        const label = todo.length > 1 ? `${fileName} (fichier ${n + 1} sur ${todo.length})` : fileName;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        toUi('rom-progress', { name: label, phase: 'download' });
        try {
          await download(f.url, `${dest}.part`, (received, total) => toUi('rom-progress', { name: label, phase: 'download', received, total }));
          await fsp.rename(`${dest}.part`, dest);
        } catch (err) {
          await fsp.unlink(`${dest}.part`).catch(() => {});
          return { ok: false, error: `${path.basename(dest)} : ${err.message}` };
        }
      }
      if (todo.length) toUi('rom-progress', { name: fileName, phase: 'done' });
      target = path.join(folder, files[0].rel);
    } else if (!fs.existsSync(target)) {
      toUi('rom-progress', { name: fileName, phase: 'download' });
      try {
        await download(romPath, `${target}.part`, (received, total) => toUi('rom-progress', { name: fileName, phase: 'download', received, total }));
        await fsp.rename(`${target}.part`, target);
      } catch (err) {
        await fsp.unlink(`${target}.part`).catch(() => {});
        return { ok: false, error: err.message };
      }
      toUi('rom-progress', { name: fileName, phase: 'done' });
    }
  } else if (!isAllowed(romPath)) {
    return { ok: false, error: 'Ce jeu ne se trouve pas dans les dossiers de la console.' };
  }
  const args = substitute(Array.isArray(emu.args) && emu.args.length ? emu.args : ['{rom}'], { rom: target });
  const cwd = path.isAbsolute(emu.path) ? path.dirname(emu.path) : undefined;
  return launchProcess(emu.path, args, { cwd, hideWhileRunning: true });
}

/* ---------- Modifications manuelles des infos (titre, genre, images…) ---------- */

let userMeta = {};
const metaFile = () => path.join(metaDir(), 'meta.json');
function loadMeta() {
  try { userMeta = JSON.parse(fs.readFileSync(metaFile(), 'utf8')) || {}; } catch { userMeta = {}; }
}
function saveMeta() {
  fs.mkdirSync(metaDir(), { recursive: true });
  fs.writeFileSync(metaFile(), JSON.stringify(userMeta, null, 2), 'utf8');
}
const META_FIELDS = ['title', 'year', 'genre', 'overview', 'artist', 'image', 'backdrop'];
function setMeta(key, patch) {
  if (typeof key !== 'string' || !key) return null;
  const cur = { ...(userMeta[key] || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!META_FIELDS.includes(k)) continue;
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val == null) delete cur[k]; else cur[k] = val;
  }
  if (Object.keys(cur).length) userMeta[key] = cur; else delete userMeta[key];
  saveMeta();
  return userMeta[key] || null;
}
async function pickMetaImage(key, field) {
  if (!['image', 'backdrop'].includes(field)) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: field === 'image' ? 'Choisir l’image' : 'Choisir le fond d’écran',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const dest = path.join(metaDir(), 'img', `${crypto.createHash('sha1').update(`${key}|${field}|${Date.now()}`).digest('hex')}${path.extname(src).toLowerCase()}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  return setMeta(key, { [field]: dest });
}

/* ------------------------------------------------------------------ */
/* Dialogues                                                           */
/* ------------------------------------------------------------------ */

async function pickFolder() {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Choisir un dossier', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
}

async function pickFile(kind) {
  const filters = {
    program: IS_WIN ? [{ name: 'Programmes', extensions: ['exe'] }] : IS_MAC ? [{ name: 'Applications', extensions: ['app'] }] : [],
    game: IS_WIN ? [{ name: 'Jeux et raccourcis', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }] : IS_MAC ? [{ name: 'Applications', extensions: ['app'] }] : [],
    image: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  }[kind] || [];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [...filters, { name: 'Tous les fichiers', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
}

async function openMediaDialog() {
  const all = Object.values(EXT).flat().map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir des fichiers',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Vidéos, musiques et images', extensions: all }, { name: 'Tous les fichiers', extensions: ['*'] }],
  });
  if (r.canceled) return [];
  return (await Promise.all(r.filePaths.map(itemFromPath))).filter(Boolean);
}

async function addGame() {
  const p = await pickFile('game');
  if (!p) return null;
  const name = path.basename(p).replace(/\.(exe|lnk|url|bat|cmd|app)$/i, '');
  return saveConfig({ ...config, games: [...config.games, { name, path: p, args: [], image: '' }] });
}

/* ------------------------------------------------------------------ */
/* Fenêtre principale                                                  */
/* ------------------------------------------------------------------ */

function themeBackground() {
  const t = config.ui.theme === 'auto' ? (nativeTheme.shouldUseDarkColors ? 'ecran' : 'jour') : config.ui.theme;
  return THEME_BG[t] || THEME_BG.ecran;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 960,
    minHeight: 620,
    title: 'Mire',
    backgroundColor: themeBackground(),
    autoHideMenuBar: true,
    fullscreen: !!config.ui.fullscreen,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { mainWindow.setFullScreen(!mainWindow.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); e.preventDefault(); }
  });
  mainWindow.on('resize', () => { if (web.immersive || web.html) applyWeb(); });
  // Bouton « précédent » de la souris (Windows) dans un site.
  mainWindow.on('app-command', (_e, cmd) => {
    if (!web.visible) return;
    if (cmd === 'browser-backward') webNav('back');
    if (cmd === 'browser-forward') webNav('forward');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    webViews.clear();
    if (!IS_MAC) app.quit();
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function filesFromArgv(argv) {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => a && !a.startsWith('-'))
    .filter((a) => { try { return fs.statSync(a).isFile(); } catch { return false; } });
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try { return await fn(...args); } catch (err) { console.error(channel, err); return { ok: false, error: err.message }; }
  });

  handle('config:get', () => ({ config, configPath: configPath(), platform: process.platform }));
  handle('config:save', (next) => {
    if (!next || typeof next !== 'object') throw new Error('Configuration invalide.');
    const wasFullscreen = config.ui.fullscreen;
    const saved = saveConfig(next);
    if (mainWindow && saved.ui.fullscreen !== wasFullscreen) mainWindow.setFullScreen(!!saved.ui.fullscreen);
    for (const w of webViews.values()) w.entry = saved.web.find((e) => e.id === w.entry.id) || w.entry;
    if (mainWindow) mainWindow.setBackgroundColor(themeBackground());
    return saved;
  });
  handle('config:reveal', () => { shell.showItemInFolder(configPath()); return true; });
  // Export : copie du fichier de configuration là où l'utilisateur veut.
  handle('config:export', async () => {
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Exporter la configuration', defaultPath: `mire-config-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Configuration Mire', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    await fsp.writeFile(r.filePath, JSON.stringify(config, null, 2), 'utf8');
    return { ok: true, path: r.filePath };
  });
  // Import : remplace entièrement, ou complète (fusionne sites, consoles, jeux, sources sans doublon).
  handle('config:import', async (mode) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Importer une configuration', properties: ['openFile'], filters: [{ name: 'Configuration Mire', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    let data;
    try { data = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8')); } catch { return { ok: false, error: 'Ce fichier n’est pas une configuration Mire valide (JSON illisible).' }; }
    const { raw } = migrateConfig(data);
    config = saveConfig(mode === 'merge' ? mergeConfig(config, raw) : raw);
    return { ok: true, config };
  });
  handle('tv:detect', async () => { const id = await detectTvService(); if (id) config = saveConfig({ ...config, tv: { ...config.tv, active: id, detected: true } }); return { id, name: config.tv.services.find((t) => t.id === id)?.name || '' }; });
  handle('tv:setActive', (id) => { config = saveConfig({ ...config, tv: { ...config.tv, active: String(id || ''), detected: true } }); return config; });

  handle('library:scan', scanLibrary);
  handle('games:scanSources', scanGameSources);
  handle('roms:listSource', (i, only) => listRoms(i, { online: true, only }));
  // Supprime un jeu : fichier local effacé, ou jeu PC manuel retiré de la configuration.
  handle('games:delete', async (ref) => {
    if (ref.kind === 'game') {
      if (ref.manualIndex != null && config.games[ref.manualIndex]) {
        const next = structuredClone(config); next.games.splice(ref.manualIndex, 1); config = saveConfig(next);
        return { ok: true, config };
      }
      return { ok: false, error: 'Ce jeu est trouvé automatiquement dans un dossier : retirez le dossier dans les réglages, ou supprimez le jeu sur le disque.' };
    }
    // Jeu de console local : on supprime son fichier (et les fichiers voisins d'un jeu sur disque).
    if (!ref.path || /^https?:\/\//i.test(ref.path)) return { ok: false, error: 'Un jeu disponible en ligne ne peut pas être supprimé ici.' };
    try {
      const st = await fsp.stat(ref.path);
      if (disc.isDescriptor(ref.path)) {
        const dir = path.dirname(ref.path);
        const refs = disc.missingLocal(ref.path).length === 0 ? disc.parseRefs(ref.path, disc.decode(await fsp.readFile(ref.path))) : [];
        for (const r of refs) await fsp.rm(path.join(dir, ...r.split('/')), { force: true }).catch(() => {});
      }
      await fsp.rm(ref.path, { force: true, recursive: st.isDirectory() });
      return { ok: true };
    } catch (err) { return { ok: false, error: `Suppression impossible : ${err.message}` }; }
  });
  // Nettoyage : vérifie que chaque jeu existe encore (fichier local présent, adresse en ligne joignable).
  handle('games:cleanup', async (online) => {
    const result = { missingLocal: [], missingRemote: [], removedManual: 0, checked: 0 };
    const nextGames = [];
    for (const g of config.games) {
      result.checked++;
      if (/^[a-z]+:\/\//i.test(g.path) || fs.existsSync(g.path)) nextGames.push(g);
      else { result.removedManual++; result.missingLocal.push(g.name); }
    }
    for (let i = 0; i < config.emulators.length; i++) {
      const emu = config.emulators[i];
      const local = await listRoms(i).catch(() => null); // fichiers locaux présents
      if (local?.ok) { /* les fichiers listés existent par construction */ }
      if (online) {
        for (const p of consoleLocations(emu).filter((x) => x.remote)) {
          try {
            const res = await fetch(p.location, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
            if (!res.ok) result.missingRemote.push(`${emu.name} : ${p.location}`);
          } catch { result.missingRemote.push(`${emu.name} : ${p.location}`); }
          result.checked++;
        }
      }
    }
    if (result.removedManual) { const next = structuredClone(config); next.games = nextGames; config = saveConfig(next); result.config = config; }
    return { ok: true, ...result };
  });
  handle('games:launchPath', launchGamePath);
  handle('meta:all', () => userMeta);
  handle('meta:set', setMeta);
  handle('meta:pickImage', pickMetaImage);
  handle('meta:reset', (key) => { delete userMeta[key]; saveMeta(); return true; });
  // Image choisie sur le disque (bannière d'une console…) : copiée dans les données de Mire.
  handle('image:pick', async (title) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Choisir une image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const dest = path.join(metaDir(), 'img', `${crypto.createHash('sha1').update(`${src}|${Date.now()}`).digest('hex')}${path.extname(src).toLowerCase()}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    return dest;
  });
  handle('location:check', async (loc) => {
    const r = resolveLocation(loc);
    if (r.type === 'url') {
      try { const res = await fetch(r.url, { method: 'GET', signal: AbortSignal.timeout(10000) }); return { ok: res.ok, error: res.ok ? null : `Le serveur a répondu avec le code ${res.status}.` }; }
      catch { return { ok: false, error: 'Adresse injoignable.' }; }
    }
    try { await fsp.access(r.path); return { ok: true }; } catch { return { ok: false, error: locationError(loc, r) }; }
  });
  handle('media:subtitles', findSubtitles);
  handle('media:openDialog', openMediaDialog);
  handle('media:fromPaths', async (paths) => (await Promise.all((paths || []).map(itemFromPath))).filter(Boolean));
  handle('app:pendingFiles', async () => {
    const items = (await Promise.all(pendingFiles.map(itemFromPath))).filter(Boolean);
    pendingFiles = [];
    return items;
  });

  handle('dialog:folder', pickFolder);
  handle('dialog:file', pickFile);

  handle('player:external', playExternal);
  handle('web:open', webOpen);
  handle('web:show', webShow);
  handle('web:hide', webHide);
  handle('web:bounds', webBounds);
  handle('web:nav', webNav);
  handle('web:close', webClose);
  handle('web:focus', webFocus);
  handle('web:key', webKey);
  handle('web:learnSearch', webLearnSearch);
  handle('web:sessions', webSessions);
  handle('downloads:list', () => ({ items: downloads.list(), settings: downloads.settings() }));
  handle('downloads:addUrl', (url, ctx) => {
    const u = String(url || '').trim();
    if (/^magnet:\?/i.test(u)) return downloads.addTorrent(u, ctx || {});
    return downloads.addUrl(u, ctx || {});
  });
  handle('downloads:addTorrentFile', async (ctx) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choisir un fichier .torrent', properties: ['openFile'], filters: [{ name: 'Torrents', extensions: ['torrent'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return downloads.addTorrent(r.filePaths[0], ctx || {});
  });
  handle('downloads:pause', (id) => downloads.pause(id));
  handle('downloads:resume', (id) => downloads.resume(id));
  handle('downloads:cancel', (id, removeFiles) => downloads.cancel(id, removeFiles !== false));
  handle('downloads:remove', (id) => downloads.remove(id));
  handle('downloads:clear', () => downloads.clearFinished());
  handle('downloads:reveal', (id) => downloads.reveal(id));
  handle('downloads:runInstaller', (id, file) => downloads.runInstaller(id, file));
  handle('downloads:pickDir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Dossier des téléchargements', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  // Jeu d'une source web : copie locale dans le dossier principal de la console.
  handle('roms:download', async (i, url) => {
    const emu = config.emulators[i];
    if (!emu) return { ok: false, error: 'Cette console n’existe plus dans la configuration.' };
    if (!emu.romsDir) return { ok: false, error: `Indiquez d’abord le dossier principal de ${emu.name} (Modifier la console).` };
    const u = String(url || '');
    if (!disc.isDescriptor(u)) return { ...downloads.addUrl(u, { console: i }), count: 1 };
    // Jeu sur disque : l'index et tous les fichiers qu'il cite, dans un dossier au nom du jeu.
    let files;
    try { files = await disc.resolveRemote(u, (x) => downloads.fetchText(x)); } catch (err) { return { ok: false, error: `Index du jeu illisible (${err.message}).` }; }
    const base = path.basename(files[0].rel, path.extname(files[0].rel)).replace(/[<>:"/\\|?*]/g, '_');
    const folder = path.join(emu.romsDir, base);
    const todo = files.filter((f) => !fs.existsSync(path.join(folder, ...f.rel.split('/'))));
    for (const f of todo) downloads.addUrl(f.url, { console: i, saveAs: path.join(folder, ...f.rel.split('/')), group: base, companionsQueued: true });
    return { ok: true, count: todo.length, total: files.length };
  });
  handle('store:biosAdd', async (id) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choisir le ou les fichiers BIOS', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    return store.addBios(id, r.filePaths);
  });
  handle('store:biosOpen', async (id) => {
    const dir = store.biosDir(id);
    if (!dir) return { ok: false };
    await fsp.mkdir(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
  });
  // Marque-page d'une page de streaming : crée une entrée vidéo et la scrape aussitôt.
  handle('bookmarks:add', async (data) => {
    const url = String(data?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Adresse de page invalide.' };
    const title = String(data?.title || '').trim();
    if (!title) return { ok: false, error: 'Donnez un titre à chercher (nom du film ou de la série).' };
    const type = data?.type === 'tv' ? 'tv' : 'movie';
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* adresse sans hôte */ }
    const bm = {
      id: newId(), url, title, type,
      season: type === 'tv' && data.season ? Number(data.season) : null,
      episode: type === 'tv' && data.episode ? Number(data.episode) : null,
      site, added: Date.now(),
    };
    config = saveConfig({ ...config, bookmarks: [...(config.bookmarks || []), bm] });
    // Scraping immédiat : on récupère la fiche TMDB à partir du titre (et du type choisi).
    let scraped = false;
    try {
      const item = { path: url, name: title, dir: site, kind: 'video' };
      const r = await scraper.one({ kind: 'video', item, override: { type, title, year: data.year || '' } });
      scraped = !!r?.ok;
    } catch (err) { console.error('Marque-page, scraping :', err.message); }
    return { ok: true, bookmark: bm, scraped, config };
  });
  handle('bookmarks:remove', (id) => {
    config = saveConfig({ ...config, bookmarks: (config.bookmarks || []).filter((b) => b.id !== id) });
    return { ok: true, config };
  });
  // Rouvre la page d'un marque-page dans la vue intégrée.
  handle('bookmarks:open', (id) => webOpen(`bm:${id}`, null));

  // Marque-page d'un jeu depuis un site de téléchargement : fiche à scraper, lien direct, ou .torrent.
  // data : { source, title?, console? (console ouverte), kind? }
  handle('gameBookmarks:add', async (data) => {
    const source = String(data?.source || '').trim();
    const isMagnet = /^magnet:\?/i.test(source);
    if (!isMagnet && !/^https?:\/\//i.test(source) && !source.toLowerCase().endsWith('.torrent')) return { ok: false, error: 'Lien ou fichier invalide.' };
    const kind = isMagnet || source.toLowerCase().endsWith('.torrent') ? 'torrent' : 'http';
    const curConsole = data?.console === 'pc' ? 'pc' : (data?.console != null ? Number(data.console) : null);
    const curEmu = typeof curConsole === 'number' ? config.emulators[curConsole] : null;

    // Titre : fourni, sinon déduit du lien.
    let title = String(data?.title || '').trim();
    if (!title) { try { title = decodeURIComponent(path.basename(new URL(source).pathname)).replace(/\.[a-z0-9]+$/i, '') || source; } catch { title = path.basename(source) || source; } }

    // Scraping : on cherche la fiche du jeu pour en tirer le système, le genre, la jaquette.
    let system = curEmu ? guessSystem(curEmu) : '';
    let scraped = false;
    try {
      const scrapeKind = curConsole === 'pc' ? 'pc' : 'rom';
      const item = curConsole === 'pc' ? { name: title, path: source } : { name: title, path: source, displayName: title, emu: curConsole };
      const found = await scraper.candidates({ kind: scrapeKind, item, query: title });
      if (found?.ok && found.items.length) {
        // On retient la 1re fiche et on enregistre ses infos sous la clé du futur jeu.
        scraped = true;
      }
    } catch (err) { console.error('Marque-page jeu, scraping :', err.message); }

    // Système non déterminé : on le signale, l'interface demandera (console ouverte par défaut).
    const needSystem = typeof curConsole !== 'number' && !system;

    const bm = { id: newId(), source, kind, title, console: curConsole, system, downloadId: null, done: false, added: Date.now() };
    // Entrée « en attente de téléchargement » dans le gestionnaire.
    const dlCtx = { name: title, gameBookmark: bm.id, console: typeof curConsole === 'number' ? curConsole : undefined };
    const pending = downloads.addPending(source, dlCtx);
    bm.downloadId = pending.id;
    config = saveConfig({ ...config, gameBookmarks: [...(config.gameBookmarks || []), bm] });
    return { ok: true, bookmark: bm, scraped, needSystem, config };
  });
  handle('gameBookmarks:setConsole', (id, consoleIdx) => {
    const idx = consoleIdx === 'pc' ? 'pc' : Number(consoleIdx);
    config = saveConfig({ ...config, gameBookmarks: (config.gameBookmarks || []).map((b) => (b.id === id ? { ...b, console: idx } : b)) });
    return { ok: true, config };
  });
  handle('gameBookmarks:remove', (id) => {
    const bm = (config.gameBookmarks || []).find((b) => b.id === id);
    if (bm?.downloadId) downloads.remove(bm.downloadId);
    config = saveConfig({ ...config, gameBookmarks: (config.gameBookmarks || []).filter((b) => b.id !== id) });
    return { ok: true, config };
  });
  handle('gameBookmarks:download', (id) => {
    const bm = (config.gameBookmarks || []).find((b) => b.id === id);
    if (!bm) return { ok: false, error: 'Marque-page introuvable.' };
    downloads.startPending(bm.downloadId);
    return { ok: true };
  });
  handle('roms:sites', (i) => ({ sites: consoleSites(i), custom: i === 'pc' ? true : Array.isArray(config.emulators[i]?.romSites), defaults: i === 'pc' ? [] : (config.emulators[i] ? defaultRomSites(guessSystem(config.emulators[i])) : []) }));
  handle('drm:status', drmStatus);
  handle('adblock:status', () => (adblock ? adblock.status() : null));
  handle('adblock:setEnabled', (on) => {
    const st = adblock.setEnabled(on);
    for (const w of webViews.values()) w.view.webContents.reload();
    return st;
  });
  handle('adblock:toggleSite', () => {
    const w = webViews.get(web.activeId);
    if (!w) return null;
    const st = adblock.toggleSite(w.view.webContents.getURL());
    w.view.webContents.reload();
    return { ...st, adOn: adblock.status().enabled && !adblock.pageAllowed(w.view.webContents.getURL()) };
  });
  handle('adblock:setLists', (lists) => adblock.setLists(lists || {}));
  handle('adblock:update', async () => { await adblock.refresh(); return adblock.status(); });

  handle('scrape:data', () => scraper.data());
  handle('scrape:run', (opts) => scraper.run(opts || {}));
  handle('scrape:one', (job) => scraper.one(job || {}));
  handle('scrape:candidates', (job) => scraper.candidates(job || {}));
  handle('scrape:cancel', () => scraper.cancel());
  handle('scrape:forget', (key) => scraper.forget(key));
  handle('scrape:clear', () => scraper.clear());

  handle('store:catalog', () => store.catalog());
  handle('store:install', (id, systems) => store.install(id, systems));
  handle('store:uninstall', (id) => store.uninstall(id));
  handle('store:game', (id) => store.getGame(id));
  handle('store:import', async (emuIndex) => {
    const emu = config.emulators[emuIndex];
    if (!emu) return { ok: false, error: 'Console inconnue.' };
    const exts = (emu.extensions || []).map((e) => String(e).replace(/^\./, ''));
    const r = await dialog.showOpenDialog(mainWindow, {
      title: `Importer des jeux pour ${emu.name}`,
      properties: ['openFile', 'multiSelections'],
      filters: [...(exts.length ? [{ name: emu.name, extensions: exts }] : []), { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    if (r.canceled) return { ok: true, count: 0 };
    return store.importFiles(emuIndex, r.filePaths);
  });
  handle('store:pickRoot', async () => {
    const p = await pickFolder();
    if (!p) return null;
    return saveConfig({ ...config, store: { ...config.store, romsRoot: p } });
  });
  handle('search:streaming', searchStreaming);
  handle('tv:channels', fetchChannels);

  handle('games:launch', launchGame);
  handle('games:add', addGame);
  handle('emu:roms', listRoms);
  handle('emu:launch', launchRom);

  handle('window:fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  handle('app:quit', () => { app.quit(); return true; });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFiles = filesFromArgv(process.argv);

  app.on('second-instance', async (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const items = (await Promise.all(filesFromArgv(argv).map(itemFromPath))).filter(Boolean);
    if (items.length) mainWindow.webContents.send('open-files', items);
  });

  app.whenReady().then(() => {
    loadConfig();
    loadMeta();
    const sevenZipPath = require('7zip-bin').path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    scraper = createScraper({
      dataDir: app.getPath('userData'),
      getConfig: () => config,
      listRoms,
      onProgress: (p) => toUi('scrape-progress', p),
    });
    store = createStore({
      dataDir: app.getPath('userData'),
      defaultRomsRoot: path.join(app.getPath('documents'), 'Mire', 'ROMs'),
      getConfig: () => config,
      saveConfig,
      onProgress: (p) => toUi('store-progress', p),
      sevenZipPath,
      paths: { home: app.getPath('home'), documents: app.getPath('documents'), appData: app.getPath('appData') },
    });
    downloads = createDownloads({
      dataDir: app.getPath('userData'),
      getConfig: () => config,
      getSession: () => session.fromPartition('persist:web'),
      extract: (file, dest) => store.extract(file, dest),
      shell,
      defaultDir: path.join(app.getPath('downloads'), 'Mire'),
      onChange: (item) => toUi('download', item),
      onFinished: (item) => {
        toUi('download-finished', item);
        // Marque-page de jeu téléchargé : on le marque terminé (sa carte « à télécharger » disparaît).
        if (item.gameBookmark) {
          const bm = (config.gameBookmarks || []).find((b) => b.id === item.gameBookmark);
          if (bm) config = saveConfig({ ...config, gameBookmarks: config.gameBookmarks.map((b) => (b.id === bm.id ? { ...b, done: true } : b)) });
        }
        if (item.console == null) return;
        // Index qui attend ses pistes : on annoncera le jeu quand tout sera là.
        if (item.companions && !item.group) return;
        if (item.group) {
          // Fichiers d'un même jeu sur disque : un seul message, quand le dernier est arrivé.
          const same = downloads.list().filter((d) => d.group === item.group && d.console === item.console);
          if (same.some((d) => !['done', 'error', 'cancelled'].includes(d.state))) return;
          // L'index téléchargé seul depuis une page compte aussi parmi les fichiers du jeu.
          const index = downloads.list().filter((d) => !d.group && d.companions && d.console === item.console && path.basename(d.name, path.extname(d.name)) === item.group).length;
          toUi('rom-download', { phase: 'done', console: item.console, consoleName: item.consoleName, name: item.group, files: same.length + index, extracted: same.some((d) => d.extracted) });
          return;
        }
        toUi('rom-download', { phase: 'done', console: item.console, consoleName: item.consoleName, name: item.name, extracted: !!item.extracted });
      },
    });
    downloads.start().catch((err) => console.error('Téléchargements :', err.message));
    // Premier lancement : on repère le service de télévision en place sur le réseau local.
    detectTvOnce().catch((err) => console.error('Détection TV :', err.message));
    if (IS_MAC) {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }
    registerMediaProtocol();
    setupWebSession();
    startWidevine();
    adblock = createAdblock({
      dataDir: app.getPath('userData'),
      getConfig: () => config,
      saveConfig,
      onCount: onAdCount,
    });
    // Le premier site ouvert attend le bloqueur (dix secondes au plus) pour ne pas laisser passer de pubs.
    adblockReady = Promise.race([
      adblock.start(session.fromPartition('persist:web')).catch((err) => { console.error('Bloqueur :', err.message); return false; }),
      new Promise((resolve) => { setTimeout(() => resolve(false), 10000); }),
    ]);
    registerIpc();
    createMainWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
  });

  app.on('before-quit', () => { downloads?.stop().catch(() => {}); });

app.on('window-all-closed', () => { if (!IS_MAC) app.quit(); });
}
