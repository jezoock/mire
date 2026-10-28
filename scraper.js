'use strict';
/**
 * Récupération d'infos de base et d'une image pour les listes de Mire.
 *
 *   Films et séries : TMDB (clé gratuite à saisir dans Réglages)
 *   Albums          : MusicBrainz + Cover Art Archive (sans clé)
 *   Jeux de console : libretro-thumbnails, les jaquettes utilisées par RetroArch (sans clé)
 *   Jeux PC         : recherche du magasin Steam (sans clé)
 *
 * Les images sont copiées dans <données de Mire>/scrape/img ; rien n'est écrit dans vos dossiers.
 */
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const UA = 'Mire/1.0 (lecteur multimédia personnel)';
const MISS_RETRY_MS = 14 * 24 * 3600 * 1000; // un titre introuvable est réessayé au bout de 14 jours
const REV = 2; // révision des données : les fiches plus anciennes (sans genre ni fond) sont complétées

// Genres de jeux libretro (anglais) → français.
const GAME_GENRES = {
  platform: 'Plateformes', action: 'Action', sports: 'Sport', 'role-playing (rpg)': 'Jeu de rôle', adventure: 'Aventure',
  strategy: 'Stratégie', racing: 'Course', puzzle: 'Réflexion', shooter: 'Tir', "shoot'em up": 'Shoot’em up', board: 'Jeu de plateau',
  "beat'em up": 'Beat’em up', fighting: 'Combat', simulation: 'Simulation', compilation: 'Compilation', gambling: 'Casino',
  educational: 'Éducatif', pinball: 'Flipper', card: 'Cartes', 'sports with animals': 'Sport', 'hunting and fishing': 'Chasse et pêche',
  'casual game': 'Jeu familial', various: 'Divers', quiz: 'Quiz', 'lightgun shooter': 'Tir au pistolet', 'music / dancing': 'Musique et danse',
  thinking: 'Réflexion', adult: 'Adulte',
};
// Étiquettes MusicBrainz courantes → français.
const MUSIC_GENRES = {
  electronic: 'Électronique', 'hip hop': 'Hip-hop', classical: 'Classique', soundtrack: 'Bande originale', 'french house': 'French touch',
  'house': 'House', 'pop': 'Pop', 'rock': 'Rock', 'jazz': 'Jazz', 'blues': 'Blues', 'metal': 'Metal', 'heavy metal': 'Metal', 'folk': 'Folk',
  'chanson française': 'Chanson française', 'chanson': 'Chanson française', 'reggae': 'Reggae', 'soul': 'Soul', 'funk': 'Funk',
  'r&b': 'R&B', 'country': 'Country', 'punk': 'Punk', 'ambient': 'Ambient', 'techno': 'Techno', 'downtempo': 'Downtempo', 'trip hop': 'Trip-hop',
  'alternative rock': 'Rock alternatif', 'indie rock': 'Rock indé', 'indie pop': 'Pop indé', 'world': 'Musiques du monde', 'disco': 'Disco', 'rap': 'Rap',
};
const capitalize = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const INDEX_TTL_MS = 30 * 24 * 3600 * 1000;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* ------------------------------------------------------------------ */
/* Analyse des noms de fichiers                                        */
/* ------------------------------------------------------------------ */

const JUNK = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|eac3|dts|truehd|atmos|10bit|multi|vff|vfq|vfi|vf2|vf|vostfr|vost|truefrench|french|subfrench|custom|proper|repack|extended|unrated|remastered|imax|internal|complete|integrale|intégrale)\b.*$/i;

function cleanTitle(s) {
  return String(s)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(JUNK, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s([{-]+$/, '')
    .trim();
}

const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

// « Le.Fabuleux.Destin.2001.1080p.mkv » → film « Le Fabuleux Destin », 2001
// « S01E03.mkv » dans « Le Bureau des légendes/Saison 1 » → série « Le Bureau des légendes »
function parseVideo(item) {
  const name = item.name;
  const ep = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(name) || /\b(\d{1,2})x(\d{2})\b/.exec(name);
  if (ep) {
    let title = cleanTitle(name.slice(0, ep.index));
    if (!title) {
      const parts = String(item.dir || '').split(/[\\/]/).filter(Boolean);
      const folder = parts[parts.length - 1] || '';
      title = GENERIC_DIR.test(folder) ? (parts[parts.length - 2] || '') : folder;
      title = cleanTitle(title);
    }
    return { type: 'tv', title, year: '' };
  }
  const years = [...name.matchAll(/(?:^|[\s.(_\[-])((?:19|20)\d{2})(?=$|[\s.)_\]-])/g)];
  let year = '';
  let title = name;
  if (years.length) {
    const last = years[years.length - 1];
    const before = name.slice(0, last.index + 1);
    if (cleanTitle(before)) { year = last[1]; title = before; }
  }
  return { type: 'movie', title: cleanTitle(title), year };
}

// « Super Mario World (Europe) (En,Fr) [!] » → « super mario world »
const romKey = (s) => fold(s).replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const REGION_PREF = ['france', 'fr', 'europe', 'world', 'usa, europe', 'usa', 'japan'];

function regionScore(file) {
  const tags = fold(file).match(/\(([^)]*)\)/g) || [];
  const joined = tags.join(' ');
  const i = REGION_PREF.findIndex((r) => joined.includes(r));
  return i < 0 ? REGION_PREF.length : i;
}

function bigramDice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) { grams.set(g, n - 1); hits += 1; }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

// Classe des résultats d'après leur titre : identique > commence par > contient, l'ordre d'origine départage.
// (« Replaced » doit donner REPLACED, pas « The Farmer Was Replaced », même s'il arrive en second.)
const titleKey = (s) => fold(s).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
function rankByTitle(list, query, getTitle, getYear, year) {
  const q = titleKey(query);
  return list
    .map((x, i) => {
      const t = titleKey(getTitle(x));
      let score = t === q ? 3 : t.startsWith(`${q} `) || q.startsWith(`${t} `) ? 1.5 : t.includes(q) ? 1 : 0;
      if (year && getYear && String(getYear(x) || '').slice(0, 4) === String(year)) score += 2;
      return { x, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.x);
}

// Devine le système libretro d'une console d'après son nom, ses extensions ou son programme.
const SYSTEM_GUESS = [
  [/\.(nes|fds|unf)$/, 'Nintendo - Nintendo Entertainment System'],
  [/\.(sfc|smc)$/, 'Nintendo - Super Nintendo Entertainment System'],
  [/\.gbc$/, 'Nintendo - Game Boy Color'],
  [/\.gb$/, 'Nintendo - Game Boy'],
  [/\.gba$/, 'Nintendo - Game Boy Advance'],
  [/\.(n64|z64|v64)$/, 'Nintendo - Nintendo 64'],
  [/\.nds$/, 'Nintendo - Nintendo DS'],
  [/\.(3ds|cci|cxi)$/, 'Nintendo - Nintendo 3DS'],
  [/\.(md|gen|smd)$/, 'Sega - Mega Drive - Genesis'],
  [/\.sms$/, 'Sega - Master System - Mark III'],
  [/\.gg$/, 'Sega - Game Gear'],
  [/\.pce$/, 'NEC - PC Engine - TurboGrafx 16'],
  [/\.a26$/, 'Atari - 2600'],
];
const NAME_GUESS = [
  [/duckstation|playstation(?!\s*[2p])|\bps1\b|psx/i, 'Sony - PlayStation'],
  [/pcsx2|playstation\s*2|\bps2\b/i, 'Sony - PlayStation 2'],
  [/ppsspp|\bpsp\b/i, 'Sony - PlayStation Portable'],
  [/gamecube|\bgc\b/i, 'Nintendo - GameCube'],
  [/\bwii\s*u\b|cemu/i, 'Nintendo - Wii U'],
  [/\bwii\b/i, 'Nintendo - Wii'],
  [/dolphin/i, 'Nintendo - GameCube'],
  [/dreamcast|flycast/i, 'Sega - Dreamcast'],
  [/saturn/i, 'Sega - Saturn'],
  [/super\s*nintendo|snes/i, 'Nintendo - Super Nintendo Entertainment System'],
  [/mega\s*drive|genesis/i, 'Sega - Mega Drive - Genesis'],
  [/nintendo\s*64|\bn64\b/i, 'Nintendo - Nintendo 64'],
  [/game\s*boy\s*advance|\bgba\b/i, 'Nintendo - Game Boy Advance'],
  [/game\s*boy\s*color|\bgbc\b/i, 'Nintendo - Game Boy Color'],
  [/game\s*boy|\bgb\b/i, 'Nintendo - Game Boy'],
  [/\bnes\b|famicom/i, 'Nintendo - Nintendo Entertainment System'],
];
function guessSystem(emu) {
  if (emu.system) return emu.system;
  for (const [re, sys] of NAME_GUESS) if (re.test(`${emu.name} ${emu.path}`)) return sys;
  for (const ext of emu.extensions || []) {
    for (const [re, sys] of SYSTEM_GUESS) if (re.test(String(ext).toLowerCase())) return sys;
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Le module                                                           */
/* ------------------------------------------------------------------ */

function createScraper({ dataDir, getConfig, listRoms, onProgress }) {
  const root = path.join(dataDir, 'scrape');
  const imgDir = path.join(root, 'img');
  const dbFile = path.join(root, 'db.json');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  let db = { items: {}, misses: {} };
  try { db = { items: {}, misses: {}, ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) }; } catch { /* première fois */ }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { fs.writeFile(dbFile, JSON.stringify(db), () => {}); }, 400);
  }

  const state = { running: false, cancel: false };

  async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${new URL(url).hostname} : code ${res.status}`);
    return res.json();
  }

  async function getText(url) {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return res.text();
  }

  async function saveImage(url, key) {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    const file = path.join(imgDir, crypto.createHash('sha1').update(key).digest('hex') + ext);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }

  function record(key, data) {
    db.items[key] = { ...data, rev: REV, at: Date.now() };
    delete db.misses[key];
    save();
  }
  function miss(key) {
    db.misses[key] = Date.now();
    save();
  }
  function wanted(key, force) {
    if (force) return true;
    if (db.items[key]) return db.items[key].rev !== REV;
    const m = db.misses[key];
    return !m || Date.now() - m > MISS_RETRY_MS;
  }

  /* ---------- TMDB ---------- */

  async function tmdb(pathname, params = {}) {
    const cfg = getConfig();
    const token = String(cfg.search.tmdbToken || '').trim();
    const url = new URL(`https://api.themoviedb.org/3${pathname}`);
    for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) url.searchParams.set(k, v);
    const headers = {};
    if (token.length > 60) headers.authorization = `Bearer ${token}`;
    else url.searchParams.set('api_key', token);
    return getJson(url.toString(), headers);
  }

  let genreMap = null;
  async function tmdbGenres() {
    if (genreMap) return genreMap;
    const language = getConfig().search.language || 'fr-FR';
    const [m, t] = await Promise.all([tmdb('/genre/movie/list', { language }).catch(() => null), tmdb('/genre/tv/list', { language }).catch(() => null)]);
    genreMap = new Map([...(m?.genres || []), ...(t?.genres || [])].map((g) => [g.id, g.name]));
    return genreMap;
  }
  const genreNames = async (ids) => {
    const map = await tmdbGenres();
    return (ids || []).map((id) => map.get(id)).filter(Boolean).slice(0, 2).join(', ');
  };

  const tvCache = new Map(); // une seule recherche par série
  async function lookupVideo(parsed) {
    const language = getConfig().search.language || 'fr-FR';
    if (!parsed.title) return null;
    if (parsed.type === 'tv') {
      // On garde la requête elle-même : les épisodes traités en parallèle partagent la même recherche.
      const k = fold(parsed.title);
      if (!tvCache.has(k)) {
        tvCache.set(k, tmdb('/search/tv', { query: parsed.title, language }).then((data) => {
          const r = rankByTitle(data?.results || [], parsed.title, (x) => x.name)[0] || null;
          return r ? { title: r.name, year: (r.first_air_date || '').slice(0, 4), overview: r.overview || '', poster: r.poster_path, backdrop: r.backdrop_path, genreIds: r.genre_ids, tv: true } : null;
        }).catch((err) => { tvCache.delete(k); throw err; }));
      }
      return tvCache.get(k);
    }
    const best = (d) => rankByTitle(d?.results || [], parsed.title, (x) => x.title, (x) => x.release_date, parsed.year)[0];
    let data = await tmdb('/search/movie', { query: parsed.title, year: parsed.year, language });
    let r = best(data);
    if (!r && parsed.year) { data = await tmdb('/search/movie', { query: parsed.title, language }); r = best(data); }
    if (!r) {
      data = await tmdb('/search/multi', { query: parsed.title, language });
      r = (data?.results || []).find((x) => x.media_type === 'movie' || x.media_type === 'tv');
    }
    if (!r) return null;
    return {
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      overview: r.overview || '',
      poster: r.poster_path,
      backdrop: r.backdrop_path,
      genreIds: r.genre_ids,
      tv: r.media_type === 'tv',
    };
  }

  const posterCache = new Map();
  // Les épisodes d'une même série partagent affiche et fond : un seul téléchargement.
  function tmdbImage(found, key, kind) {
    const file = kind === 'bg' ? found.backdrop : found.poster;
    if (!file) return Promise.resolve(null);
    const url = `https://image.tmdb.org/t/p/${kind === 'bg' ? 'w1280' : 'w342'}${file}`;
    if (!found.tv) return saveImage(url, `${key}:${kind}`);
    const k = `tv:${fold(found.title)}:${kind}`;
    if (!posterCache.has(k)) posterCache.set(k, saveImage(url, k).catch(() => null));
    return posterCache.get(k);
  }

  // Fiche TMDB choisie par l'utilisateur (« movie:123 » ou « tv:456 »).
  async function videoById(pickId) {
    const [media, id] = String(pickId).split(':');
    const language = getConfig().search.language || 'fr-FR';
    const r = await tmdb(`/${media === 'tv' ? 'tv' : 'movie'}/${id}`, { language });
    if (!r) return null;
    return {
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      overview: r.overview || '',
      poster: r.poster_path,
      backdrop: r.backdrop_path,
      genres: (r.genres || []).map((g) => g.name).slice(0, 2).join(', '),
      tv: media === 'tv',
    };
  }

  async function scrapeVideo(item, override) {
    const key = `v:${item.path}`;
    if (override?.pick) {
      const found = await videoById(override.pick.id);
      if (!found) return false;
      const [image, backdrop] = await Promise.all([tmdbImage({ ...found, tv: false }, key, 'img'), tmdbImage({ ...found, tv: false }, key, 'bg')]);
      record(key, { title: found.title, year: found.year, overview: found.overview, genre: found.genres, image, backdrop, series: found.tv, source: 'TMDB', picked: true });
      return true;
    }
    const parsed = override ? { type: override.type || 'movie', title: override.title, year: override.year || '' } : parseVideo(item);
    const found = await lookupVideo(parsed);
    if (!found) { miss(key); return false; }
    const [image, backdrop, genre] = await Promise.all([tmdbImage(found, key, 'img'), tmdbImage(found, key, 'bg'), genreNames(found.genreIds)]);
    record(key, { title: found.title, year: found.year, overview: found.overview, genre, image, backdrop, series: !!found.tv || parsed.type === 'tv', source: 'TMDB' });
    return true;
  }

  /* ---------- MusicBrainz + Cover Art Archive ---------- */

  let lastMb = 0;
  async function mb(url) {
    const wait = 1100 - (Date.now() - lastMb); // 1 requête par seconde au plus
    if (wait > 0) await sleep(wait);
    lastMb = Date.now();
    return getJson(url);
  }

  async function scrapeAlbum(album, override) {
    const key = `a:${album.dir}`;
    let artist = '';
    let title = album.folder;
    const m = /^(.+?)\s+-\s+(.+)$/.exec(album.folder || '');
    if (m) { artist = m[1]; title = m[2]; }
    if (override) { artist = override.artist || ''; title = override.title; }
    title = cleanTitle(title.replace(/\((19|20)\d{2}\)/, ''));
    if (!title) { miss(key); return false; }
    const esc = (s) => s.replace(/(["\\])/g, '\\$1');
    const q = `releasegroup:"${esc(title)}"${artist ? ` AND artist:"${esc(artist)}"` : ''}`;
    const data = await mb(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=5`);
    const groups = rankByTitle((data?.['release-groups'] || []).filter((g) => (g.score ?? 100) >= 70), title, (g) => g.title);
    for (const g of groups) {
      if (state.cancel) return false;
      const image = await saveImage(`https://coverartarchive.org/release-group/${g.id}/front-250`, key);
      if (image) {
        const tag = [...(g.tags || [])].sort((a, b) => (b.count || 0) - (a.count || 0))[0]?.name || '';
        record(key, {
          title: g.title,
          artist: (g['artist-credit'] || []).map((a) => a.name).join(', '),
          year: (g['first-release-date'] || '').slice(0, 4),
          genre: MUSIC_GENRES[tag.toLowerCase()] || capitalize(tag),
          image,
          source: 'MusicBrainz',
        });
        return true;
      }
    }
    miss(key);
    return false;
  }

  // Album choisi par l'utilisateur dans la liste des fiches MusicBrainz.
  async function albumById(album, pick) {
    const key = `a:${album.dir}`;
    const g = await mb(`https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(pick.id)}?inc=tags+artist-credits&fmt=json`).catch(() => null);
    const image = await saveImage(`https://coverartarchive.org/release-group/${pick.id}/front-250`, key).catch(() => null);
    const tag = [...(g?.tags || [])].sort((a, b) => (b.count || 0) - (a.count || 0))[0]?.name || '';
    record(key, {
      title: g?.title || pick.title,
      artist: g ? (g['artist-credit'] || []).map((a) => a.name).join(', ') : pick.sub,
      year: (g?.['first-release-date'] || pick.year || '').slice(0, 4),
      genre: MUSIC_GENRES[tag.toLowerCase()] || capitalize(tag),
      image,
      source: 'MusicBrainz',
      picked: true,
    });
    return true;
  }

  /* ---------- Jaquettes libretro ---------- */

  const repoOf = (system) => system.replace(/ /g, '_');
  const indexes = new Map();

  // Liste des jaquettes d'un système : fichier .index du serveur libretro, sinon l'API GitHub.
  async function boxartIndex(system) {
    if (indexes.has(system)) return indexes.get(system);
    const cacheFile = path.join(cacheDir, `${repoOf(system)}.json`);
    try {
      const st = await fsp.stat(cacheFile);
      if (Date.now() - st.mtimeMs < INDEX_TTL_MS) {
        const list = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
        indexes.set(system, list);
        return list;
      }
    } catch { /* pas de cache */ }
    let list = null;
    try {
      const txt = await getText(`https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/.index`);
      if (txt && !/<html/i.test(txt)) list = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/\.png$/i, ''));
    } catch { /* serveur indisponible */ }
    if (!list || !list.length) {
      try {
        const tree = await getJson(`https://api.github.com/repos/libretro-thumbnails/${repoOf(system)}/git/trees/master?recursive=1`, { accept: 'application/vnd.github+json' });
        list = (tree?.tree || []).filter((t) => t.path.startsWith('Named_Boxarts/') && t.path.endsWith('.png')).map((t) => t.path.slice(14, -4));
      } catch { list = null; }
    }
    if (list && list.length) {
      indexes.set(system, list);
      fsp.writeFile(cacheFile, JSON.stringify(list)).catch(() => {});
    } else {
      indexes.set(system, null); // on se rabattra sur des noms devinés
    }
    return indexes.get(system);
  }

  const thumbName = (s) => s.replace(/[&*/:`<>?\\|"]/g, '_');
  const thumbUrl = (system, folder, name) => `https://raw.githubusercontent.com/libretro-thumbnails/${repoOf(system)}/master/${folder}/${encodeURIComponent(thumbName(name))}.png`;
  const boxartUrl = (system, name) => thumbUrl(system, 'Named_Boxarts', name);

  // Genres et années de libretro-database (fichiers .dat par système), gardés en cache 30 jours.
  const datCache = new Map();
  async function romFacts(system) {
    if (datCache.has(system)) return datCache.get(system);
    const cacheFile = path.join(cacheDir, `${repoOf(system)}.facts.json`);
    try {
      const st = await fsp.stat(cacheFile);
      if (Date.now() - st.mtimeMs < INDEX_TTL_MS) {
        const map = new Map(JSON.parse(await fsp.readFile(cacheFile, 'utf8')));
        datCache.set(system, map);
        return map;
      }
    } catch { /* pas de cache */ }
    const map = new Map();
    for (const [field, folder] of [['genre', 'genre'], ['year', 'releaseyear']]) {
      try {
        const txt = await getText(`https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/${folder}/${encodeURIComponent(system)}.dat`);
        if (!txt) continue;
        for (const m of txt.matchAll(/comment\s+"([^"]+)"\s+(?:genre|releaseyear)\s+"([^"]+)"/g)) {
          const k = romKey(m[1]);
          const cur = map.get(k) || {};
          if (!cur[field]) cur[field] = field === 'genre' ? (GAME_GENRES[m[2].toLowerCase()] || m[2]) : m[2];
          map.set(k, cur);
        }
      } catch { /* indisponible */ }
    }
    datCache.set(system, map);
    if (map.size) fsp.writeFile(cacheFile, JSON.stringify([...map])).catch(() => {});
    return map;
  }

  function bestMatch(list, romName) {
    const k = romKey(romName);
    if (!k) return null;
    const exact = list.filter((n) => romKey(n) === k);
    if (exact.length) return exact.sort((a, b) => regionScore(a) - regionScore(b))[0];
    let best = null;
    let score = 0;
    for (const n of list) {
      const s = bigramDice(k, romKey(n));
      if (s > score || (s === score && best && regionScore(n) < regionScore(best))) { score = s; best = n; }
    }
    return score >= 0.82 ? best : null;
  }

  async function scrapeRom(rom, system, override) {
    const key = `r:${rom.path}`;
    const name = override?.title || rom.name;
    let image = null;
    let matched = null;
    let title = rom.displayName || name;
    const list = override?.pick ? null : await boxartIndex(system);
    if (override?.pick) {
      matched = override.pick.id;
      image = await saveImage(boxartUrl(system, matched), key);
    } else if (list) {
      matched = bestMatch(list, name);
      if (matched) image = await saveImage(boxartUrl(system, matched), key);
    } else {
      // Sans liste : on essaie le nom tel quel puis avec les régions courantes.
      const base = name.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
      const candidates = [name, `${base} (Europe)`, `${base} (France)`, `${base} (USA, Europe)`, `${base} (USA)`, `${base} (World)`, `${base} (Japan)`];
      for (const c of [...new Set(candidates)]) {
        if (state.cancel) return false;
        image = await saveImage(boxartUrl(system, c), key);
        if (image) { matched = c; break; }
      }
    }
    const facts = (await romFacts(system)).get(romKey(matched || name)) || {};
    if (!image && !facts.genre) { miss(key); return false; }
    if (matched) title = matched.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || title;
    // Capture d'écran du jeu en guise de fond (à défaut, l'écran titre).
    let backdrop = null;
    if (matched) {
      backdrop = await saveImage(thumbUrl(system, 'Named_Snaps', matched), `${key}:bg`)
        || await saveImage(thumbUrl(system, 'Named_Titles', matched), `${key}:bg`);
    }
    record(key, { title, image, backdrop, genre: facts.genre || '', year: facts.year || '', source: 'libretro' });
    return true;
  }

  /* ---------- Jeux PC (magasin Steam) ---------- */

  async function scrapePcGame(game, override) {
    const key = `g:${fold(game.name)}`;
    let appId = (/^steam:\/\/rungameid\/(\d+)/i.exec(String(game.path || '')) || [])[1] || null;
    let title = game.name;
    if (override?.pick) {
      appId = String(override.pick.id);
      title = override.pick.title || title;
    } else if (!appId || override) {
      const term = override?.title || game.name;
      const data = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`);
      const it = rankByTitle(data?.items || [], term, (x) => x.name)[0];
      if (!it) { miss(key); return false; }
      appId = String(it.id);
      title = it.name || title;
    }
    const asset = (file) => [
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${file}`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${file}`,
    ];
    let image = null;
    for (const u of [...asset('library_600x900.jpg'), ...asset('header.jpg')]) { image = await saveImage(u, key).catch(() => null); if (image) break; }
    if (!image) { miss(key); return false; }
    let details = null;
    try { details = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=french&cc=FR`))?.[appId]?.data || null; } catch { /* sans détails */ }
    let backdrop = null;
    for (const u of [...asset('library_hero.jpg'), details?.background_raw, details?.background].filter(Boolean)) {
      backdrop = await saveImage(u, `${key}:bg`).catch(() => null);
      if (backdrop) break;
    }
    const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '’').replace(/\s+/g, ' ').trim();
    record(key, {
      title: details?.name || title,
      image,
      backdrop,
      genre: (details?.genres || []).map((g) => g.description).slice(0, 2).join(', '),
      year: (/(\d{4})/.exec(details?.release_date?.date || '') || [])[1] || '',
      overview: strip(details?.short_description),
      source: 'Steam',
    });
    return true;
  }

  /* ---------- Orchestration ---------- */

  async function pool(items, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length && !state.cancel) {
        const it = items[i++];
        try { await fn(it); } catch (err) { console.error('scrape', err.message); }
      }
    });
    await Promise.all(workers);
  }

  // jobs : { videos: [{path,name,dir}], albums: [{dir,folder}] } ; consoles et jeux PC lus dans la config.
  async function run({ kinds = ['videos', 'music', 'games'], videos = [], albums = [], pcGames = null, force = false } = {}) {
    if (state.running) return { ok: false, error: 'Une récupération est déjà en cours.' };
    state.running = true;
    state.cancel = false;
    const cfg = getConfig();
    const stats = { found: 0, missing: 0, skipped: [] };
    const tasks = [];

    if (kinds.includes('videos')) {
      if (!String(cfg.search.tmdbToken || '').trim()) stats.skipped.push('vidéos (clé TMDB absente)');
      else for (const v of videos) if (wanted(`v:${v.path}`, force)) tasks.push({ kind: 'video', run: () => scrapeVideo(v), limit: 4 });
    }
    if (kinds.includes('music')) {
      for (const a of albums) if (wanted(`a:${a.dir}`, force)) tasks.push({ kind: 'album', run: () => scrapeAlbum(a), limit: 1 });
    }
    if (kinds.includes('games')) {
      const seenGames = new Set();
      for (const g of pcGames || cfg.games) {
        const k = `g:${fold(g.name)}`;
        if (seenGames.has(k) || !wanted(k, force)) continue;
        seenGames.add(k);
        tasks.push({ kind: 'pc', run: () => scrapePcGame(g), limit: 2 });
      }
      for (let i = 0; i < cfg.emulators.length; i++) {
        const emu = cfg.emulators[i];
        const system = guessSystem(emu);
        if (!system) continue;
        const r = await listRoms(i);
        if (!r?.ok) continue;
        for (const rom of r.roms) if (wanted(`r:${rom.path}`, force)) tasks.push({ kind: 'rom', run: () => scrapeRom(rom, system), limit: 4 });
      }
    }

    const total = tasks.length;
    let done = 0;
    onProgress({ running: true, done, total });
    // Chaque source a sa propre cadence : on traite les groupes l'un après l'autre.
    for (const kind of ['video', 'album', 'rom', 'pc']) {
      const group = tasks.filter((t) => t.kind === kind);
      if (!group.length) continue;
      await pool(group, group[0].limit, async (t) => {
        const ok = await t.run().catch(() => false);
        if (ok) stats.found += 1; else stats.missing += 1;
        done += 1;
        onProgress({ running: true, done, total });
      });
      if (state.cancel) break;
    }
    state.running = false;
    const cancelled = state.cancel;
    onProgress({ running: false, done, total, ...stats, cancelled });
    return { ok: true, total, ...stats, cancelled };
  }

  // Toutes les fiches qui correspondent à une recherche, pour laisser choisir la bonne.
  async function candidates({ kind, item, query, year, artist }) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'Indiquez un titre à chercher.' };
    if (kind === 'video') {
      if (!String(getConfig().search.tmdbToken || '').trim()) return { ok: false, error: 'Ajoutez une clé TMDB dans Réglages pour chercher les films et séries.' };
      const language = getConfig().search.language || 'fr-FR';
      const tvOnly = /S\d{1,2}\s*E\d{1,3}/i.test(item?.name || '');
      const data = await tmdb(tvOnly ? '/search/tv' : '/search/multi', { query: q, language });
      const list = (data?.results || []).filter((r) => tvOnly || r.media_type === 'movie' || r.media_type === 'tv');
      const ranked = rankByTitle(list, q, (r) => r.title || r.name, (r) => r.release_date || r.first_air_date, year).slice(0, 12);
      return {
        ok: true,
        items: ranked.map((r) => {
          const media = tvOnly ? 'tv' : r.media_type;
          const t = r.title || r.name;
          const original = r.original_title || r.original_name;
          return {
            id: `${media}:${r.id}`,
            title: t,
            year: (r.release_date || r.first_air_date || '').slice(0, 4),
            sub: [media === 'tv' ? 'Série' : 'Film', original && original !== t ? original : ''].filter(Boolean).join(', '),
            image: r.poster_path ? `https://image.tmdb.org/t/p/w154${r.poster_path}` : null,
          };
        }),
      };
    }
    if (kind === 'album') {
      const esc = (x) => x.replace(/(["\\])/g, '\\$1');
      const mq = `releasegroup:"${esc(q)}"${artist ? ` AND artist:"${esc(artist)}"` : ''}`;
      const data = await mb(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(mq)}&fmt=json&limit=12`);
      const ranked = rankByTitle(data?.['release-groups'] || [], q, (g) => g.title);
      return {
        ok: true,
        items: ranked.map((g) => ({
          id: g.id,
          title: g.title,
          year: (g['first-release-date'] || '').slice(0, 4),
          sub: [(g['artist-credit'] || []).map((a) => a.name).join(', '), g['primary-type']].filter(Boolean).join(', '),
          image: `https://coverartarchive.org/release-group/${g.id}/front-250`,
        })),
      };
    }
    if (kind === 'pc') {
      const data = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=french&cc=FR`);
      const ranked = rankByTitle(data?.items || [], q, (x) => x.name);
      return {
        ok: true,
        items: ranked.slice(0, 12).map((it) => ({
          id: String(it.id),
          title: it.name,
          year: '',
          sub: 'Steam',
          image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${it.id}/library_600x900.jpg`,
          fallback: it.tiny_image || null,
        })),
      };
    }
    if (kind === 'rom') {
      const emu = getConfig().emulators[item?.emu];
      const system = emu ? guessSystem(emu) : '';
      if (!system) return { ok: false, error: 'Système de la console inconnu : indiquez-le avec « Modifier la console ».' };
      const list = await boxartIndex(system);
      if (!list) return { ok: false, error: 'La liste des jaquettes de ce système est indisponible pour le moment.' };
      const k = romKey(q);
      const scored = list.map((n) => ({ n, s: bigramDice(k, romKey(n)) + (romKey(n) === k ? 1 : 0) - regionScore(n) * 0.01 }))
        .filter((x) => x.s > 0.35)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
      return {
        ok: true,
        items: scored.map(({ n }) => ({
          id: n,
          title: n.replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || n,
          year: '',
          sub: (n.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1)).join(', '),
          image: boxartUrl(system, n),
        })),
      };
    }
    return { ok: false, error: 'Type inconnu.' };
  }

  async function one({ kind, item, override }) {
    if (kind === 'video') return { ok: await scrapeVideo(item, override) };
    if (kind === 'album') return { ok: override?.pick ? await albumById(item, override.pick) : await scrapeAlbum(item, override) };
    if (kind === 'pc') return { ok: await scrapePcGame(item, override) };
    if (kind === 'rom') {
      const emu = getConfig().emulators[item.emu];
      const system = emu ? guessSystem(emu) : '';
      if (!system) return { ok: false, error: 'Système de la console inconnu : ajoutez « system » dans sa configuration.' };
      return { ok: await scrapeRom(item, system, override) };
    }
    return { ok: false };
  }

  return {
    imgDir,
    data: () => db.items,
    run,
    one,
    candidates,
    cancel: () => { state.cancel = true; return true; },
    running: () => state.running,
    forget(key) { delete db.items[key]; delete db.misses[key]; save(); return true; },
    async clear() {
      db = { items: {}, misses: {} };
      save();
      for (const f of await fsp.readdir(imgDir).catch(() => [])) await fsp.unlink(path.join(imgDir, f)).catch(() => {});
      return true;
    },
    _test: { parseVideo, romKey, bestMatch, guessSystem, cleanTitle, rankByTitle },
  };
}

module.exports = { createScraper, guessSystem, parseVideo };
